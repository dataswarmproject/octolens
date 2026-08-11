// OctoLens content script: injects a native-looking "Similar repositories"
// strip at the top of GitHub repo pages (above the file browser, like a
// sponsored slot above search results), plus repo hovercards on links.
// Works on both GitHub layouts (classic server-rendered and the React
// rewrite) and survives Turbo / soft-nav / React SPA navigation.

(() => {
  'use strict';

  const PANEL_ID = 'octolens-panel';

  // Top-level GitHub paths that are NOT user/org names.
  const RESERVED = new Set([
    'about', 'account', 'apps', 'assets', 'blog', 'codespaces', 'collections',
    'contact', 'customer-stories', 'dashboard', 'enterprise', 'events',
    'explore', 'features', 'gist', 'github', 'issues', 'join', 'login',
    'logout', 'marketplace', 'new', 'notifications', 'orgs', 'organizations',
    'pricing', 'pulls', 'readme', 'search', 'security', 'sessions',
    'settings', 'signup', 'sponsors', 'stars', 'team', 'topics', 'trending',
    'users', 'watching'
  ]);

  const LANG_COLORS = {
    javascript: '#f1e05a', typescript: '#3178c6', python: '#3572A5',
    java: '#b07219', go: '#00ADD8', rust: '#dea584', c: '#555555',
    'c++': '#f34b7d', 'c#': '#178600', php: '#4F5D95', ruby: '#701516',
    swift: '#F05138', kotlin: '#A97BFF', dart: '#00B4AB', shell: '#89e051',
    html: '#e34c26', css: '#563d7c', vue: '#41b883', svelte: '#ff3e00',
    elixir: '#6e4a7e', scala: '#c22d40', haskell: '#5e5086', lua: '#000080',
    r: '#198CE7', julia: '#a270ba', zig: '#ec915c',
    'jupyter notebook': '#DA5B0B', 'objective-c': '#438eff', perl: '#0298c3',
    ocaml: '#ef7a08', clojure: '#db5855', erlang: '#B83998', nim: '#ffc200'
  };

  const ICONS = {
    lens: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="6.8" cy="6.8" r="4.3"/><path d="M10.2 10.2 L14 14"/></svg>',
    star: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M8 1.5l2 4.1 4.5.6-3.2 3.2.7 4.5L8 11.8l-4 2.1.7-4.5L1.5 6.2 6 5.6z"/></svg>',
    starFill: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M8 1.5l2 4.1 4.5.6-3.2 3.2.7 4.5L8 11.8l-4 2.1.7-4.5L1.5 6.2 6 5.6z"/></svg>',
    refresh: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.5v3h-3"/></svg>',
    chevron: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10l4-4 4 4"/></svg>',
    starSmall: '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 .8l2.1 4.4 4.9.7-3.5 3.4.8 4.9L8 11.9l-4.3 2.3.8-4.9L1 5.9l4.9-.7z"/></svg>',
    thumbUp: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M5.5 7.5v6H3v-6h2.5zm0 0l2.2-4.6a1.2 1.2 0 0 1 2.3.5V6h2.6a1.2 1.2 0 0 1 1.2 1.4l-.8 4.6a1.2 1.2 0 0 1-1.2 1H5.5"/></svg>',
    thumbDown: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M10.5 8.5v-6H13v6h-2.5zm0 0l-2.2 4.6a1.2 1.2 0 0 1-2.3-.5V10H3.4a1.2 1.2 0 0 1-1.2-1.4l.8-4.6a1.2 1.2 0 0 1 1.2-1h6.3"/></svg>',
    dots: '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><circle cx="8" cy="3" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="8" cy="13" r="1.4"/></svg>',
    note: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2.5" y="2" width="11" height="12" rx="1.5"/><path d="M5 5.5h6M5 8h6M5 10.5h3.5"/></svg>'
  };

  let currentKey = null;      // "owner/repo" the strip currently belongs to
  let debounceTimer = null;
  let retryCount = 0;
  let lastHref = location.href;

  // ------------------------------------------------------------- helpers

  function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c) node.append(c);
    return node;
  }

  // Only used with the constant strings in ICONS — never with page data.
  function svg(name, cls) {
    const span = h('span', { class: `ol-icon ${cls || ''}` });
    span.innerHTML = ICONS[name];
    return span;
  }

  function formatCount(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'm';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  function relTime(dateStr) {
    if (!dateStr) return '—';
    const s = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
    if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))}mo ago`;
    return `${(s / (86400 * 365)).toFixed(1).replace(/\.0$/, '')}y ago`;
  }

  function repoAge(dateStr) {
    if (!dateStr) return '—';
    const days = (Date.now() - new Date(dateStr).getTime()) / 86400000;
    if (days < 60) return `${Math.max(1, Math.floor(days))}d old`;
    if (days < 365) return `${Math.floor(days / 30)}mo old`;
    return `${(days / 365).toFixed(1).replace(/\.0$/, '')}y old`;
  }

  function humanSize(kb) {
    if (kb >= 1024 * 1024) return (kb / 1024 / 1024).toFixed(1) + ' GB';
    if (kb >= 1024) return (kb / 1024).toFixed(1) + ' MB';
    return kb + ' KB';
  }

  function langDot(language) {
    const color = LANG_COLORS[(language || '').toLowerCase()] || '#8b949e';
    return h('span', { class: 'ol-lang-dot', style: `background:${color}` });
  }

  function avatarUrl(u) {
    if (!u) return '';
    return u + (u.includes('?') ? '&' : '?') + 's=48';
  }

  // ------------------------------------------------------------- page detection

  function repoFromPath() {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts.length !== 2) return null;
    const [owner, repo] = parts;
    if (RESERVED.has(owner.toLowerCase())) return null;
    if (!/^[A-Za-z0-9-]+$/.test(owner)) return null;
    if (!/^[A-Za-z0-9._-]+$/.test(repo)) return null;
    return { owner, repo };
  }

  // Both the classic and the React repo layouts render inside
  // .repository-content; prepending there puts the strip above the file
  // browser (and the About sidebar) on either layout.
  function findMount() {
    return document.querySelector('.repository-content');
  }

  function removePanel() {
    const existing = document.getElementById(PANEL_ID);
    if (existing) existing.remove();
  }

  // ------------------------------------------------------------- strip shell

  async function sendFeedback(payload) {
    try {
      return await chrome.runtime.sendMessage({ type: 'PREF_FEEDBACK', ...payload });
    } catch {
      return null;
    }
  }

  // Re-fetch (cached) intel and re-render body + foot only — no skeleton, no
  // shell rebuild. Used after preference feedback so ranking updates live.
  async function refreshCards() {
    const target = repoFromPath();
    const root = document.getElementById(PANEL_ID);
    if (!target || !root) return;
    let resp = null;
    try {
      resp = await chrome.runtime.sendMessage({
        type: 'GET_REPO_INTEL', owner: target.owner, repo: target.repo
      });
    } catch { return; }
    if (!resp || !resp.ok) return;
    const state = {
      meta: resp.meta, similar: resp.similar, similarError: resp.similarError,
      resetAt: resp.resetAt, hasToken: resp.hasToken, rate: resp.rate, note: resp.note
    };
    const body = root.querySelector('.ol-strip-body');
    const foot = root.querySelector('.ol-strip-foot');
    if (body && resp.settings.showSimilar) renderCards(body, state);
    if (foot) renderFoot(foot, state, target, resp.settings);
  }

  function toggleNoteEditor(root, target, state) {
    const existing = root.querySelector('.ol-note-editor');
    if (existing) {
      existing.remove();
      return;
    }
    const ta = h('textarea', {
      class: 'ol-note-ta',
      placeholder: 'Private note about this repo — stays on your device.',
      'aria-label': 'Private note'
    });
    ta.value = state.note || '';
    const saveBtn = h('button', {
      class: 'ol-mini',
      text: 'Save note',
      onclick: async () => {
        try {
          await chrome.runtime.sendMessage({
            type: 'SAVE_NOTE',
            full_name: `${target.owner}/${target.repo}`,
            text: ta.value
          });
        } catch { return; }
        state.note = ta.value.trim();
        const noteBtn = root.querySelector('.ol-notebtn');
        if (noteBtn) noteBtn.classList.toggle('ol-has-note', !!state.note);
        saveBtn.textContent = '✓ Saved';
        setTimeout(() => { saveBtn.textContent = 'Save note'; }, 1400);
      }
    });
    const editor = h('div', { class: 'ol-note-editor' }, ta,
      h('div', { class: 'ol-note-actions' }, saveBtn));
    root.querySelector('.ol-strip-head').after(editor);
    ta.focus();
  }

  function buildShell(target, state) {
    const root = h('div', { id: PANEL_ID, class: 'ol-strip' });

    const noteBtn = h('button', {
      class: 'ol-iconbtn ol-notebtn' + (state.note ? ' ol-has-note' : ''),
      title: 'Private note (only on this device)',
      'aria-label': 'Toggle private note editor',
      onclick: () => toggleNoteEditor(root, target, state)
    }, svg('note'));

    const bookmarkBtn = h('button', {
      class: 'ol-iconbtn ol-bookmark' + (state.bookmarked ? ' ol-active' : ''),
      title: state.bookmarked ? 'Remove OctoLens bookmark' : 'Bookmark this repo in OctoLens',
      'aria-label': 'Toggle OctoLens bookmark',
      onclick: async () => {
        try {
          const resp = await chrome.runtime.sendMessage({
            type: 'TOGGLE_BOOKMARK',
            repo: state.meta || { full_name: `${target.owner}/${target.repo}` }
          });
          if (resp && resp.ok) applyBookmarkState(resp.bookmarked);
        } catch { /* extension reloaded */ }
      }
    }, svg(state.bookmarked ? 'starFill' : 'star'));

    const refreshBtn = h('button', {
      class: 'ol-iconbtn',
      title: 'Refresh (bypass cache)',
      'aria-label': 'Refresh OctoLens data',
      onclick: () => { void main(true); }
    }, svg('refresh'));

    const collapseBtn = h('button', {
      class: 'ol-iconbtn ol-collapse-btn',
      title: 'Collapse (Alt+Shift+O)',
      'aria-label': 'Collapse OctoLens strip',
      'aria-expanded': 'true',
      onclick: () => { void toggleCollapsed(); }
    }, svg('chevron'));

    const head = h('div', { class: 'ol-strip-head' },
      h('span', { class: 'ol-strip-title' },
        svg('lens'),
        h('span', { text: state.title }),
        h('span', { class: 'ol-badge', text: 'OctoLens' })
      ),
      h('span', { class: 'ol-spacer' }),
      refreshBtn, noteBtn, bookmarkBtn, collapseBtn
    );

    const body = h('div', { class: 'ol-strip-body' });
    const foot = h('div', { class: 'ol-strip-foot' });
    root.append(head, body, foot);

    if (state.collapsed) {
      root.classList.add('ol-collapsed');
      collapseBtn.setAttribute('aria-expanded', 'false');
      collapseBtn.title = 'Expand';
    }
    return { root, body, foot };
  }

  function applyBookmarkState(marked) {
    const btn = document.querySelector(`#${PANEL_ID} .ol-bookmark`);
    if (!btn) return;
    btn.classList.toggle('ol-active', marked);
    btn.replaceChildren(svg(marked ? 'starFill' : 'star'));
    btn.title = marked ? 'Remove OctoLens bookmark' : 'Bookmark this repo in OctoLens';
  }

  async function toggleCollapsed() {
    const root = document.getElementById(PANEL_ID);
    if (!root) return;
    const collapsed = root.classList.toggle('ol-collapsed');
    const btn = root.querySelector('.ol-collapse-btn');
    if (btn) {
      btn.setAttribute('aria-expanded', String(!collapsed));
      btn.title = collapsed ? 'Expand (Alt+Shift+O)' : 'Collapse (Alt+Shift+O)';
    }
    try { await chrome.storage.local.set({ stripCollapsed: collapsed }); } catch { /* ignore */ }
  }

  // ------------------------------------------------------------- body sections

  function renderSkeleton(body) {
    body.replaceChildren(
      h('div', { class: 'ol-cards' },
        ...Array.from({ length: 3 }, () =>
          h('div', { class: 'ol-card ol-sk-card' },
            h('div', { class: 'ol-sk-line ol-sk-shimmer', style: 'width:55%' }),
            h('div', { class: 'ol-sk-line ol-sk-shimmer', style: 'width:95%' }),
            h('div', { class: 'ol-sk-line ol-sk-shimmer', style: 'width:70%' })
          )
        )
      )
    );
  }

  function note(text) {
    return h('p', { class: 'ol-note', text });
  }

  function renderCards(body, state) {
    if (state.similarError === 'rate_limit') {
      const until = state.resetAt ? new Date(state.resetAt).toLocaleTimeString() : 'soon';
      body.replaceChildren(note(
        `GitHub API rate limit reached (resets ${until}). Add a personal access token via the OctoLens toolbar popup for much higher limits.`
      ));
      return;
    }
    if (state.similarError) {
      body.replaceChildren(note('Could not load similar repositories. Try the refresh button.'));
      return;
    }
    if (!state.similar || state.similar.length === 0) {
      const hint = (state.meta && state.meta.topics && state.meta.topics.length === 0)
        ? ' This repo has no topics, so matching relies on keywords only.'
        : '';
      body.replaceChildren(note(`No similar repositories found.${hint}`));
      return;
    }

    const genericTopic = (t) => {
      const low = t.toLowerCase();
      return low.startsWith('hacktoberfest') || [
        'good-first-issue', 'help-wanted', 'beginner-friendly', 'first-timers-only',
        'up-for-grabs', 'open-source', 'opensource', 'oss', 'community', 'free',
        'awesome', 'awesome-list', 'resources', 'education', 'tutorial', 'examples'
      ].includes(low);
    };
    const myTopics = new Set(
      ((state.meta && state.meta.topics) || [])
        .filter((t) => !genericTopic(t))
        .map((t) => t.toLowerCase())
    );

    const cards = h('div', { class: 'ol-cards' });
    for (const item of state.similar) {
      const meta = h('span', { class: 'ol-card-meta' });
      if (item.language) meta.append(langDot(item.language), h('span', { text: item.language }));
      if (item.language) meta.append(h('span', { class: 'ol-sep', text: '·' }));
      meta.append(
        h('span', { class: 'ol-stars', title: `${(item.stargazers_count || 0).toLocaleString()} stars` },
          svg('starSmall'), h('span', { text: formatCount(item.stargazers_count || 0) }))
      );
      if (item.pushed_at) {
        meta.append(h('span', { class: 'ol-sep', text: '·' }),
          h('span', { text: `updated ${relTime(item.pushed_at)}` }));
      }

      // "Why matched": topics this repo shares with the one being viewed.
      // The row is always rendered (possibly empty) so cards without shared
      // topics keep the same height as the rest.
      const shared = (item.topics || [])
        .filter((t) => !genericTopic(t) && myTopics.has(t.toLowerCase()));
      const tagsRow = h('span', { class: 'ol-card-tags' },
        ...shared.slice(0, 2).map((t) => h('span', { class: 'ol-tag', title: t, text: t })));
      if (shared.length > 2) {
        tagsRow.append(h('span', {
          class: 'ol-tag ol-tag-more',
          title: shared.slice(2).join(', '),
          text: `+${shared.length - 2}`
        }));
      }

      const card = h('a', {
        class: 'ol-card',
        href: item.html_url,
        onclick: (e) => {
          // Implicit interest signal — never blocks navigation.
          if (!e.defaultPrevented) void sendFeedback({ action: 'click', repo: item });
        }
      },
        h('span', { class: 'ol-card-top' },
          item.owner_avatar
            ? h('img', { class: 'ol-avatar', src: avatarUrl(item.owner_avatar), alt: '', loading: 'lazy' })
            : h('span', { class: 'ol-avatar' }),
          h('span', { class: 'ol-card-name', text: item.full_name })
        ),
        item.description ? h('p', { class: 'ol-card-desc', text: item.description }) : h('p', { class: 'ol-card-desc' }),
        tagsRow,
        meta,
        buildCardActions(item, () => card)
      );
      cards.append(card);
    }
    body.replaceChildren(cards);
  }

  // Like / hide / "more of…" controls shown on card hover or focus.
  function buildCardActions(item, getCard) {
    let liked = !!item.liked;

    const likeBtn = h('button', {
      class: 'ol-actbtn ol-like' + (liked ? ' ol-liked' : ''),
      title: liked ? 'Liked — click to undo' : 'Like: more repos like this',
      'aria-label': `Like ${item.full_name}`,
      onclick: async (e) => {
        e.preventDefault();
        e.stopPropagation();
        liked = !liked;
        likeBtn.classList.toggle('ol-liked', liked);
        likeBtn.title = liked ? 'Liked — click to undo' : 'Like: more repos like this';
        await sendFeedback({ action: liked ? 'like' : 'unlike', repo: item });
      }
    }, svg('thumbUp'));

    const hideBtn = h('button', {
      class: 'ol-actbtn',
      title: 'Not interested: hide and show fewer like this',
      'aria-label': `Hide ${item.full_name}`,
      onclick: async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await sendFeedback({ action: 'dislike', repo: item });
        const card = getCard();
        const pill = h('div', { class: 'ol-card ol-hidden-pill' },
          h('span', { text: `Hidden ${item.full_name}` }),
          h('button', {
            class: 'ol-mini',
            text: 'Undo',
            onclick: async () => {
              await sendFeedback({ action: 'undo_hide', repo: item });
              await refreshCards();
            }
          })
        );
        card.replaceWith(pill);
      }
    }, svg('thumbDown'));

    const menuBtn = h('button', {
      class: 'ol-actbtn',
      title: 'More of…',
      'aria-label': `Preference options for ${item.full_name}`,
      'aria-haspopup': 'menu',
      onclick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        const card = getCard();
        const open = card.querySelector('.ol-menu');
        if (open) { open.remove(); return; }
        card.append(buildCardMenu(item));
      }
    }, svg('dots'));

    return h('span', { class: 'ol-card-actions' }, likeBtn, hideBtn, menuBtn);
  }

  function buildCardMenu(item) {
    const owner = item.full_name.split('/')[0];
    const entries = [{ label: 'More like this repo', payload: { action: 'more_like_repo', repo: item } }];
    for (const t of (item.topics || []).slice(0, 2)) {
      entries.push({ label: `More #${t}`, payload: { action: 'more_topic', topic: t } });
    }
    if (item.language) {
      entries.push({ label: `More ${item.language}`, payload: { action: 'more_language', language: item.language } });
    }
    entries.push({ label: `More from ${owner}`, payload: { action: 'more_owner', owner } });

    const menu = h('div', { class: 'ol-menu', role: 'menu' });
    for (const { label, payload } of entries) {
      const itemBtn = h('button', {
        class: 'ol-menu-item',
        role: 'menuitem',
        text: label,
        onclick: async (e) => {
          e.preventDefault();
          e.stopPropagation();
          await sendFeedback(payload);
          itemBtn.textContent = `✓ ${label}`;
          setTimeout(() => menu.remove(), 500);
        }
      });
      menu.append(itemBtn);
    }
    // Close when clicking anywhere else.
    setTimeout(() => {
      document.addEventListener('click', () => menu.remove(), { once: true });
    }, 0);
    return menu;
  }

  // ------------------------------------------------------------- footer sections

  function renderFoot(foot, state, target, settings) {
    foot.replaceChildren();
    const meta = state.meta;
    const groups = [];

    // Warn when the unauthenticated API budget is nearly gone.
    const core = state.rate && state.rate.core;
    if (!state.hasToken && core && core.remaining >= 0 && core.remaining < 10) {
      groups.push(h('span', { class: 'ol-foot-group' },
        h('span', {
          class: 'ol-chip ol-chip-warn',
          title: 'Unauthenticated GitHub API budget is almost used up. Add a token via the OctoLens toolbar popup for 5,000 requests/hour.',
          text: `API low: ${core.remaining} left`
        })));
    }

    if (settings.showStats && meta) {
      const chips = h('span', { class: 'ol-foot-group' },
        h('span', { class: 'ol-chip', title: `Created ${new Date(meta.created_at).toLocaleDateString()}`, text: repoAge(meta.created_at) }),
        h('span', { class: 'ol-chip', title: `Last push ${new Date(meta.pushed_at).toLocaleString()}`, text: `updated ${relTime(meta.pushed_at)}` }),
        h('span', { class: 'ol-chip', title: 'License', text: meta.license || 'no license' }),
        h('span', { class: 'ol-chip', title: 'Repository size', text: humanSize(meta.size) }),
        h('span', { class: 'ol-chip', title: 'Open issues + pull requests', text: `${formatCount(meta.open_issues_count)} open` })
      );
      if (meta.archived) {
        chips.append(h('span', { class: 'ol-chip ol-chip-warn', title: 'This repository is archived', text: 'archived' }));
      }
      groups.push(chips);
    }

    if (settings.showClone && meta) {
      const clone = h('span', { class: 'ol-foot-group' },
        h('span', { class: 'ol-foot-label', text: 'Clone:' }));
      const commands = [
        { label: 'HTTPS', cmd: `git clone ${meta.clone_url}` },
        { label: 'SSH', cmd: `git clone ${meta.ssh_url}` },
        { label: 'gh CLI', cmd: `gh repo clone ${target.owner}/${target.repo}` }
      ];
      for (const { label, cmd } of commands) {
        const btn = h('button', {
          class: 'ol-mini', title: cmd, text: label,
          onclick: async () => {
            let copied = false;
            try {
              await navigator.clipboard.writeText(cmd);
              copied = true;
            } catch {
              const ta = h('textarea', { class: 'ol-offscreen' });
              ta.value = cmd;
              document.body.append(ta);
              ta.select();
              copied = document.execCommand('copy');
              ta.remove();
            }
            if (copied) {
              btn.textContent = '✓ Copied';
              btn.classList.add('ol-copied');
              setTimeout(() => {
                btn.textContent = label;
                btn.classList.remove('ol-copied');
              }, 1400);
            }
          }
        });
        clone.append(btn);
      }
      groups.push(clone);
    }

    if (settings.showOpenIn) {
      const slug = `${target.owner}/${target.repo}`;
      const open = h('span', { class: 'ol-foot-group' },
        h('span', { class: 'ol-foot-label', text: 'Open in:' }));
      const editors = [
        { label: 'github.dev', url: `https://github.dev/${slug}` },
        { label: 'vscode.dev', url: `https://vscode.dev/github/${slug}` },
        { label: 'StackBlitz', url: `https://stackblitz.com/github/${slug}` },
        { label: 'CodeSandbox', url: `https://codesandbox.io/s/github/${slug}` }
      ];
      for (const { label, url } of editors) {
        open.append(h('a', {
          class: 'ol-flink', href: url, target: '_blank',
          rel: 'noopener noreferrer', text: label
        }));
      }
      groups.push(open);
    }

    if (!groups.length) {
      foot.style.display = 'none';
      return;
    }
    foot.style.display = '';
    groups.forEach((g, i) => {
      if (i > 0) foot.append(h('span', { class: 'ol-foot-div', text: '|' }));
      foot.append(g);
    });
  }

  function renderError(body, error) {
    if (error === 'not_found') {
      body.replaceChildren(note('Repo data unavailable (private or not found).'));
    } else if (error === 'rate_limit') {
      body.replaceChildren(note('GitHub API rate limit reached. Add a token via the toolbar popup, or try again later.'));
    } else if (error === 'bad_token') {
      body.replaceChildren(note('Your GitHub token was rejected. Update it via the toolbar popup.'));
    } else if (error === 'timeout') {
      body.replaceChildren(note('The GitHub API timed out. Try the refresh button.'));
    } else {
      body.replaceChildren(note('Could not reach the GitHub API.'));
    }
  }

  // ------------------------------------------------------------- main flow

  async function main(refresh = false) {
    const target = repoFromPath();
    if (!target) {
      removePanel();
      currentKey = null;
      return;
    }
    const key = `${target.owner}/${target.repo}`.toLowerCase();
    if (!refresh && key === currentKey && document.getElementById(PANEL_ID)) return;

    const mount = findMount();
    if (!mount) {
      // Content container not rendered yet (Turbo/React still working) — retry.
      if (retryCount < 10) {
        retryCount++;
        setTimeout(() => { void main(refresh); }, 350);
      }
      return;
    }
    retryCount = 0;
    currentKey = key;

    let collapsed = false;
    let localSettings = {};
    try {
      const stored = await chrome.storage.local.get(['stripCollapsed', 'settings']);
      collapsed = !!stored.stripCollapsed;
      localSettings = stored.settings || {};
    } catch { /* defaults stand */ }

    // If every strip feature is disabled, don't inject anything.
    const anyFeature = ['showSimilar', 'showStats', 'showClone', 'showOpenIn']
      .some((k) => localSettings[k] !== false);
    if (!anyFeature) {
      removePanel();
      return;
    }

    removePanel();
    const state = {
      meta: null, similar: null, similarError: null, resetAt: null,
      bookmarked: false, collapsed,
      title: localSettings.showSimilar !== false ? 'Similar repositories' : 'OctoLens'
    };
    const { root, body, foot } = buildShell(target, state);
    renderSkeleton(body);
    foot.style.display = 'none';
    mount.prepend(root);

    let resp = null;
    try {
      resp = await chrome.runtime.sendMessage({
        type: 'GET_REPO_INTEL',
        owner: target.owner,
        repo: target.repo,
        refresh
      });
    } catch {
      return; // extension was reloaded; this context is dead
    }
    if (currentKey !== key) return;              // navigated away meanwhile
    const liveRoot = document.getElementById(PANEL_ID);
    if (!liveRoot || liveRoot !== root) return;  // replaced by a newer render

    if (!resp || !resp.ok) {
      renderError(body, resp && resp.error);
      return;
    }

    Object.assign(state, {
      meta: resp.meta,
      similar: resp.similar,
      similarError: resp.similarError,
      resetAt: resp.resetAt,
      bookmarked: resp.bookmarked,
      hasToken: resp.hasToken,
      rate: resp.rate,
      note: resp.note || ''
    });

    applyBookmarkState(state.bookmarked);
    const noteBtn = root.querySelector('.ol-notebtn');
    if (noteBtn) noteBtn.classList.toggle('ol-has-note', !!state.note);
    if (resp.settings.showSimilar) {
      renderCards(body, state);
    } else {
      body.style.display = 'none';
    }
    renderFoot(foot, state, target, resp.settings);
  }

  function schedule() {
    clearTimeout(debounceTimer);
    retryCount = 0; // each navigation event gets a fresh retry budget
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void main();
    }, 200);
  }

  // ------------------------------------------------------------- hovercards
  // Rich preview when hovering any github.com/{owner}/{repo} link that
  // GitHub itself doesn't decorate with a native hovercard.

  const CARD_ID = 'octolens-hovercard';
  let hovercardsEnabled = true;
  const hover = { showTimer: null, hideTimer: null, card: null, token: 0 };

  function linkTargetRepo(a) {
    if (!a || !a.href) return null;
    let url;
    try { url = new URL(a.href); } catch { return null; }
    if (url.origin !== 'https://github.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 2) return null;
    let [owner, repo] = parts;
    repo = repo.replace(/\.git$/, '');
    if (RESERVED.has(owner.toLowerCase())) return null;
    if (!/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) return null;
    if (a.hasAttribute('data-hovercard-url')) return null;          // native card exists
    if (a.closest(`#${PANEL_ID}, #${CARD_ID}`)) return null;        // our own UI
    const current = repoFromPath();
    if (current &&
        owner.toLowerCase() === current.owner.toLowerCase() &&
        repo.toLowerCase() === current.repo.toLowerCase()) return null; // link to this page
    return { owner, repo };
  }

  function getCard() {
    if (hover.card && document.body.contains(hover.card)) return hover.card;
    const card = h('div', { id: CARD_ID, role: 'tooltip' });
    card.addEventListener('mouseenter', () => clearTimeout(hover.hideTimer));
    card.addEventListener('mouseleave', scheduleHideCard);
    document.body.append(card);
    hover.card = card;
    return card;
  }

  function positionCard(card, anchor) {
    const r = anchor.getBoundingClientRect();
    card.style.visibility = 'hidden';
    card.style.display = 'block';
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - cw - 8);
    let top = r.bottom + 8;
    if (top + ch > window.innerHeight - 8) top = Math.max(8, r.top - ch - 8);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    card.style.visibility = 'visible';
  }

  function hideCard() {
    clearTimeout(hover.showTimer);
    clearTimeout(hover.hideTimer);
    hover.token++;
    if (hover.card) hover.card.style.display = 'none';
  }

  function scheduleHideCard() {
    clearTimeout(hover.hideTimer);
    hover.hideTimer = setTimeout(hideCard, 250);
  }

  function fillCard(card, meta) {
    const metaRow = h('div', { class: 'ol-card-meta' },
      h('span', { class: 'ol-stars' }, svg('starSmall'),
        h('span', { text: formatCount(meta.stargazers_count) }))
    );
    if (meta.language) {
      metaRow.append(h('span', { class: 'ol-sep', text: '·' }), langDot(meta.language),
        h('span', { text: meta.language }));
    }
    if (meta.pushed_at) {
      metaRow.append(h('span', { class: 'ol-sep', text: '·' }),
        h('span', { text: `updated ${relTime(meta.pushed_at)}` }));
    }
    if (meta.license) {
      metaRow.append(h('span', { class: 'ol-sep', text: '·' }), h('span', { text: meta.license }));
    }
    card.replaceChildren(
      h('div', { class: 'ol-card-top' },
        meta.owner_avatar
          ? h('img', { class: 'ol-avatar', src: avatarUrl(meta.owner_avatar), alt: '' })
          : null,
        h('span', { class: 'ol-card-name', text: meta.full_name }),
        meta.archived ? h('span', { class: 'ol-chip ol-chip-warn', text: 'archived' }) : null
      ),
      meta.description ? h('p', { class: 'ol-card-desc', text: meta.description }) : null,
      metaRow
    );
  }

  async function showHovercard(anchor, target) {
    const token = ++hover.token;
    const card = getCard();
    card.replaceChildren(h('div', { class: 'ol-card-loading', text: `${target.owner}/${target.repo} …` }));
    positionCard(card, anchor);

    let resp = null;
    try {
      resp = await chrome.runtime.sendMessage({
        type: 'GET_REPO_META', owner: target.owner, repo: target.repo
      });
    } catch { /* extension reloaded */ }
    if (token !== hover.token) return;                 // superseded or hidden
    if (!resp || !resp.ok || !resp.meta) { hideCard(); return; }
    fillCard(card, resp.meta);
    positionCard(card, anchor);
  }

  document.addEventListener('mouseover', (e) => {
    if (!hovercardsEnabled) return;
    if (!e.target || typeof e.target.closest !== 'function') return;
    const a = e.target.closest('a[href]');
    const target = linkTargetRepo(a);
    if (!target) return;
    clearTimeout(hover.showTimer);
    hover.showTimer = setTimeout(() => { void showHovercard(a, target); }, 450);
    a.addEventListener('mouseleave', () => {
      clearTimeout(hover.showTimer);
      scheduleHideCard();
    }, { once: true });
  });

  window.addEventListener('scroll', () => {
    if (hover.card && hover.card.style.display === 'block') hideCard();
    else clearTimeout(hover.showTimer);
  }, { capture: true, passive: true });

  (async () => {
    try {
      const { settings = {} } = await chrome.storage.local.get('settings');
      if (typeof settings.showHovercards === 'boolean') hovercardsEnabled = settings.showHovercards;
    } catch { /* defaults stand */ }
  })();

  // ------------------------------------------------------------- wiring

  // Classic GitHub navigates with Turbo; both layouts emit soft-nav events.
  for (const ev of ['turbo:load', 'turbo:render', 'soft-nav:success', 'soft-nav:end']) {
    document.addEventListener(ev, schedule);
  }
  window.addEventListener('popstate', schedule);

  // Safety net for navigation modes with no events (the React layout's
  // client-side router) and for re-renders that swallow the strip.
  // The callback is O(1) and debounced by `schedule`.
  const observer = new MutationObserver(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      schedule();
      return;
    }
    if (debounceTimer) return;
    const target = repoFromPath();
    if (target && !document.getElementById(PANEL_ID)) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Keyboard shortcut relayed from the service worker (chrome.commands).
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'TOGGLE_STRIP') void toggleCollapsed();
  });

  // React to changes made in the popup.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    if (changes.settings) {
      const s = changes.settings.newValue || {};
      if (typeof s.showHovercards === 'boolean') hovercardsEnabled = s.showHovercards;
      if (!hovercardsEnabled) hideCard();
      currentKey = null; // feature toggles changed — rebuild the strip
      schedule();
      return;
    }

    // Bookmark changes only need the star button updated, not a rebuild.
    if (changes.bookmarks) {
      const target = repoFromPath();
      if (!target) return;
      const id = `${target.owner}/${target.repo}`.toLowerCase();
      const marked = (changes.bookmarks.newValue || []).some(
        (b) => b.full_name && b.full_name.toLowerCase() === id
      );
      applyBookmarkState(marked);
    }
  });

  schedule();
})();
