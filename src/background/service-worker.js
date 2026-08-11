// OctoLens service worker: GitHub API access, caching, bookmarks, settings.
// All state lives in chrome.storage — the worker itself is ephemeral.

const API = 'https://api.github.com';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const MAX_CACHE_ENTRIES = 300;
const MAX_BOOKMARKS = 200;
const MAX_NOTES = 200;
const MAX_SEARCHES_PER_REQUEST = 2;
const MAX_IMPORT_BYTES = 1_000_000;
const DATA_SCHEMA_VERSION = 1;

const MAX_RECENT = 50;

const DEFAULT_SETTINGS = {
  token: '',
  showSimilar: true,
  showStats: true,
  showClone: true,
  showOpenIn: true,
  showHovercards: true,
  personalize: true
};

// How many merged search candidates to keep per repo. The pool is cached
// raw and re-ranked with the user's current preferences on every render,
// so feedback changes results instantly without extra API calls.
const CANDIDATE_POOL = 18;

const HOMEPAGE = 'https://github.com/dataswarmproject/octolens';

chrome.runtime.onInstalled.addListener(async (details) => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS, ...settings } });
  if (details.reason === 'install') {
    await chrome.tabs.create({ url: `${HOMEPAGE}#readme` });
  }
});

// Keyboard shortcut (Alt+Shift+O by default): collapse/expand the strip.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-strip') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_STRIP' });
  } catch { /* no content script in this tab */ }
});

// Coalesce concurrent identical GETs (e.g. strip + hovercard both asking for
// the same repo). In-memory only — request-scoped dedup, not persistence.
const inflight = new Map();

// ---------------------------------------------------------------- settings

async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

// ---------------------------------------------------------------- cache
// Each entry is stored under its own key ({ t: timestamp, v: value });
// 'cacheIndex' tracks keys so old entries can be evicted.

async function cacheGet(key) {
  const wrapped = (await chrome.storage.local.get(key))[key];
  if (!wrapped || typeof wrapped.t !== 'number') return null;
  if (Date.now() - wrapped.t > CACHE_TTL_MS) {
    await chrome.storage.local.remove(key);
    return null;
  }
  return wrapped.v;
}

async function cacheSet(key, value) {
  await chrome.storage.local.set({ [key]: { t: Date.now(), v: value } });
  const { cacheIndex = [] } = await chrome.storage.local.get('cacheIndex');
  const index = cacheIndex.filter((e) => e.k !== key);
  index.push({ k: key, t: Date.now() });
  if (index.length > MAX_CACHE_ENTRIES) {
    index.sort((a, b) => a.t - b.t);
    const evicted = index.splice(0, index.length - MAX_CACHE_ENTRIES);
    await chrome.storage.local.remove(evicted.map((e) => e.k));
  }
  await chrome.storage.local.set({ cacheIndex: index });
}

async function clearCache() {
  const { cacheIndex = [] } = await chrome.storage.local.get('cacheIndex');
  await chrome.storage.local.remove([...cacheIndex.map((e) => e.k), 'cacheIndex']);
}

// ---------------------------------------------------------------- data portability
// Backups deliberately exclude credentials, API responses and UI-only state.
// Imported data is untrusted: every field is rebuilt from an allowlist before
// it reaches storage, and repository URLs are derived from validated slugs.

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeString(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function safeNonNegativeInteger(value) {
  return Number.isFinite(value) && value >= 0
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value))
    : 0;
}

function safeTimestamp(value) {
  return safeNonNegativeInteger(value);
}

function isRepoName(value) {
  return typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/.test(value);
}

function sanitizeRepoList(value, limit, timestampField) {
  if (!Array.isArray(value)) throw { code: 'invalid_import' };
  const repos = [];
  const seen = new Set();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const fullName = safeString(item.full_name, 140);
    const id = fullName.toLowerCase();
    if (!isRepoName(fullName) || seen.has(id)) continue;
    seen.add(id);
    repos.push({
      full_name: fullName,
      html_url: `https://github.com/${fullName}`,
      description: safeString(item.description, 500),
      language: safeString(item.language, 100),
      stargazers_count: safeNonNegativeInteger(item.stargazers_count),
      [timestampField]: safeTimestamp(item[timestampField])
    });
    if (repos.length >= limit) break;
  }
  return repos;
}

