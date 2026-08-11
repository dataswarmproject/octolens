// OctoLens popup: search, bookmarks, recent history, settings.

const $ = (id) => document.getElementById(id);

const TABS = ['search', 'bookmarks', 'recent', 'notes', 'settings'];
const TOGGLE_IDS = ['showSimilar', 'showStats', 'showClone', 'showOpenIn', 'showHovercards', 'personalize'];

let searchTimer = null;

// ---------------------------------------------------------------- helpers

function formatCount(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'm';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

async function send(msg) {
  try {
    return await chrome.runtime.sendMessage(msg);
  } catch {
    return null;
  }
}

function openUrl(url) {
  chrome.tabs.create({ url });
}

function repoListItem(item, { removable, onRemove } = {}) {
  const li = document.createElement('li');

  const link = document.createElement('a');
  link.className = 'repo-link';
  link.href = item.html_url;
  link.addEventListener('click', (e) => {
    e.preventDefault();
    openUrl(item.html_url);
  });

  const name = document.createElement('span');
  name.className = 'repo-name';
  name.textContent = item.full_name;
  link.append(name);

  if (item.description) {
    const desc = document.createElement('span');
    desc.className = 'repo-desc';
    desc.textContent = item.description;
    link.append(desc);
  }

  const side = document.createElement('span');
  side.className = 'repo-side';
  const stars = document.createElement('span');
  stars.textContent = `★ ${formatCount(item.stargazers_count || 0)}`;
  side.append(stars);

  li.append(link, side);

  if (removable) {
    const rm = document.createElement('button');
    rm.className = 'rm-btn';
    rm.title = 'Remove';
    rm.setAttribute('aria-label', `Remove ${item.full_name}`);
    rm.textContent = '✕';
    rm.addEventListener('click', () => onRemove(item));
    li.append(rm);
  }
  return li;
}

// ---------------------------------------------------------------- tabs

async function activateTab(tab) {
  for (const t of TABS) {
    document.querySelector(`.tab[data-tab="${t}"]`).classList.toggle('active', t === tab);
    $(`tab-${t}`).classList.toggle('active', t === tab);
  }
  await chrome.storage.local.set({ lastTab: tab });
  if (tab === 'search') $('search-input').focus();
}

// ---------------------------------------------------------------- search

async function runSearch() {
  const q = $('search-input').value.trim();
  const list = $('search-list');
  const status = $('search-status');
  if (!q) {
    list.replaceChildren();
    status.textContent = '';
    return;
  }
  status.textContent = 'Searching…';
  const resp = await send({ type: 'SEARCH_REPOS', q });
  if (!resp || !resp.ok) {
    status.textContent =
      resp && resp.error === 'rate_limit'
        ? 'Rate limit reached — add a token in Settings or wait a minute.'
        : 'Search failed. Check your connection.';
    list.replaceChildren();
    return;
  }
  status.textContent = resp.total
    ? `${resp.total.toLocaleString()} results — showing top ${resp.items.length}`
    : 'No results.';
  list.replaceChildren(...resp.items.map((item) => repoListItem(item)));
}

// ---------------------------------------------------------------- bookmarks & recent

async function renderBookmarks() {
  const { bookmarks = [] } = await chrome.storage.local.get('bookmarks');
  const list = $('bookmark-list');
  $('bookmark-empty').style.display = bookmarks.length ? 'none' : 'block';
  list.replaceChildren(
    ...bookmarks.map((item) =>
      repoListItem(item, {
        removable: true,
        onRemove: async (it) => {
          await send({ type: 'TOGGLE_BOOKMARK', repo: { full_name: it.full_name } });
          await renderBookmarks();
        }
      })
    )
  );
}

async function renderRecent() {
  const { recent = [] } = await chrome.storage.local.get('recent');
  const list = $('recent-list');
  $('recent-empty').style.display = recent.length ? 'none' : 'block';
  $('clear-recent').style.display = recent.length ? 'inline-block' : 'none';
  list.replaceChildren(...recent.map((item) => repoListItem(item)));
}

async function renderNotes() {
  const { notes = {} } = await chrome.storage.local.get('notes');
  const entries = Object.entries(notes)
    .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
  const list = $('note-list');
  $('notes-empty').style.display = entries.length ? 'none' : 'block';
  list.replaceChildren(...entries.map(([fullName, note]) => {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'repo-link';
    link.href = `https://github.com/${fullName}`;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      openUrl(`https://github.com/${fullName}`);
    });
    const name = document.createElement('span');
    name.className = 'repo-name';
    name.textContent = fullName;
    const excerpt = document.createElement('span');
    excerpt.className = 'repo-desc';
    excerpt.textContent = note.text;
    excerpt.title = note.text;
    link.append(name, excerpt);

    const rm = document.createElement('button');
    rm.className = 'rm-btn';
    rm.title = 'Delete note';
    rm.setAttribute('aria-label', `Delete note on ${fullName}`);
    rm.textContent = '✕';
    rm.addEventListener('click', async () => {
      await send({ type: 'SAVE_NOTE', full_name: fullName, text: '' });
      await renderNotes();
    });
    li.append(link, rm);
    return li;
  }));
}

