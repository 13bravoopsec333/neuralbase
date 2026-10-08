/* Neuralbase friends panel.
   buildFriendsPanel(ctx, options) returns an HTMLElement: a compact header with the
   friend count, one dense row per friend (display name, current streak, sessions
   today, remove), the incoming requests with Accept and Decline, the outgoing
   requests as a quiet "requested" line with Cancel, and an add-friend search.

   options.compact (optional) builds the dashboard summary instead of the full panel:
   at most 3 friend rows, the incoming requests kept, the outgoing requests and the
   full add search collapsed behind a single quiet "Add a friend" row that opens the
   search on demand. The full panel is the default when compact is not set, so any
   other caller is unchanged.

   Data comes from ctx.api (app/lib/api.js):
     friendsList() -> { ok, data: { friends, incoming, outgoing } }
     friendSearch(username) -> { ok, data: [{ userId, username, displayName }] }
     friendRequest(userId) / friendAccept(userId) / friendRemove(userId) -> { ok }
   The friend list carries no streak or session count, so a real backend row is
   enriched through ctx.db.fetchPublicProfile(userId), which is the sanctioned
   cross-user read path (profile_public) and returns null for anything the owner
   chose to hide. A hidden or absent value renders as a plain "activity not shared"
   line, never as a fabricated number.

   Demo mode (no Supabase keys) has one local account, so the api answers empty.
   The panel seeds a small local set of plausible friends for the session and
   mutates it locally, so the panel is not empty and the actions still do something.

   Every action is a real button or input with an accessible label and the global
   :focus-visible outline. Failures resolve to a short plain message and never
   throw. All user text is set with textContent, never innerHTML. */

import { isDemo } from '../lib/supabase.js';

const STYLE_ID = 'nb-friends-styles';
let idSeq = 0;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
}

function todayKey() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function num(v) {
  return typeof v === 'number' && isFinite(v) ? v : -1;
}

function uuid(n) {
  return '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
}

/* A small, plausible local set for the demo. Ids are real uuids so the api's
   isUuid guard accepts them; the names are synthetic. Kept to three friends plus a
   request in each direction so the full panel stays short and the dashboard summary
   has something to show. */