function sanitizeNotes(value) {
  if (!isRecord(value)) throw { code: 'invalid_import' };
  const notes = {};
  for (const [fullName, note] of Object.entries(value)) {
    if (Object.keys(notes).length >= MAX_NOTES) break;
    if (!isRepoName(fullName) || !isRecord(note)) continue;
    const text = safeString(note.text, 2000);
    if (!text) continue;
    notes[fullName.toLowerCase()] = {
      text,
      updatedAt: safeTimestamp(note.updatedAt)
    };
  }
  return notes;
}

function isSafePreferenceKey(key) {
  return typeof key === 'string' && key.length > 0 && key.length <= 100 &&
    !/[\u0000-\u001f\u007f]/.test(key) &&
    !['__proto__', 'constructor', 'prototype'].includes(key);
}

function sanitizeWeights(value) {
  if (!isRecord(value)) throw { code: 'invalid_import' };
  const weights = {};
  for (const [key, weight] of Object.entries(value)) {
    if (Object.keys(weights).length >= 200) break;
    if (!isSafePreferenceKey(key) || !Number.isFinite(weight)) continue;
    const clamped = Math.max(-MAX_WEIGHT, Math.min(MAX_WEIGHT, weight));
    if (clamped !== 0) weights[key] = Math.round(clamped * 100) / 100;
  }
  return weights;
}

function sanitizeRepoSignals(value) {
  if (!isRecord(value)) throw { code: 'invalid_import' };
  const signals = {};
  for (const [fullName, timestamp] of Object.entries(value)) {
    if (Object.keys(signals).length >= MAX_BOOKMARKS) break;
    if (isRepoName(fullName)) signals[fullName.toLowerCase()] = safeTimestamp(timestamp);
  }
  return signals;
}

function sanitizePrefs(value) {
  if (!isRecord(value)) throw { code: 'invalid_import' };
  return {
    topics: sanitizeWeights(value.topics),
    languages: sanitizeWeights(value.languages),
    owners: sanitizeWeights(value.owners),
    likedRepos: sanitizeRepoSignals(value.likedRepos),
    hiddenRepos: sanitizeRepoSignals(value.hiddenRepos)
  };
}

function portableSettings(value) {
  if (!isRecord(value)) throw { code: 'invalid_import' };
  const settings = {};
  for (const key of [
    'showSimilar', 'showStats', 'showClone',
    'showOpenIn', 'showHovercards', 'personalize'
  ]) {
    settings[key] = typeof value[key] === 'boolean' ? value[key] : DEFAULT_SETTINGS[key];
  }
  return settings;
}

async function exportData() {
  const stored = await chrome.storage.local.get([
    'bookmarks', 'recent', 'notes', 'prefs', 'settings'
  ]);
  return {
    ok: true,
    exportData: {
      app: 'OctoLens',
      schemaVersion: DATA_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        bookmarks: stored.bookmarks || [],
        recent: stored.recent || [],
        notes: stored.notes || {},
        prefs: stored.prefs || {
          topics: {}, languages: {}, owners: {}, likedRepos: {}, hiddenRepos: {}
        },
        settings: portableSettings(stored.settings || {})
      }
    }
  };
}

