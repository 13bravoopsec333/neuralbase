/* Neuralbase view: Settings.
   Three sections. Account: change the username through auth.saveProfile and
   report what it returns. Appearance: switch the theme through the Themes module,
   which is the only thing that owns cortex.theme and data-theme. Session: sign out,
   or delete the account behind a confirm step.

   Reached from the account button in the top bar, not the main nav, so Settings is
   not a fourth top-nav item. Theme tokens only, every theme, no gradients, no
   shadows. Every user string is written with textContent. */

import { saveProfile } from '../lib/auth.js';

/* The two themes the module lists, kept as the last-resort copy. Used only if the
   module is not on the page, so the picker still draws swatches in a bare test
   harness. */
var FALLBACK_THEMES = [
  { name: 'graphite', label: 'Graphite', mode: 'dark', swatch: ['#0f1113', '#b8e04a'] },
  { name: 'porcelain', label: 'Porcelain', mode: 'light', swatch: ['#f7f7f4', '#3f6b00'] }
];

var ctxRef = null;
var ui = {};

function h(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* ---------- theme access ----------
   Themes is a classic script (globalThis.Themes). ctx.themes carries the same
   object in the real app and a smaller stub in tests, so every read falls back to
   a safe default rather than throwing. */
function themeApi() {
  var g = (typeof globalThis !== 'undefined' && globalThis.Themes) || null;
  return g || (ctxRef && ctxRef.themes) || null;
}
function themeList() {
  var T = themeApi();
  if (T && typeof T.list === 'function') {
    try { var l = T.list(); if (l && l.length) return l; } catch (e) { /* fall through */ }
  }
  return FALLBACK_THEMES.slice();
}
function themeCurrent() {
  var T = themeApi();
  if (T && typeof T.current === 'function') { try { return T.current(); } catch (e) { /* fall through */ } }
  if (T && typeof T.get === 'function') { try { var v = T.get(); if (v) return v; } catch (e) { /* fall through */ } }
  return 'graphite';
}
/* apply() writes cortex.theme and data-theme in one call, which is the whole
   persistence story: nothing else needs to store the choice. */
function themeApply(name) {
  var T = themeApi();
  if (T && typeof T.apply === 'function') { try { T.apply(name); return; } catch (e) { /* fall through */ } }
  if (T && typeof T.set === 'function') { try { T.set(name); } catch (e) { /* degrade */ } }
}

/* ---------- identity ---------- */
function meta() {
  var user = ctxRef && ctxRef.user;
  return (user && user.user_metadata) || {};
}
function profileName() {
  var profile = ctxRef && ctxRef.profile;
  var m = meta();
  var user = ctxRef && ctxRef.user;
  return (profile && (profile.display_name || profile.username)) ||
    m.display_name || m.username ||
    (user && user.email ? String(user.email).split('@')[0] : 'Account');
}
function profileUsername() {
  var profile = ctxRef && ctxRef.profile;
  var m = meta();
  var user = ctxRef && ctxRef.user;
  return (profile && profile.username) || m.username ||
    (user && user.email ? String(user.email).split('@')[0] : '');
}

/* Auth errors are codes or, rarely, a sentence ("That username is taken."). Codes
   get plain copy; anything already written for a person is shown as is. */
function friendlyError(err) {
  var s = String(err == null ? '' : err);
  if (s === 'backend_unavailable') return 'Could not reach the server. Try again.';
  if (s === 'no_user') return 'Your session expired. Sign in again.';
  if (s === 'That username is taken.') return s;
  if (s && s.indexOf(' ') !== -1) return s;
  return 'Could not save. Try again.';
}

/* Account deletion fails with a code or, rarely, a sentence. Same split as
   friendlyError, but the fallback is about deleting, not saving. */
function deleteError(err) {
  var s = String(err == null ? '' : err);
  if (s === 'backend_unavailable') return 'Could not reach the server. Try again.';
  if (s === 'no_user') return 'Your session expired. Sign in again.';
  if (s && s.indexOf(' ') !== -1) return s;
  return 'Could not delete the account. Try again.';
}

function setMsg(node, text, kind) {
  if (!node) return;
  node.textContent = text || '';
  node.className = 'nb-set-msg' + (kind ? ' ' + kind : '');
}

/* ---------- account ---------- */
function buildAccountCard() {
  var card = h('section', 'nb-set-card');
  card.appendChild(h('h3', null, 'Account'));

  var current = h('p', 'nb-set-current');
  current.appendChild(document.createTextNode('Signed in as '));
  var nameEl = h('span', 'nb-set-name', profileName());
  current.appendChild(nameEl);
  current.appendChild(document.createTextNode('.'));
  card.appendChild(current);

  var field = h('div', 'nb-set-field');
  var label = h('label', null, 'Username');
  label.setAttribute('for', 'nb-username');
  var input = document.createElement('input');
  input.type = 'text';
  input.id = 'nb-username';
  input.className = 'input';
  input.autocomplete = 'username';
  input.spellcheck = false;
  input.maxLength = 40;
  input.value = profileUsername();
  field.appendChild(label);
  field.appendChild(input);
  card.appendChild(field);

  var actions = h('div', 'nb-set-actions');
  var save = h('button', 'btn-primary', 'Save');
  save.type = 'button';
  var msg = h('span', 'nb-set-msg');
  msg.setAttribute('role', 'status');
  actions.appendChild(save);
  actions.appendChild(msg);
  card.appendChild(actions);

  ui.input = input;
  ui.nameEl = nameEl;
  ui.save = save;
  ui.msg = msg;

  save.addEventListener('click', saveUsername);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); saveUsername(); }
  });
  return card;
}

