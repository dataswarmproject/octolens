// OctoLens service-worker test harness.
// Loads src/background/service-worker.js in a Node VM with a mocked chrome.*
// surface, then exercises the message handlers.
//
//   node scripts/test-sw.mjs           # offline tests only (mocked fetch)
//   node scripts/test-sw.mjs --live    # + live GitHub API round-trips
//
// Exit code 0 = all passed.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIVE = process.argv.includes('--live');

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------- chrome mock

function makeStorageArea(map) {
  return {
    async get(keys) {
      const out = {};
      const list = keys == null ? [...map.keys()] : Array.isArray(keys) ? keys : [keys];
      for (const k of list) if (map.has(k)) out[k] = structuredClone(map.get(k));
      return out;
    },
    async set(obj) {
      for (const [k, v] of Object.entries(obj)) map.set(k, structuredClone(v));
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) map.delete(k);
    },
    async clear() { map.clear(); }
  };
}

function buildContext(fetchImpl) {
  const local = new Map();
  const session = new Map();
  const messageListeners = [];
  const chrome = {
    storage: {
      local: makeStorageArea(local),
      session: makeStorageArea(session),
      onChanged: { addListener() {} }
    },
    runtime: {
      onInstalled: { addListener() {} },
      onMessage: { addListener(fn) { messageListeners.push(fn); } },
      getManifest: () => ({ version: 'test' })
    },
    commands: { onCommand: { addListener() {} } },
    tabs: { query: async () => [], sendMessage: async () => {}, create: async () => {} }
  };
  const ctx = {
    chrome,
    fetch: fetchImpl,
    console,
    AbortSignal,
    URL,
    setTimeout,
    clearTimeout,
    structuredClone
  };
  vm.createContext(ctx);
  const code = readFileSync(join(ROOT, 'src/background/service-worker.js'), 'utf8');
  vm.runInContext(code, ctx);

  function send(msg) {
    return new Promise((resolve) => {
      const keepOpen = messageListeners[0](msg, {}, resolve);
      if (keepOpen !== true) resolve(undefined);
    });
  }
  return { ctx, send, local, session };
}

// ---------------------------------------------------------------- fetch fakes

function fakeResponse({ status = 200, body = {}, rate = { limit: 60, remaining: 55, reset: 1700000000 } }) {
  const headers = new Map([
    ['x-ratelimit-limit', String(rate.limit)],
    ['x-ratelimit-remaining', String(rate.remaining)],
    ['x-ratelimit-reset', String(rate.reset)]
  ]);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers.get(k.toLowerCase()) ?? null },
    json: async () => body
  };
}