async function importData(importDocument) {
  let serialized;
  try {
    serialized = JSON.stringify(importDocument);
  } catch {
    throw { code: 'invalid_import' };
  }
  if (!serialized || serialized.length > MAX_IMPORT_BYTES ||
      !isRecord(importDocument) || importDocument.app !== 'OctoLens' ||
      importDocument.schemaVersion !== DATA_SCHEMA_VERSION ||
      !isRecord(importDocument.data)) {
    throw { code: 'invalid_import' };
  }

  const data = importDocument.data;
  const sanitized = {
    bookmarks: sanitizeRepoList(data.bookmarks, MAX_BOOKMARKS, 'addedAt'),
    recent: sanitizeRepoList(data.recent, MAX_RECENT, 'visitedAt'),
    notes: sanitizeNotes(data.notes),
    prefs: sanitizePrefs(data.prefs),
    settings: portableSettings(data.settings)
  };
  const currentSettings = await getSettings();
  sanitized.settings.token = currentSettings.token;
  await chrome.storage.local.set(sanitized);
  return {
    ok: true,
    counts: {
      bookmarks: sanitized.bookmarks.length,
      recent: sanitized.recent.length,
      notes: Object.keys(sanitized.notes).length
    }
  };
}

// ---------------------------------------------------------------- GitHub API

function ghFetch(path, token) {
  const key = `${token ? 't' : 'a'}:${path}`;
  if (inflight.has(key)) return inflight.get(key);
  const p = ghFetchRaw(path, token).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function ghFetchRaw(path, token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(API + path, { headers, signal: AbortSignal.timeout(10000) });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw { code: 'timeout' };
    throw { code: 'network' };
  }

  // Record rate-limit state so the popup can display it.
  const rate = {
    limit: Number(res.headers.get('x-ratelimit-limit') ?? -1),
    remaining: Number(res.headers.get('x-ratelimit-remaining') ?? -1),
    resetAt: Number(res.headers.get('x-ratelimit-reset') ?? 0) * 1000
  };
  if (rate.limit > 0) {
    const bucket = path.startsWith('/search') ? 'search' : 'core';
    const { rateInfo = {} } = await chrome.storage.session.get('rateInfo');
    rateInfo[bucket] = rate;
    await chrome.storage.session.set({ rateInfo });
  }

  if ((res.status === 403 || res.status === 429) && rate.remaining === 0) {
    throw { code: 'rate_limit', resetAt: rate.resetAt };
  }
  if (res.status === 401) throw { code: 'bad_token' };
  if (res.status === 404) throw { code: 'not_found' };
  if (!res.ok) throw { code: `http_${res.status}` };
  return res.json();
}

function slimRepo(r) {
  return {
    full_name: r.full_name,
    html_url: r.html_url,
    description: r.description || '',
    language: r.language || '',
    topics: r.topics || [],
    stargazers_count: r.stargazers_count || 0,
    forks_count: r.forks_count || 0,
    open_issues_count: r.open_issues_count || 0,
    created_at: r.created_at,
    pushed_at: r.pushed_at,
    size: r.size || 0,
    license:
      r.license && r.license.spdx_id && r.license.spdx_id !== 'NOASSERTION'
        ? r.license.spdx_id
        : (r.license ? r.license.name : null),
    default_branch: r.default_branch || 'main',
    clone_url: r.clone_url,
    ssh_url: r.ssh_url,
    owner_avatar: r.owner ? r.owner.avatar_url : '',
    archived: !!r.archived
  };
}

function slimSearchItem(r) {
  return {
    full_name: r.full_name,
    html_url: r.html_url,
    description: r.description || '',
    language: r.language || '',
    topics: r.topics || [],
    stargazers_count: r.stargazers_count || 0,
    owner_avatar: r.owner ? r.owner.avatar_url : '',
    pushed_at: r.pushed_at
  };
}

// ---------------------------------------------------------------- similar repos

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'of', 'in', 'on', 'with', 'to', 'is',
  'your', 'my', 'this', 'that', 'app', 'tool', 'library', 'framework',
  'plugin', 'awesome', 'simple', 'fast', 'lightweight', 'modern', 'open',
  'source', 'based', 'using', 'made', 'built', 'repo', 'repository', 'project'
]);

function keywordCandidates(meta) {
  const name = meta.full_name.split('/')[1] || '';
  const nameWords = name
    .split(/[-_.\s]+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()));
  const descWords = (meta.description || '')
    .split(/\s+/)
    .map((w) => w.replace(/[^\w#+.-]/g, ''))
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w.toLowerCase()))
    .slice(0, 3);
  const seen = new Set();
  const out = [];
  for (const w of [...nameWords, ...descWords]) {
    const k = w.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(w);
    }
  }
  return out.slice(0, 3);
}