async function saveUsername() {
  if (!ui.input || !ui.save) return;
  var value = String(ui.input.value || '').trim();
  if (!value) {
    setMsg(ui.msg, 'Enter a username.', 'err');
    if (ui.input.focus) ui.input.focus();
    return;
  }
  if (value === profileUsername()) {
    setMsg(ui.msg, 'That is already your username.', 'ok');
    return;
  }

  ui.save.disabled = true;
  setMsg(ui.msg, '');
  var res = null;
  try { res = await saveProfile({ username: value, display_name: value }); }
  catch (e) { res = { ok: false, error: e }; }
  ui.save.disabled = false;

  if (!res || !res.ok) {
    setMsg(ui.msg, friendlyError(res && res.error), 'err');
    return;
  }

  /* saveProfile writes the backend and the local demo store. The in-memory
     context and the top bar are not part of that write, so they are brought in
     step here or the page keeps showing the old name until a reload. */
  if (ctxRef && ctxRef.profile) {
    ctxRef.profile.username = value;
    ctxRef.profile.display_name = value;
  }
  if (ctxRef && ctxRef.user) {
    ctxRef.user.user_metadata = Object.assign({}, ctxRef.user.user_metadata, {
      username: value, display_name: value,
    });
  }
  if (ui.nameEl) ui.nameEl.textContent = value;
  var top = document.getElementById('accountName');
  if (top) top.textContent = value;
  setMsg(ui.msg, 'Username saved.', 'ok');
}

/* ---------- appearance ---------- */
/* The picker shows the palette, not the name: each theme is a button holding a
   small box split into two halves, that theme's background and accent. The name
   survives as the accessible name and the tooltip, so a screen reader still knows
   which theme a swatch is. The colours come from the theme list's `swatch`, never
   from a hex in this file. */
function swatchButton(t) {
  var pair = t.swatch || [];
  var label = t.label || t.name;
  var b = h('button', 'nb-swatch');
  b.type = 'button';
  b.setAttribute('data-theme-name', t.name);
  b.setAttribute('aria-pressed', t.name === themeCurrent() ? 'true' : 'false');
  b.setAttribute('aria-label', label + ' theme' + (t.mode ? ' (' + t.mode + ')' : ''));
  b.title = label + (t.mode ? ' (' + t.mode + ')' : '');
  for (var i = 0; i < 2; i++) {
    var half = h('span', 'nb-swatch-half');
    half.setAttribute('aria-hidden', 'true');
    if (pair[i]) half.style.backgroundColor = pair[i];
    b.appendChild(half);
  }
  b.addEventListener('click', function () { pickTheme(t.name); });
  return b;
}

function buildAppearanceCard() {
  var card = h('section', 'nb-set-card');
  card.appendChild(h('h3', null, 'Appearance'));

  var row = h('div', 'nb-set-row');
  row.appendChild(h('span', 'nb-set-row-label', 'Theme'));

  var group = h('div', 'nb-seg');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Theme');

  var btns = {};
  themeList().forEach(function (t) {
    var b = swatchButton(t);
    btns[t.name] = b;
    group.appendChild(b);
  });
  ui.themeBtns = btns;
  row.appendChild(group);
  card.appendChild(row);
  return card;
}