const SAMPLE_REPO = {
  full_name: 'acme/rocket',
  html_url: 'https://github.com/acme/rocket',
  description: 'A rocket engine simulator',
  language: 'TypeScript',
  topics: ['simulation', 'physics', 'rockets'],
  stargazers_count: 1200,
  forks_count: 100,
  open_issues_count: 12,
  created_at: '2020-01-01T00:00:00Z',
  pushed_at: '2026-08-01T00:00:00Z',
  size: 2048,
  license: { spdx_id: 'MIT' },
  default_branch: 'main',
  clone_url: 'https://github.com/acme/rocket.git',
  ssh_url: 'git@github.com:acme/rocket.git',
  owner: { avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' },
  archived: false
};

function searchItem(name, { topics = [], stars = 10, language = 'TypeScript' } = {}) {
  return {
    full_name: name,
    html_url: `https://github.com/${name}`,
    description: `${name} description`,
    language,
    topics,
    stargazers_count: stars,
    owner: { avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4' },
    pushed_at: '2026-07-01T00:00:00Z'
  };
}

// ---------------------------------------------------------------- offline tests

async function offlineTests() {
  console.log('\n== offline: query building & ranking ==');
  {
    const { ctx } = buildContext(async () => fakeResponse({}));
    const qTopics = ctx.buildQueries({
      full_name: 'a/b', topics: ['react', 'hooks', 'state'], language: 'TypeScript', description: ''
    });
    check('topic pair query first', qTopics[0] === 'topic:react topic:hooks archived:false', qTopics[0]);
    check('single topic + language second', qTopics[1] === 'topic:react language:"TypeScript" archived:false', qTopics[1]);

    const qKeywords = ctx.buildQueries({
      full_name: 'x/markdown-editor', topics: [], language: 'TypeScript',
      description: 'A collaborative markdown editor'
    });
    check('keyword fallback used when no topics',
      qKeywords.length === 1 && qKeywords[0].includes('markdown') && qKeywords[0].includes('in:name,description'),
      JSON.stringify(qKeywords));

    const meta = { topics: ['simulation', 'physics'], language: 'TypeScript' };
    const peer = { topics: ['simulation', 'physics'], language: 'TypeScript', stargazers_count: 50 };
    const famous = { topics: [], language: 'TypeScript', stargazers_count: 500000 };
    check('shared topics outrank raw stars',
      ctx.relevanceScore(meta, peer) > ctx.relevanceScore(meta, famous),
      `peer=${ctx.relevanceScore(meta, peer).toFixed(2)} famous=${ctx.relevanceScore(meta, famous).toFixed(2)}`);
  }

  console.log('\n== offline: full intel flow (mocked API) ==');
  {
    let fetchCount = 0;
    const { send } = buildContext(async (url) => {
      fetchCount++;
      if (url.includes('/repos/')) return fakeResponse({ body: SAMPLE_REPO });
      return fakeResponse({
        body: {
          total_count: 3,
          items: [
            searchItem('acme/rocket', { topics: ['simulation'], stars: 999 }), // self — must be filtered
            searchItem('space/burn', { topics: ['simulation', 'physics'], stars: 40 }),
            searchItem('mega/famous', { topics: [], stars: 900000 })
          ]
        }
      });
    });

    const r = await send({ type: 'GET_REPO_INTEL', owner: 'acme', repo: 'rocket' });
    check('intel ok', r && r.ok === true, JSON.stringify(r).slice(0, 120));
    check('meta slimmed', r.meta.full_name === 'acme/rocket' && r.meta.license === 'MIT');
    check('self excluded from similar', !r.similar.some((s) => s.full_name === 'acme/rocket'));
    check('topical peer ranked above famous repo',
      r.similar[0] && r.similar[0].full_name === 'space/burn',
      r.similar.map((s) => s.full_name).join(','));
    check('similar items carry topics', Array.isArray(r.similar[0].topics));
    check('response exposes hasToken/rate/settings',
      r.hasToken === false && r.rate && r.settings && r.settings.showSimilar === true);

    const countAfterFirst = fetchCount;
    const r2 = await send({ type: 'GET_REPO_INTEL', owner: 'acme', repo: 'rocket' });
    check('second call served from cache (no new fetches)',
      r2.ok && fetchCount === countAfterFirst, `fetches ${countAfterFirst} -> ${fetchCount}`);

    const b1 = await send({ type: 'TOGGLE_BOOKMARK', repo: r.meta });
    const b2 = await send({ type: 'TOGGLE_BOOKMARK', repo: { full_name: 'acme/rocket' } });
    check('bookmark toggles on then off', b1.bookmarked === true && b2.bookmarked === false);

    const rc = await send({ type: 'CLEAR_CACHE' });
    check('clear cache ok', rc.ok === true);
    await send({ type: 'GET_REPO_INTEL', owner: 'acme', repo: 'rocket' });
    check('after clear, fetches happen again', fetchCount > countAfterFirst);
  }

  console.log('\n== offline: error paths ==');
  {
    const { send } = buildContext(async () =>
      fakeResponse({ status: 403, rate: { limit: 60, remaining: 0, reset: 1700000000 } }));
    const r = await send({ type: 'GET_REPO_INTEL', owner: 'a', repo: 'b' });
    check('meta rate-limit surfaces error', r.ok === false && r.error === 'rate_limit' && r.resetAt > 0);
  }
  {
    // Meta succeeds, search rate-limited → partial success.
    const { send } = buildContext(async (url) => {
      if (url.includes('/repos/')) return fakeResponse({ body: SAMPLE_REPO });
      return fakeResponse({ status: 403, rate: { limit: 30, remaining: 0, reset: 1700000000 } });
    });
    const r = await send({ type: 'GET_REPO_INTEL', owner: 'acme', repo: 'rocket' });
    check('search rate-limit is partial (meta still returned)',
      r.ok === true && r.meta.full_name === 'acme/rocket' && r.similarError === 'rate_limit');
  }
  {
    const { send } = buildContext(async () => fakeResponse({ status: 404 }));
    const r = await send({ type: 'GET_REPO_INTEL', owner: 'no', repo: 'pe' });
    check('404 → not_found', r.ok === false && r.error === 'not_found');
  }
  {
    const { send } = buildContext(async () => {
      const e = new Error('timed out');
      e.name = 'TimeoutError';
      throw e;
    });
    const r = await send({ type: 'GET_REPO_INTEL', owner: 'slow', repo: 'api' });
    check('timeout → timeout error', r.ok === false && r.error === 'timeout');
  }
  {
    const { send } = buildContext(async () => fakeResponse({ status: 401 }));
    const r = await send({ type: 'TEST_TOKEN', token: 'bad' });
    check('401 → bad_token', r.ok === false && r.error === 'bad_token');
  }

  console.log('\n== offline: topic ranking quality ==');
  {
    const { ctx } = buildContext(async () => fakeResponse({}));
    const ranked = ctx.rankTopics({
      full_name: 'pmndrs/zustand',
      description: 'Bear necessities for state management in React',
      topics: ['hacktoberfest', 'hooks', 'react', 'state-management']
    });
    check('generic topics (hacktoberfest) excluded', !ranked.includes('hacktoberfest'), ranked.join(','));
    check('description-echoed topic ranked first', ranked[0] === 'state-management', ranked.join(','));

    const ranked2 = ctx.rankTopics({
      full_name: 'pmndrs/zustand',
      description: 'Bear necessities for state management in React',
      topics: ['react-context', 'react', 'state-management']
    });
    check('full match outranks partial compound match',
      ranked2.indexOf('react') < ranked2.indexOf('react-context'), ranked2.join(','));
  }

  console.log('\n== offline: personalization engine ==');
  {
    let fetchCount = 0;
    const { send } = buildContext(async (url) => {
      fetchCount++;
      if (url.includes('/repos/')) return fakeResponse({ body: SAMPLE_REPO });
      return fakeResponse({
        body: {
          total_count: 3,
          items: [
            searchItem('space/burn', { topics: ['simulation', 'physics'], stars: 500 }),
            searchItem('orbit/calc', { topics: ['simulation'], stars: 480, language: 'Rust' }),
            searchItem('games/arcade', { topics: ['gamedev'], stars: 490 })
          ]
        }
      });
    });

    const r1 = await send({ type: 'GET_REPO_INTEL', owner: 'acme', repo: 'rocket' });
    const order1 = r1.similar.map((s) => s.full_name);
    check('baseline ranking by relevance', order1[0] === 'space/burn', order1.join(','));

    // Like a Rust repo → its language/topics gain weight.
    const rustItem = r1.similar.find((s) => s.full_name === 'orbit/calc');
    await send({ type: 'PREF_FEEDBACK', action: 'like', repo: rustItem });
    const r2 = await send({ type: 'GET_REPO_INTEL', owner: 'acme', repo: 'rocket' });
    check('liked repo flagged', r2.similar.find((s) => s.full_name === 'orbit/calc').liked === true);

    // Repeated "More of #gamedev" should lift the gamedev repo (weights are
    // capped, so one click nudges and repetition escalates).
    await send({ type: 'PREF_FEEDBACK', action: 'more_topic', topic: 'gamedev' });
    await send({ type: 'PREF_FEEDBACK', action: 'more_topic', topic: 'gamedev' });
    await send({ type: 'PREF_FEEDBACK', action: 'more_topic', topic: 'gamedev' });
    const r3 = await send({ type: 'GET_REPO_INTEL', owner: 'acme', repo: 'rocket' });
    const gamedevRank = r3.similar.findIndex((s) => s.full_name === 'games/arcade');
    const before = order1.indexOf('games/arcade');
    check('"more of topic" lifts matching repos', gamedevRank < before,
      `${before} -> ${gamedevRank}: ${r3.similar.map((s) => s.full_name).join(',')}`);

    // Dislike hides instantly from cached pool (no new fetch).
    const fetchesBefore = fetchCount;
    await send({ type: 'PREF_FEEDBACK', action: 'dislike', repo: { full_name: 'space/burn', topics: ['simulation'] } });
    const r4 = await send({ type: 'GET_REPO_INTEL', owner: 'acme', repo: 'rocket' });
    check('disliked repo hidden from similar', !r4.similar.some((s) => s.full_name === 'space/burn'));
    check('hide applied with zero extra API calls', fetchCount === fetchesBefore);

    await send({ type: 'PREF_FEEDBACK', action: 'undo_hide', repo: { full_name: 'space/burn', topics: ['simulation'] } });
    const r5 = await send({ type: 'GET_REPO_INTEL', owner: 'acme', repo: 'rocket' });
    check('undo restores hidden repo', r5.similar.some((s) => s.full_name === 'space/burn'));

    // Notes.
    const n1 = await send({ type: 'SAVE_NOTE', full_name: 'acme/rocket', text: '  check the fuel model  ' });
    const r6 = await send({ type: 'GET_REPO_INTEL', owner: 'acme', repo: 'rocket' });
    check('note saved and returned in intel', n1.hasNote === true && r6.note === 'check the fuel model');
    const n2 = await send({ type: 'SAVE_NOTE', full_name: 'acme/rocket', text: '' });
    const r7 = await send({ type: 'GET_REPO_INTEL', owner: 'acme', repo: 'rocket' });
    check('empty note deletes', n2.hasNote === false && r7.note === '');

    // Reset wipes the profile.
    await send({ type: 'RESET_PREFS' });
    const p = await send({ type: 'GET_PREFS' });
    check('reset clears profile',
      Object.keys(p.prefs.topics).length === 0 && Object.keys(p.prefs.hiddenRepos).length === 0);
  }

  console.log('\n== offline: privacy-first data portability ==');
  {
    const { send, local } = buildContext(async () => fakeResponse({}));
    local.set('settings', {
      token: 'github_pat_secret', showSimilar: false, showStats: true,
      showClone: true, showOpenIn: false, showHovercards: true, personalize: true
    });
    local.set('bookmarks', [{
      full_name: 'acme/rocket', html_url: 'https://github.com/acme/rocket',
      description: 'A rocket engine simulator', language: 'TypeScript',
      stargazers_count: 1200, addedAt: 1700000000000
    }]);
    local.set('recent', []);
    local.set('notes', { 'acme/rocket': { text: 'Review later', updatedAt: 1700000000000 } });
    local.set('prefs', {
      topics: { simulation: 2 }, languages: {}, owners: {},
      likedRepos: {}, hiddenRepos: {}
    });
    local.set('meta:acme/rocket', { t: Date.now(), v: SAMPLE_REPO });

    const exported = await send({ type: 'EXPORT_DATA' });
    check('export includes portable user data',
      exported.ok && exported.exportData.app === 'OctoLens' &&
      exported.exportData.data.bookmarks[0].full_name === 'acme/rocket');
    check('export excludes token and API cache',
      exported.ok && !('token' in exported.exportData.data.settings) &&
      !JSON.stringify(exported.exportData).includes('github_pat_secret') &&
      !JSON.stringify(exported.exportData).includes('meta:acme/rocket'));

    const imported = await send({
      type: 'IMPORT_DATA',
      importData: {
        app: 'OctoLens', schemaVersion: 1, exportedAt: '2026-08-11T00:00:00.000Z',
        data: {
          bookmarks: [{
            full_name: 'space/burn', html_url: 'javascript:alert(1)',
            description: 'Orbital simulator', language: 'Rust',
            stargazers_count: Number.MAX_VALUE, addedAt: Number.MAX_VALUE
          }],
          recent: [],
          notes: { 'space/burn': { text: '  Useful model  ', updatedAt: 1700000000001 } },
          prefs: {
            topics: { orbital: 99 }, languages: {}, owners: {},
            likedRepos: {}, hiddenRepos: {}
          },
          settings: {
            showSimilar: true, showStats: false, showClone: true,
            showOpenIn: true, showHovercards: false, personalize: true,
            token: 'attacker-token'
          }
        }
      }
    });
    check('valid import is accepted and normalized',
      imported.ok && local.get('bookmarks')[0].html_url === 'https://github.com/space/burn' &&
      local.get('bookmarks')[0].stargazers_count === Number.MAX_SAFE_INTEGER &&
      local.get('bookmarks')[0].addedAt === Number.MAX_SAFE_INTEGER &&
      local.get('notes')['space/burn'].text === 'Useful model' &&
      local.get('prefs').topics.orbital === 5);
    check('import preserves the existing token',
      local.get('settings').token === 'github_pat_secret');

    const invalid = await send({
      type: 'IMPORT_DATA',
      importData: { app: 'OctoLens', schemaVersion: 99, data: {} }
    });
    check('unknown import schema is rejected without changing data',
      invalid.ok === false && invalid.error === 'invalid_import' &&
      local.get('bookmarks')[0].full_name === 'space/burn');
  }

  console.log('\n== offline: request coalescing ==');
  {
    let fetchCount = 0;
    const { send } = buildContext(async (url) => {
      fetchCount++;
      await new Promise((r) => setTimeout(r, 30));
      if (url.includes('/repos/')) return fakeResponse({ body: SAMPLE_REPO });
      return fakeResponse({ body: { total_count: 0, items: [] } });
    });
    const [m1, m2, m3] = await Promise.all([
      send({ type: 'GET_REPO_META', owner: 'acme', repo: 'rocket' }),
      send({ type: 'GET_REPO_META', owner: 'acme', repo: 'rocket' }),
      send({ type: 'GET_REPO_META', owner: 'acme', repo: 'rocket' })
    ]);
    check('3 concurrent meta requests → 1 fetch',
      fetchCount === 1 && m1.ok && m2.ok && m3.ok, `fetches=${fetchCount}`);
  }
}

// ---------------------------------------------------------------- live tests

async function liveTests() {
  console.log('\n== live: GitHub API round-trip ==');
  let fetchCount = 0;
  const counting = (...args) => { fetchCount++; return fetch(...args); };
  const { send } = buildContext(counting);

  const r = await send({ type: 'GET_REPO_INTEL', owner: 'pmndrs', repo: 'zustand' });
  check('live intel ok', r && r.ok === true, r && r.error);
  if (r && r.ok) {
    check('live meta correct', r.meta.full_name.toLowerCase() === 'pmndrs/zustand');
    check('live similar found', Array.isArray(r.similar) && r.similar.length >= 3,
      `got ${r.similar.length}`);
    check('live similar excludes self',
      !r.similar.some((s) => s.full_name.toLowerCase() === 'pmndrs/zustand'));
    console.log('      similar → ' + r.similar.map((s) => s.full_name).join(', '));
  }

  const before = fetchCount;
  const r2 = await send({ type: 'GET_REPO_INTEL', owner: 'pmndrs', repo: 'zustand' });
  check('live second call cached', r2.ok && fetchCount === before);

  const s = await send({ type: 'SEARCH_REPOS', q: 'zustand' });
  check('live search ok', s.ok && s.items.length > 0 && s.total > 0);
  check('live search finds zustand',
    s.items.some((i) => i.full_name.toLowerCase() === 'pmndrs/zustand'),
    s.items.map((i) => i.full_name).join(', '));

  const t = await send({ type: 'TEST_TOKEN', token: '' });
  check('live rate_limit endpoint ok', t.ok === true && t.core > 0, JSON.stringify(t));
}

// ---------------------------------------------------------------- run

await offlineTests();
if (LIVE) await liveTests();
else console.log('\n(skipping live tests — pass --live to include them)');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