// Topics that say nothing about what a repo actually is. Using them in
// queries (or counting them as overlap) produces junk matches.
const GENERIC_TOPICS = new Set([
  'good-first-issue', 'help-wanted', 'beginner-friendly', 'first-timers-only',
  'up-for-grabs', 'open-source', 'opensource', 'oss', 'community', 'free',
  'awesome', 'awesome-list', 'resources', 'education', 'tutorial', 'examples'
]);

function isGenericTopic(t) {
  const low = t.toLowerCase();
  return GENERIC_TOPICS.has(low) || low.startsWith('hacktoberfest');
}

// GitHub returns topics alphabetically, which is meaningless. Rank them by
// how specific they look: topics echoed in the repo's own name/description
// first, then multi-word (more specific) topics. Topics the user has shown
// interest in get a further boost.
function rankTopics(meta, prefs) {
  const text = `${(meta.full_name || '').split('/')[1] || ''} ${meta.description || ''}`.toLowerCase();
  const prefTopics = (prefs && prefs.topics) || {};
  return (meta.topics || [])
    .filter((t) => !isGenericTopic(t))
    .map((t) => {
      const low = t.toLowerCase();
      const words = low.split('-');
      // Full-ratio matching: "react-context" only half-matches a repo about
      // "react", so plain "react" outranks it. Prevents niche compound
      // topics from hijacking the query.
      const matched = words.filter((w) => w.length > 2 && text.includes(w)).length;
      const ratio = matched / words.length;
      return { t, score: ratio * 3 + Math.min(words.length, 3) * 0.5 + (prefTopics[low] || 0) * 0.5 };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.t);
}

// Ordered list of search queries, most specific first. We stop as soon as we
// have enough results or hit MAX_SEARCHES_PER_REQUEST.
function buildQueries(meta, prefs) {
  const topics = rankTopics(meta, prefs).slice(0, 3);
  const lang = meta.language ? ` language:"${meta.language}"` : '';
  const queries = [];
  if (topics.length >= 2) {
    queries.push(`topic:${topics[0]} topic:${topics[1]} archived:false`);
  }
  if (topics.length >= 1) {
    queries.push(`topic:${topics[0]}${lang} archived:false`);
  }
  const kw = keywordCandidates(meta);
  if (kw.length) {
    queries.push(`${kw.join(' ')}${lang} in:name,description archived:false`);
  }
  return queries;
}

// Relevance = topical overlap first, popularity second. Raw star-sorting
// surfaces "famous in the same language" repos; this surfaces actual peers.
function relevanceScore(meta, item) {
  const mine = new Set(
    (meta.topics || []).filter((t) => !isGenericTopic(t)).map((t) => t.toLowerCase())
  );
  const shared = (item.topics || [])
    .filter((t) => !isGenericTopic(t) && mine.has(t.toLowerCase())).length;
  const langMatch = meta.language && item.language === meta.language ? 1.5 : 0;
  // Overlap capped so topic-stuffed repos can't run away; stars weighted so
  // well-known peers beat obscure ones with identical tags.
  return Math.min(shared, 3) * 3.5 + langMatch +
    Math.log10((item.stargazers_count || 0) + 1) * 1.5;
}

// Collects an UNRANKED candidate pool. Ranking happens at serve time with
// the user's current preferences (rankSimilar), so cached pools stay valid
// as preferences evolve.
async function findSimilarCandidates(meta, token, prefs) {
  const self = meta.full_name.toLowerCase();
  const found = new Map();
  let searches = 0;

  for (const q of buildQueries(meta, prefs)) {
    if (searches >= MAX_SEARCHES_PER_REQUEST || found.size >= CANDIDATE_POOL) break;
    searches++;
    const data = await ghFetch(
      `/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=12`,
      token
    );
    for (const item of data.items || []) {
      const key = item.full_name.toLowerCase();
      if (key === self || found.has(key)) continue;
      found.set(key, slimSearchItem(item));
    }
  }
  return [...found.values()].slice(0, CANDIDATE_POOL);
}

function rankSimilar(meta, candidates, prefs, personalize) {
  const hidden = (prefs && prefs.hiddenRepos) || {};
  const liked = (prefs && prefs.likedRepos) || {};
  let pool = (candidates || []).filter((c) => !hidden[c.full_name.toLowerCase()]);

  // Quality floor: prefer established repos when the pool allows it.
  const solid = pool.filter((c) => (c.stargazers_count || 0) >= 100);
  if (solid.length >= 6) pool = solid;

  return pool
    .map((c) => ({
      ...c,
      liked: !!liked[c.full_name.toLowerCase()],
      _score: relevanceScore(meta, c) + (personalize ? personalScore(prefs, c) : 0)
    }))
    .sort((a, b) => b._score - a._score)
    .slice(0, 6)
    .map(({ _score, ...c }) => c);
}

// ---------------------------------------------------------------- preference profile
// All personalization is local. Weights are capped so no single signal can
// dominate forever, and generic topics never enter the profile.

const MAX_WEIGHT = 5;

async function getPrefs() {
  const { prefs = {} } = await chrome.storage.local.get('prefs');
  return {
    topics: {}, languages: {}, owners: {},
    likedRepos: {}, hiddenRepos: {},
    ...prefs
  };
}

function bump(map, key, delta) {
  if (!key) return;
  const next = (map[key] || 0) + delta;
  const clamped = Math.max(-MAX_WEIGHT, Math.min(MAX_WEIGHT, next));
  if (Math.abs(clamped) < 0.05) delete map[key];
  else map[key] = Math.round(clamped * 100) / 100;
}

function ownerOf(fullName) {
  return String(fullName || '').split('/')[0].toLowerCase();
}

function repoTopicsFor(repo) {
  return ((repo && repo.topics) || [])
    .filter((t) => !isGenericTopic(t))
    .map((t) => t.toLowerCase())
    .slice(0, 6);
}

function personalScore(prefs, item) {
  let s = 0;
  for (const t of repoTopicsFor(item)) s += (prefs.topics[t] || 0) * 1.0;
  if (item.language) s += (prefs.languages[item.language] || 0) * 0.6;
  s += (prefs.owners[ownerOf(item.full_name)] || 0) * 0.7;
  if (prefs.likedRepos[String(item.full_name).toLowerCase()]) s += 0.5;
  return s;
}

async function prefFeedback(msg) {
  const prefs = await getPrefs();
  const repo = msg.repo || {};
  const key = String(repo.full_name || msg.full_name || '').toLowerCase();
  const topics = repoTopicsFor(repo);

  switch (msg.action) {
    case 'like':
      if (!key) break;
      prefs.likedRepos[key] = Date.now();
      delete prefs.hiddenRepos[key];
      topics.forEach((t) => bump(prefs.topics, t, 1));
      bump(prefs.languages, repo.language, 0.5);
      bump(prefs.owners, ownerOf(key), 0.75);
      break;
    case 'unlike':
      delete prefs.likedRepos[key];
      topics.forEach((t) => bump(prefs.topics, t, -1));
      bump(prefs.languages, repo.language, -0.5);
      bump(prefs.owners, ownerOf(key), -0.75);
      break;
    case 'dislike':
      if (!key) break;
      prefs.hiddenRepos[key] = Date.now();
      delete prefs.likedRepos[key];
      topics.forEach((t) => bump(prefs.topics, t, -0.5));
      break;
    case 'undo_hide':
      delete prefs.hiddenRepos[key];
      topics.forEach((t) => bump(prefs.topics, t, 0.5));
      break;
    case 'more_like_repo':
      topics.forEach((t) => bump(prefs.topics, t, 1.5));
      bump(prefs.languages, repo.language, 1);
      bump(prefs.owners, ownerOf(key), 1);
      break;
    case 'more_topic':
      bump(prefs.topics, String(msg.topic || '').toLowerCase(), 2);
      break;
    case 'more_language':
      bump(prefs.languages, msg.language, 1.5);
      break;
    case 'more_owner':
      bump(prefs.owners, String(msg.owner || '').toLowerCase(), 1.5);
      break;
    case 'click':
      topics.forEach((t) => bump(prefs.topics, t, 0.2));
      bump(prefs.languages, repo.language, 0.1);
      break;
    case 'bookmark':
      topics.forEach((t) => bump(prefs.topics, t, 1));
      bump(prefs.owners, ownerOf(key), 0.5);
      break;
    default:
      return { ok: false, error: 'bad_action' };
  }

  await chrome.storage.local.set({ prefs });
  return { ok: true };
}

// ---------------------------------------------------------------- private notes

async function saveNote({ full_name, text }) {
  if (!full_name) return { ok: false, error: 'bad_request' };
  const { notes = {} } = await chrome.storage.local.get('notes');
  const key = full_name.toLowerCase();
  const trimmed = (text || '').trim();
  if (!trimmed) delete notes[key];
  else notes[key] = { text: trimmed.slice(0, 2000), updatedAt: Date.now() };
  await chrome.storage.local.set({ notes });
  return { ok: true, hasNote: !!notes[key] };
}

// ---------------------------------------------------------------- bookmarks

async function toggleBookmark(repo) {
  if (!repo || !repo.full_name) return { ok: false, error: 'bad_request' };
  const { bookmarks = [] } = await chrome.storage.local.get('bookmarks');
  const id = repo.full_name.toLowerCase();
  const existing = bookmarks.findIndex((b) => b.full_name.toLowerCase() === id);
  let bookmarked;
  if (existing >= 0) {
    bookmarks.splice(existing, 1);
    bookmarked = false;
  } else {
    bookmarks.unshift({
      full_name: repo.full_name,
      html_url: repo.html_url || `https://github.com/${repo.full_name}`,
      description: repo.description || '',
      language: repo.language || '',
      stargazers_count: repo.stargazers_count || 0,
      addedAt: Date.now()
    });
    if (bookmarks.length > MAX_BOOKMARKS) bookmarks.pop();
    bookmarked = true;
    // Bookmarking is a strong interest signal.
    await prefFeedback({ action: 'bookmark', repo });
  }
  await chrome.storage.local.set({ bookmarks });
  return { ok: true, bookmarked };
}

// ---------------------------------------------------------------- recent history

async function addVisit(meta) {
  const { recent = [] } = await chrome.storage.local.get('recent');
  const id = meta.full_name.toLowerCase();
  const filtered = recent.filter((r) => r.full_name.toLowerCase() !== id);
  filtered.unshift({
    full_name: meta.full_name,
    html_url: meta.html_url,
    description: meta.description || '',
    language: meta.language || '',
    stargazers_count: meta.stargazers_count || 0,
    visitedAt: Date.now()
  });
  await chrome.storage.local.set({ recent: filtered.slice(0, MAX_RECENT) });
}

// ---------------------------------------------------------------- handlers

// Lightweight meta lookup used by hovercards. Never spends the last few
// unauthenticated requests — hover previews are a nice-to-have.
async function getRepoMeta({ owner, repo }) {
  const id = `${owner}/${repo}`.toLowerCase();
  const key = `meta:${id}`;
  let meta = await cacheGet(key);
  if (!meta) {
    const settings = await getSettings();
    if (!settings.token) {
      const { rateInfo = {} } = await chrome.storage.session.get('rateInfo');
      const core = rateInfo.core;
      if (core && core.remaining >= 0 && core.remaining < 10 && Date.now() < core.resetAt) {
        return { ok: false, error: 'rate_low' };
      }
    }
    meta = slimRepo(
      await ghFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        settings.token
      )
    );
    await cacheSet(key, meta);
  }
  return { ok: true, meta };
}