function demoSeed() {
  return {
    friends: [
      { userId: uuid(1), username: 'ada_l', displayName: 'Ada L', streak: 12, sessionsToday: 2, shared: true },
      { userId: uuid(2), username: 'grace_h', displayName: 'Grace H', streak: 9, sessionsToday: 1, shared: true },
      { userId: uuid(3), username: 'alan_t', displayName: 'Alan T', streak: 6, sessionsToday: 3, shared: true },
    ],
    incoming: [{ userId: uuid(6), username: 'margaret_h', displayName: 'Margaret H' }],
    outgoing: [{ userId: uuid(7), username: 'barbara_l', displayName: 'Barbara L' }],
    directory: [
      { userId: uuid(8), username: 'dennis_r', displayName: 'Dennis R' },
      { userId: uuid(9), username: 'radia_p', displayName: 'Radia P' },
      { userId: uuid(10), username: 'shafi_g', displayName: 'Shafi G' },
    ],
  };
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = [
    '.frd{display:flex;flex-direction:column;min-width:0}',
    '.frd-head{display:flex;align-items:baseline;justify-content:space-between;gap:var(--gap-3);margin-bottom:var(--gap-2)}',
    '.frd-title{margin:0;font-size:13px;font-weight:600;letter-spacing:.01em;color:var(--ink)}',
    '.frd-count{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);white-space:nowrap}',
    '.frd-status{margin:0 0 var(--gap-2);font-size:12px;color:var(--muted);min-height:0}',
    '.frd-status:empty{display:none}',
    '.frd-status.err{color:var(--warn)}',
    '.frd-sec{margin-top:var(--gap-3)}',
    '.frd-sec-t{margin:0 0 var(--gap-1);font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}',
    '.frd-list{display:flex;flex-direction:column;border-top:1px solid var(--line)}',
    '.frd-row{display:flex;align-items:center;gap:var(--gap-2);padding:9px 2px;border-bottom:1px solid var(--line);min-width:0}',
    '.frd-id{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1 1 auto}',
    '.frd-name{font-size:13px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.frd-handle{font-family:var(--mono);font-size:11px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.frd-stats{display:flex;align-items:baseline;gap:var(--gap-3);flex:0 0 auto;font-size:12px;color:var(--muted);white-space:nowrap}',
    '.frd-stat b{color:var(--ink);font-weight:600;font-variant-numeric:tabular-nums}',
    '.frd-stat.frd-off{color:var(--dim)}',
    '.frd-btn{background:transparent;border:1px solid var(--line2);color:var(--muted);border-radius:8px;padding:5px 10px;font:inherit;font-size:12px;font-weight:600;white-space:nowrap;flex:0 0 auto;cursor:pointer}',
    '.frd-btn:hover{border-color:var(--lime-edge);color:var(--ink)}',
    '.frd-btn:focus-visible{outline:2px solid var(--lime);outline-offset:2px}',
    '.frd-btn[disabled]{opacity:.45;cursor:not-allowed}',
    '.frd-btn.frd-accept{border-color:var(--lime-edge);color:var(--ink)}',
    '.frd-btn.frd-danger:hover{border-color:var(--warn);color:var(--warn)}',
    '.frd-actions{display:flex;gap:var(--gap-1);flex:0 0 auto}',
    '.frd-out-note{font-size:12px;color:var(--dim);flex:0 0 auto}',
    '.frd-add{margin-top:var(--gap-4);padding-top:var(--gap-3);border-top:1px solid var(--line)}',
    '.frd-add-l{display:block;margin-bottom:5px;font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}',
    '.frd-add-row{display:flex;gap:var(--gap-2);min-width:0}',
    '.frd-input{flex:1 1 auto;min-width:0;background:var(--panel2);border:1px solid var(--line2);color:var(--ink);border-radius:8px;padding:7px 10px;font:inherit;font-size:13px}',
    '.frd-input:focus-visible{outline:2px solid var(--lime);outline-offset:2px;border-color:var(--lime-edge)}',
    '.frd-empty{margin:var(--gap-2) 0 0;font-size:12px;color:var(--dim)}',
    '.frd-results{margin-top:var(--gap-2)}',
    /* Compact summary: tighter rows, no handle, and the add search collapsed behind
       one quiet row. A left rule marks the incoming requests, which carry no heading
       here so the block stays short. Sized so the dashboard section fits a 1440x900
       page with the calendar taking the leftover room. */
    '.frd-compact .frd-head{margin-bottom:2px}',
    '.frd-compact .frd-row{padding:3px 2px}',
    '.frd-compact .frd-btn{padding:4px 9px;font-size:11.5px}',
    '.frd-compact .frd-handle{display:none}',
    '.frd-compact .frd-sec{margin-top:2px}',
    '.frd-compact .frd-incoming .frd-row{border-left:2px solid var(--lime-edge);padding-left:8px}',
    '.frd-add-toggle{display:block;width:100%;text-align:left;background:transparent;border:0;border-top:1px solid var(--line);margin-top:4px;padding:6px 2px 1px;color:var(--muted);font:inherit;font-size:12px;font-weight:600;cursor:pointer}',
    '.frd-add-toggle:hover{color:var(--ink)}',
    '.frd-add-toggle:focus-visible{outline:2px solid var(--lime);outline-offset:2px}',
    '.frd-add.frd-add-hidden{display:none}',
    '@media(max-width:480px){',
    '.frd-row{flex-wrap:wrap}',
    '.frd-id{flex:1 1 100%}',
    '.frd-stats{order:1;gap:var(--gap-2)}',
    '.frd-row>.frd-btn,.frd-row>.frd-actions,.frd-row>.frd-out-note{order:2}',
    '.frd-row>.frd-btn,.frd-row>.frd-actions{margin-left:auto}',
    '}',
  ].join('');
  document.head.appendChild(s);
}