async function renderPrefChips() {
  const resp = await send({ type: 'GET_PREFS' });
  const wrap = $('pref-chips');
  if (!resp || !resp.ok) { wrap.replaceChildren(); return; }
  const { topics = {}, languages = {}, owners = {}, hiddenRepos = {} } = resp.prefs;

  const all = [
    ...Object.entries(topics).map(([k, w]) => ({ kind: 'topics', label: `#${k}`, key: k, w })),
    ...Object.entries(languages).map(([k, w]) => ({ kind: 'languages', label: k, key: k, w })),
    ...Object.entries(owners).map(([k, w]) => ({ kind: 'owners', label: `@${k}`, key: k, w }))
  ]
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
    .slice(0, 10);

  wrap.replaceChildren();
  if (!all.length) {
    const em = document.createElement('span');
    em.className = 'hint';
    em.textContent = 'Nothing learned yet — like a card or pick "More of…" on a repo page.';
    wrap.append(em);
  }
  for (const { kind, label, key, w } of all) {
    const chip = document.createElement('button');
    chip.className = 'pref-chip' + (w < 0 ? ' pref-neg' : '');
    chip.title = `Weight ${w > 0 ? '+' : ''}${w} — click to remove`;
    chip.textContent = `${label} ${w > 0 ? '+' : ''}${w}`;
    chip.addEventListener('click', async () => {
      const p = await send({ type: 'GET_PREFS' });
      if (!p || !p.ok) return;
      delete p.prefs[kind][key];
      await chrome.storage.local.set({ prefs: p.prefs });
      await renderPrefChips();
    });
    wrap.append(chip);
  }

  const hiddenCount = Object.keys(hiddenRepos).length;
  $('unhide-all').textContent = hiddenCount ? `Unhide repos (${hiddenCount})` : 'Unhide repos';
  $('unhide-all').disabled = !hiddenCount;
}

// ---------------------------------------------------------------- settings

async function loadSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  for (const id of TOGGLE_IDS) {
    $(id).checked = settings[id] !== false; // default on
  }
  $('token').value = settings.token || '';
}

async function saveToggles() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  for (const id of TOGGLE_IDS) settings[id] = $(id).checked;
  await chrome.storage.local.set({ settings });
}

async function saveToken() {
  const token = $('token').value.trim();
  const status = $('token-status');
  const { settings = {} } = await chrome.storage.local.get('settings');

  if (!token) {
    settings.token = '';
    await chrome.storage.local.set({ settings });
    status.className = 'status ok';
    status.textContent = 'Token removed — using unauthenticated limits.';
    await renderRate();
    return;
  }

  status.className = 'status';
  status.textContent = 'Testing token…';
  const resp = await send({ type: 'TEST_TOKEN', token });
  if (!resp || !resp.ok) {
    status.className = 'status err';
    status.textContent =
      resp && resp.error === 'bad_token'
        ? 'Token rejected by GitHub — check it and try again.'
        : 'Could not verify token (network error).';
    return;
  }
  settings.token = token;
  await chrome.storage.local.set({ settings });
  status.className = 'status ok';
  status.textContent = `Token saved ✓ (${resp.core.toLocaleString()} core / ${resp.search.toLocaleString()} search per window)`;
  await renderRate();
}