async function searchRepos(q) {
  const query = (q || '').trim();
  if (!query) return { ok: true, items: [], total: 0 };
  const settings = await getSettings();
  const data = await ghFetch(
    `/search/repositories?q=${encodeURIComponent(query)}&per_page=8`,
    settings.token
  );
  return {
    ok: true,
    items: (data.items || []).map(slimSearchItem),
    total: data.total_count || 0
  };
}

async function getRepoIntel({ owner, repo, refresh }) {
  const settings = await getSettings();
  const prefs = await getPrefs();
  const id = `${owner}/${repo}`.toLowerCase();
  const metaKey = `meta:${id}`;
  const simKey = `simpool:${id}`;

  let meta = refresh ? null : await cacheGet(metaKey);
  if (!meta) {
    meta = slimRepo(
      await ghFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        settings.token
      )
    );
    await cacheSet(metaKey, meta);
  }

  let pool = refresh ? null : await cacheGet(simKey);
  let similarError = null;
  let resetAt = null;
  if (!pool) {
    try {
      pool = await findSimilarCandidates(meta, settings.token, prefs);
      await cacheSet(simKey, pool);
    } catch (e) {
      pool = [];
      similarError = (e && e.code) || 'unknown';
      resetAt = (e && e.resetAt) || null;
    }
  }

  // Re-ranked on every call with the current preference profile — likes,
  // hides and "more of…" apply instantly, with zero extra API calls.
  const similar = rankSimilar(meta, pool, prefs, settings.personalize);

  const { bookmarks = [] } = await chrome.storage.local.get('bookmarks');
  const bookmarked = bookmarks.some(
    (b) => b.full_name.toLowerCase() === id
  );

  const { notes = {} } = await chrome.storage.local.get('notes');

  await addVisit(meta);

  const { rateInfo = {} } = await chrome.storage.session.get('rateInfo');

  return {
    ok: true,
    meta,
    similar,
    similarError,
    resetAt,
    bookmarked,
    note: notes[id] ? notes[id].text : '',
    hasToken: !!settings.token,
    rate: rateInfo,
    settings: {
      showSimilar: settings.showSimilar,
      showStats: settings.showStats,
      showClone: settings.showClone,
      showOpenIn: settings.showOpenIn
    }
  };
}