export function buildFriendsPanel(ctx, options) {
  ctx = ctx || {};
  const compact = !!(options && options.compact);
  const api = ctx.api || {};
  const db = ctx.db || null;

  ensureStyles();

  const state = {
    demo: false,
    store: null,
    lists: { friends: [], incoming: [], outgoing: [] },
    gen: 0,
  };

  const root = el('div', compact ? 'frd frd-compact' : 'frd');

  const head = el('div', 'frd-head');
  const count = el('span', 'frd-count', '');
  head.appendChild(el('h3', 'frd-title', 'Friends'));
  head.appendChild(count);
  root.appendChild(head);

  const status = el('p', 'frd-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  root.appendChild(status);

  const body = el('div', 'frd-body');
  const friendsMount = el('div', 'frd-friends');
  const incomingMount = el('div', 'frd-incoming');
  const outgoingMount = el('div', 'frd-outgoing');
  body.appendChild(friendsMount);
  body.appendChild(incomingMount);
  body.appendChild(outgoingMount);
  root.appendChild(body);

  const add = buildAdd();
  if (compact) {
    /* One quiet row in place of the whole search. Opening it swaps the row for the
       real control, so add still works from the dashboard. */
    add.root.classList.add('frd-add-hidden');
    const toggle = el('button', 'frd-add-toggle', 'Add a friend');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Add a friend');
    toggle.addEventListener('click', function () {
      add.root.classList.remove('frd-add-hidden');
      toggle.hidden = true;
      try { add.input.focus(); } catch (e) { /* focus is best effort */ }
    });
    root.appendChild(toggle);
  }
  root.appendChild(add.root);

  function setStatus(msg, isError) {
    status.textContent = msg || '';
    status.classList.toggle('err', !!isError);
  }

  function call(name, id) {
    const fn = api[name];
    if (typeof fn !== 'function') return Promise.resolve({ ok: false });
    return fn(id);
  }

  function stat(value, label) {
    const s = el('span', 'frd-stat');
    s.appendChild(el('b', null, String(value)));
    s.appendChild(document.createTextNode(' ' + label));
    return s;
  }

  function displayOf(person) {
    return person && (person.displayName || person.username) || 'Unknown';
  }

  function friendRow(f) {
    const row = el('div', 'frd-row');
    const id = el('div', 'frd-id');
    id.appendChild(el('span', 'frd-name', displayOf(f)));
    if (f.username && f.username !== f.displayName) id.appendChild(el('span', 'frd-handle mono', f.username));
    row.appendChild(id);

    const stats = el('div', 'frd-stats');
    if (f.streak == null && f.sessionsToday == null) {
      stats.appendChild(el('span', 'frd-stat frd-off', 'activity not shared'));
    } else {
      stats.appendChild(stat(num(f.streak) < 0 ? 0 : f.streak, 'day streak'));
      const n = num(f.sessionsToday) < 0 ? 0 : f.sessionsToday;
      stats.appendChild(stat(n, n === 1 ? 'session today' : 'sessions today'));
    }
    row.appendChild(stats);

    const remove = el('button', 'frd-btn frd-danger', 'Remove');
    remove.type = 'button';
    remove.setAttribute('aria-label', 'Remove ' + displayOf(f));
    remove.addEventListener('click', function () {
      run(remove, function () { return call('friendRemove', f.userId); }, 'Could not remove that friend.', function () {
        demoMutate('remove', f.userId);
      }, 'Friend removed.');
    });
    row.appendChild(remove);
    return row;
  }

  function incomingRow(r) {
    const row = el('div', 'frd-row');
    const id = el('div', 'frd-id');
    id.appendChild(el('span', 'frd-name', displayOf(r)));
    if (r.username && r.username !== r.displayName) id.appendChild(el('span', 'frd-handle mono', r.username));
    row.appendChild(id);

    const actions = el('div', 'frd-actions');
    const accept = el('button', 'frd-btn frd-accept', 'Accept');
    accept.type = 'button';
    accept.setAttribute('aria-label', 'Accept request from ' + displayOf(r));
    accept.addEventListener('click', function () {
      run(accept, function () { return call('friendAccept', r.userId); }, 'Could not accept that request.', function () {
        demoMutate('accept', r.userId);
      }, 'Request accepted.');
    });
    const decline = el('button', 'frd-btn frd-danger', 'Decline');
    decline.type = 'button';
    decline.setAttribute('aria-label', 'Decline request from ' + displayOf(r));
    decline.addEventListener('click', function () {
      run(decline, function () { return call('friendRemove', r.userId); }, 'Could not decline that request.', function () {
        demoMutate('remove', r.userId);
      }, 'Request removed.');
    });
    actions.appendChild(accept);
    actions.appendChild(decline);
    row.appendChild(actions);
    return row;
  }

  function outgoingRow(r) {
    const row = el('div', 'frd-row');
    const id = el('div', 'frd-id');
    id.appendChild(el('span', 'frd-name', displayOf(r)));
    if (r.username && r.username !== r.displayName) id.appendChild(el('span', 'frd-handle mono', r.username));
    row.appendChild(id);
    row.appendChild(el('span', 'frd-out-note', 'requested'));

    const cancel = el('button', 'frd-btn', 'Cancel');
    cancel.type = 'button';
    cancel.setAttribute('aria-label', 'Cancel request to ' + displayOf(r));
    cancel.addEventListener('click', function () {
      run(cancel, function () { return call('friendRemove', r.userId); }, 'Could not cancel that request.', function () {
        demoMutate('remove', r.userId);
      }, 'Request removed.');
    });
    row.appendChild(cancel);
    return row;
  }

  function section(label, mount, rows, rowFn, showHeading) {
    mount.replaceChildren();
    if (!rows.length) return;
    const sec = el('div', 'frd-sec');
    if (showHeading !== false) sec.appendChild(el('h4', 'frd-sec-t', label));
    const list = el('div', 'frd-list');
    rows.forEach(function (r) { list.appendChild(rowFn(r)); });
    sec.appendChild(list);
    mount.appendChild(sec);
  }

  function render() {
    const allFriends = state.lists.friends.slice().sort(function (a, b) {
      return num(b.streak) - num(a.streak);
    });
    const friends = compact ? allFriends.slice(0, 3) : allFriends;
    if (compact && allFriends.length > friends.length) {
      count.textContent = friends.length + ' of ' + allFriends.length + ' friends';
    } else {
      count.textContent = allFriends.length === 1 ? '1 friend' : allFriends.length + ' friends';
    }

    friendsMount.replaceChildren();
    if (!friends.length) {
      friendsMount.appendChild(el('p', 'frd-empty', 'No friends yet. Search a username below to add one.'));
    } else {
      const list = el('div', 'frd-list');
      friends.forEach(function (f) { list.appendChild(friendRow(f)); });
      friendsMount.appendChild(list);
    }

    /* Incoming stays visible in compact; the heading is dropped there so the block
       stays short, and the row carries a left rule instead. Outgoing is a full-panel
       detail and is left out of the dashboard summary. */
    section('Requests', incomingMount, state.lists.incoming, incomingRow, !compact);
    section('Sent', outgoingMount, compact ? [] : state.lists.outgoing, outgoingRow, !compact);
  }

  function storeLists() {
    return {
      friends: state.store.friends.map(function (f) { return Object.assign({}, f); }),
      incoming: state.store.incoming.map(function (f) { return Object.assign({}, f); }),
      outgoing: state.store.outgoing.map(function (f) { return Object.assign({}, f); }),
    };
  }

  function demoMutate(kind, userId) {
    if (!state.demo || !state.store) return;
    const s = state.store;
    if (kind === 'remove') {
      s.friends = s.friends.filter(function (x) { return x.userId !== userId; });
      s.incoming = s.incoming.filter(function (x) { return x.userId !== userId; });
      s.outgoing = s.outgoing.filter(function (x) { return x.userId !== userId; });
    } else if (kind === 'accept') {
      const found = s.incoming.filter(function (x) { return x.userId === userId; })[0];
      s.incoming = s.incoming.filter(function (x) { return x.userId !== userId; });
      if (found) {
        s.friends.push({
          userId: found.userId,
          username: found.username,
          displayName: found.displayName,
          streak: 0,
          sessionsToday: 0,
          shared: true,
        });
      }
    } else if (kind === 'request') {
      const person = s.directory.filter(function (x) { return x.userId === userId; })[0];
      s.directory = s.directory.filter(function (x) { return x.userId !== userId; });
      if (person && !s.outgoing.some(function (x) { return x.userId === person.userId; }) && !s.friends.some(function (x) { return x.userId === person.userId; })) {
        s.outgoing.push({ userId: person.userId, username: person.username, displayName: person.displayName });
      }
    }
  }

  async function enrichFriends() {
    if (state.demo || !db || typeof db.fetchPublicProfile !== 'function') return;
    const today = todayKey();
    await Promise.all(state.lists.friends.map(function (f, i) {
      return Promise.resolve()
        .then(function () { return db.fetchPublicProfile(f.userId); })
        .then(function (r) {
          if (r && r.ok && r.data) {
            const p = r.data;
            state.lists.friends[i] = Object.assign({}, f, {
              streak: typeof p.streak === 'number' ? p.streak : null,
              sessionsToday: p.sessions_per_day ? (p.sessions_per_day[today] || 0) : 0,
              shared: true,
            });
          }
        })
        .catch(function () { /* leave the row unshared, never throw */ });
    }));
  }

  async function load() {
    const g = ++state.gen;
    setStatus('Loading...', false);
    let res;
    try {
      res = api.friendsList ? await api.friendsList() : null;
    } catch (e) {
      res = { ok: false };
    }
    if (g !== state.gen) return;

    if (!res || res.ok !== true) {
      state.lists = { friends: [], incoming: [], outgoing: [] };
      state.demo = false;
      render();
      setStatus('Could not load your friends.', true);
      return;
    }

    const data = res.data || {};
    let lists = {
      friends: Array.isArray(data.friends) ? data.friends.slice() : [],
      incoming: Array.isArray(data.incoming) ? data.incoming.slice() : [],
      outgoing: Array.isArray(data.outgoing) ? data.outgoing.slice() : [],
    };

    const empty = !lists.friends.length && !lists.incoming.length && !lists.outgoing.length;
    if (isDemo() && empty) {
      state.demo = true;
      if (!state.store) state.store = demoSeed();
      lists = storeLists();
    } else {
      state.demo = false;
    }

    state.lists = lists;
    await enrichFriends();
    if (g !== state.gen) return;
    setStatus('', false);
    render();
  }

  async function run(button, fn, failMsg, onOk, okMsg) {
    if (button.disabled) return;
    button.disabled = true;
    setStatus('', false);
    let res;
    try {
      res = await fn();
    } catch (e) {
      res = { ok: false };
    }
    button.disabled = false;
    if (!res || res.ok !== true) {
      setStatus(failMsg, true);
      return;
    }
    if (onOk) onOk();
    await refresh();
    /* Set after the refresh so the load cycle cannot wipe the confirmation. */
    if (okMsg) setStatus(okMsg, false);
  }

  function renderResults(rows, note) {
    add.results.replaceChildren();
    if (!rows.length) {
      add.results.appendChild(el('p', 'frd-empty', note || 'No one by that username. Check the spelling.'));
      return;
    }
    const list = el('div', 'frd-list');
    rows.forEach(function (r) {
      const row = el('div', 'frd-row');
      const id = el('div', 'frd-id');
      id.appendChild(el('span', 'frd-name', displayOf(r)));
      if (r.username && r.username !== r.displayName) id.appendChild(el('span', 'frd-handle mono', r.username));
      row.appendChild(id);
      const btn = el('button', 'frd-btn frd-accept', 'Add');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Add ' + displayOf(r));
      btn.addEventListener('click', function () {
        run(btn, function () { return call('friendRequest', r.userId); }, 'Could not send that request.', function () {
          demoMutate('request', r.userId);
        }, 'Request sent.');
      });
      row.appendChild(btn);
      list.appendChild(row);
    });
    add.results.appendChild(list);
  }

  async function doSearch() {
    const q = (add.input.value || '').trim();
    if (!q) {
      renderResults([], 'Type a username to search.');
      return;
    }
    add.btn.disabled = true;
    setStatus('', false);
    let res;
    try {
      res = api.friendSearch ? await api.friendSearch(q) : null;
    } catch (e) {
      res = { ok: false };
    }
    add.btn.disabled = false;
    if (!res || res.ok !== true) {
      renderResults([], 'Search is unavailable right now.');
      return;
    }
    let rows = Array.isArray(res.data) ? res.data.slice() : [];
    if (state.demo && state.store && !rows.length) {
      const lq = q.toLowerCase();
      rows = state.store.directory.filter(function (p) {
        return p.username.toLowerCase().indexOf(lq) === 0 || p.username.toLowerCase() === lq;
      });
    }
    if (state.demo && state.store) {
      const known = {};
      state.store.friends.concat(state.store.incoming, state.store.outgoing).forEach(function (x) { known[x.userId] = true; });
      rows = rows.filter(function (r) { return !known[r.userId]; });
    }
    renderResults(rows);
  }

  function buildAdd() {
    const wrap = el('div', 'frd-add');
    const inputId = 'frd-q-' + (++idSeq);
    const label = el('label', 'frd-add-l', 'Add a friend');
    label.setAttribute('for', inputId);
    const row = el('div', 'frd-add-row');
    const input = el('input', 'frd-input');
    input.type = 'text';
    input.id = inputId;
    input.setAttribute('placeholder', 'Username');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('aria-label', 'Search by username');
    const btn = el('button', 'frd-btn frd-search', 'Search');
    btn.type = 'button';
    btn.addEventListener('click', function () { doSearch(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSearch();
      }
    });
    row.appendChild(input);
    row.appendChild(btn);
    wrap.appendChild(label);
    wrap.appendChild(row);
    const results = el('div', 'frd-results');
    wrap.appendChild(results);
    return { root: wrap, input: input, btn: btn, results: results };
  }

  async function refresh() {
    add.results.replaceChildren();
    await load();
  }

  root.frdReady = load();
  return root;
}