async function renderRate() {
  const resp = await send({ type: 'GET_RATE' });
  const el = $('rate');
  if (resp && resp.ok && resp.rate && resp.rate.core && resp.rate.core.limit > 0) {
    const { remaining, limit } = resp.rate.core;
    el.textContent = `API ${remaining}/${limit}`;
  } else {
    el.textContent = '';
  }
}

// ---------------------------------------------------------------- backup & restore

function setDataStatus(message, kind = '') {
  const status = $('data-status');
  status.className = `status${kind ? ` ${kind}` : ''}`;
  status.textContent = message;
}

async function exportLocalData() {
  setDataStatus('Preparing backup…');
  const resp = await send({ type: 'EXPORT_DATA' });
  if (!resp || !resp.ok || !resp.exportData) {
    setDataStatus('Could not create the backup. Try again.', 'err');
    return;
  }

  const blob = new Blob([JSON.stringify(resp.exportData, null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `octolens-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  setDataStatus('Backup exported. Your token was not included.', 'ok');
}

async function importLocalData(file) {
  if (!file) return;
  if (file.size > 1_000_000) {
    setDataStatus('Backup is too large. OctoLens accepts files up to 1 MB.', 'err');
    return;
  }

  let importData;
  try {
    importData = JSON.parse(await file.text());
  } catch {
    setDataStatus('That file is not valid JSON.', 'err');
    return;
  }

  const confirmed = window.confirm(
    'Import this OctoLens backup? It will replace local bookmarks, history, notes, interests and feature settings. Your GitHub token will stay unchanged.'
  );
  if (!confirmed) {
    setDataStatus('Import cancelled.');
    return;
  }

  setDataStatus('Validating backup…');
  const resp = await send({ type: 'IMPORT_DATA', importData });
  if (!resp || !resp.ok) {
    setDataStatus('Import failed. Choose a valid OctoLens backup file.', 'err');
    return;
  }

  await Promise.all([
    loadSettings(), renderBookmarks(), renderRecent(), renderNotes(), renderPrefChips()
  ]);
  setDataStatus(
    `Imported ${resp.counts.bookmarks} bookmarks, ${resp.counts.notes} notes and ${resp.counts.recent} recent repos.`,
    'ok'
  );
}

// ---------------------------------------------------------------- init

const REPO_URL = 'https://github.com/dataswarmproject/octolens';

document.addEventListener('DOMContentLoaded', async () => {
  $('version').textContent = `OctoLens v${chrome.runtime.getManifest().version}`;
  $('repo-link').addEventListener('click', (e) => {
    e.preventDefault();
    openUrl(REPO_URL);
  });

  for (const btn of document.querySelectorAll('.tab')) {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  }

  $('search-input').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 400);
  });
  $('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(searchTimer);
      runSearch();
    }
  });

  for (const id of TOGGLE_IDS) {
    $(id).addEventListener('change', saveToggles);
  }

  $('save-token').addEventListener('click', saveToken);
  $('token').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveToken();
  });

  $('clear-cache').addEventListener('click', async () => {
    await send({ type: 'CLEAR_CACHE' });
    const el = $('cache-status');
    el.className = 'status ok';
    el.textContent = 'Cache cleared ✓';
    setTimeout(() => { el.textContent = ''; }, 2000);
  });

  $('export-data').addEventListener('click', exportLocalData);
  $('import-data').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async (event) => {
    const [file] = event.target.files;
    event.target.value = '';
    await importLocalData(file);
  });

  $('clear-recent').addEventListener('click', async () => {
    await chrome.storage.local.set({ recent: [] });
    await renderRecent();
  });

  $('unhide-all').addEventListener('click', async () => {
    await send({ type: 'UNHIDE_ALL' });
    await renderPrefChips();
  });

  $('reset-prefs').addEventListener('click', async () => {
    await send({ type: 'RESET_PREFS' });
    await renderPrefChips();
  });

  await Promise.all([
    loadSettings(), renderBookmarks(), renderRecent(),
    renderNotes(), renderPrefChips(), renderRate()
  ]);

  const { lastTab = 'search' } = await chrome.storage.local.get('lastTab');
  await activateTab(TABS.includes(lastTab) ? lastTab : 'search');
});