async function testToken(token) {
  const data = await ghFetch('/rate_limit', token);
  return {
    ok: true,
    core: data.resources.core.limit,
    search: data.resources.search.limit
  };
}

async function handleMessage(msg) {
  switch (msg && msg.type) {
    case 'GET_REPO_INTEL':
      return getRepoIntel(msg);
    case 'GET_REPO_META':
      return getRepoMeta(msg);
    case 'SEARCH_REPOS':
      return searchRepos(msg.q);
    case 'TOGGLE_BOOKMARK':
      return toggleBookmark(msg.repo);
    case 'PREF_FEEDBACK':
      return prefFeedback(msg);
    case 'SAVE_NOTE':
      return saveNote(msg);
    case 'GET_PREFS': {
      const prefs = await getPrefs();
      return { ok: true, prefs };
    }
    case 'RESET_PREFS':
      await chrome.storage.local.set({
        prefs: { topics: {}, languages: {}, owners: {}, likedRepos: {}, hiddenRepos: {} }
      });
      return { ok: true };
    case 'UNHIDE_ALL': {
      const prefs = await getPrefs();
      prefs.hiddenRepos = {};
      await chrome.storage.local.set({ prefs });
      return { ok: true };
    }
    case 'TEST_TOKEN':
      return testToken(msg.token);
    case 'CLEAR_CACHE':
      await clearCache();
      return { ok: true };
    case 'EXPORT_DATA':
      return exportData();
    case 'IMPORT_DATA':
      return importData(msg.importData);
    case 'GET_RATE': {
      const { rateInfo = {} } = await chrome.storage.session.get('rateInfo');
      return { ok: true, rate: rateInfo };
    }
    default:
      return { ok: false, error: 'unknown_message' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      sendResponse(await handleMessage(msg));
    } catch (e) {
      sendResponse({
        ok: false,
        error: (e && e.code) || 'unknown',
        resetAt: (e && e.resetAt) || null
      });
    }
  })();
  return true; // keep the channel open for the async response
});