function pickTheme(name) {
  themeApply(name);
  if (!ui.themeBtns) return;
  Object.keys(ui.themeBtns).forEach(function (k) {
    ui.themeBtns[k].setAttribute('aria-pressed', k === name ? 'true' : 'false');
  });
}

/* ---------- session ---------- */
function buildSessionCard() {
  var card = h('section', 'nb-set-card');
  card.appendChild(h('h3', null, 'Session'));

  var outRow = h('div', 'nb-set-actions');
  var out = h('button', 'btn-ghost', 'Sign out');
  out.type = 'button';
  out.addEventListener('click', function () {
    if (ctxRef && ctxRef.signOut) ctxRef.signOut();
  });
  outRow.appendChild(out);
  card.appendChild(outRow);

  var danger = h('div', 'nb-set-danger');
  danger.appendChild(h('p', 'nb-set-danger-copy',
    'Deleting your account removes your training data. This cannot be undone.'));

  /* The confirm is a second step on the same card, not a second button: the first
     click only reveals it. Nothing destructive runs until the confirm is pressed. */
  var ask = h('div', 'nb-set-actions');
  var del = h('button', 'nb-set-danger-btn', 'Delete account');
  del.type = 'button';
  ask.appendChild(del);
  danger.appendChild(ask);

  var confirm = h('div', 'nb-set-confirm');
  confirm.hidden = true;
  var confirmCopy = h('p', 'nb-set-confirm-copy', 'Delete your account and everything in it?');
  confirmCopy.setAttribute('role', 'alert');
  confirm.appendChild(confirmCopy);
  var confirmRow = h('div', 'nb-set-actions');
  var yes = h('button', 'nb-set-danger-btn', 'Yes, delete');
  yes.type = 'button';
  var cancel = h('button', 'btn-ghost', 'Cancel');
  cancel.type = 'button';
  confirmRow.appendChild(yes);
  confirmRow.appendChild(cancel);
  confirm.appendChild(confirmRow);
  var dmsg = h('span', 'nb-set-msg');
  dmsg.setAttribute('role', 'status');
  confirm.appendChild(dmsg);
  danger.appendChild(confirm);
  card.appendChild(danger);

  ui.delAsk = ask;
  ui.delConfirm = confirm;
  ui.delYes = yes;
  ui.delCancel = cancel;
  ui.delMsg = dmsg;

  del.addEventListener('click', function () {
    ask.hidden = true;
    confirm.hidden = false;
    setMsg(dmsg, '');
    if (cancel.focus) cancel.focus();
  });
  cancel.addEventListener('click', function () {
    confirm.hidden = true;
    ask.hidden = false;
    if (del.focus) del.focus();
  });
  yes.addEventListener('click', removeAccount);
  return card;
}

async function removeAccount() {
  if (!ui.delYes) return;
  ui.delYes.disabled = true;
  if (ui.delCancel) ui.delCancel.disabled = true;

  /* deleteAccount answers { ok, error }. Existence of the function is not
     success: only res.ok is. A failed delete keeps the session and the data,
     so the user stays on Settings with the reason. */
  var res = null;
  try {
    if (ctxRef && ctxRef.deleteAccount) res = await ctxRef.deleteAccount();
    else res = { ok: false, error: 'unavailable' };
  } catch (e) {
    res = { ok: false, error: (e && e.message) || 'unknown_error' };
  }

  if (!res || !res.ok) {
    ui.delYes.disabled = false;
    if (ui.delCancel) ui.delCancel.disabled = false;
    setMsg(ui.delMsg, deleteError(res && res.error), 'err');
    return;
  }
  /* The account is gone and the session with it, so there is nothing left to
     show. app.js also redirects on SIGNED_OUT; this is the belt to that braces. */
  try { window.location.replace('auth.html'); } catch (e) { /* degrade */ }
}

export function render(container, ctx) {
  ctxRef = ctx || {};
  container.classList.add('view', 'view-mid-wide', 'nb-settings');
  container.setAttribute('aria-label', 'Settings');

  var title = h('h2', 'view-title', 'Settings');
  title.tabIndex = -1;

  var wrap = h('div', 'nb-set-wrap');
  wrap.appendChild(title);
  wrap.appendChild(buildAccountCard());
  wrap.appendChild(buildAppearanceCard());
  wrap.appendChild(buildSessionCard());

  container.replaceChildren();
  container.appendChild(wrap);
}
