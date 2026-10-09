/* Neuralbase app shell (v2): account control, rail + tab navigation, more sheet.
   The markup lives in index.html; mountShell(ctx) fills the account, boots the theme, wires
   every control, and returns a small handle the router uses to keep nav state in step. */

import * as auth from '../lib/auth.js';

const LABELS = {
  dashboard: 'Dashboard',
  onboarding: 'Welcome',
  train: 'Train',
  study: 'Study',
  circuit: 'Circuit',
  progress: 'Progress',
  leaderboards: 'Leaderboards',
  profile: 'Profile',
  settings: 'Settings',
};

const SUBS = {
  dashboard: 'Today at a glance.',
  onboarding: 'Set your goal and baseline.',
  train: 'Pick a drill and run a set.',
  study: 'Cards, due queue, and review.',
  circuit: 'Today\u2019s mix, built or adaptive.',
  progress: 'Trends over time.',
  leaderboards: 'Where you stand, per drill.',
  profile: 'What another player sees about you.',
  settings: '',
};

/* Views reachable from the More sheet (everything that is not a bottom tab). */
const MORE_VIEWS = ['study', 'leaderboards', 'settings'];

function byId(id) {
  return document.getElementById(id);
}

function initialsOf(name) {
  const clean = String(name || '').trim();
  return (clean ? clean[0] : 'A').toUpperCase();
}

export function mountShell(ctx) {
  const themes = ctx.themes || (typeof globalThis !== 'undefined' ? globalThis.Themes : null);

  /* Theme boot: stored preference first, then the account profile. */
  if (themes) {
    if (themes.boot) themes.boot();
    const accountTheme = ctx.profile && ctx.profile.theme;
    if (accountTheme && themes.has && themes.has(accountTheme)) themes.apply(accountTheme);
  }

  /* ---------- account ---------- */
  const user = ctx.user || {};
  const profile = ctx.profile || {};
  const meta = user.user_metadata || {};
  const name =
    profile.display_name ||
    profile.username ||
    meta.display_name ||
    meta.username ||
    (user.email ? String(user.email).split('@')[0] : 'Account');

  const nameEl = byId('accountName');
  if (nameEl) nameEl.textContent = name;

  ['avatarRail', 'avatarMobile'].forEach((id) => {
    const el = byId(id);
    if (!el) return;
    if (profile.avatar_url) {
      el.textContent = '';
      const img = document.createElement('img');
      img.src = profile.avatar_url;
      img.alt = '';
      el.appendChild(img);
    } else {
      el.textContent = initialsOf(name);
    }
  });

  /* Account menu, anchored under whichever account control was clicked. */
  const menu = document.createElement('div');
  menu.className = 'account-menu';
  menu.id = 'accountMenu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;

  const menuItems = [
    { label: 'Profile', run: () => go('profile') },
    { label: 'Sign out', run: signOut, sep: true },
  ];
  menuItems.forEach((item) => {
    if (item.sep) {
      const sep = document.createElement('div');
      sep.className = 'menu-sep';
      sep.setAttribute('aria-hidden', 'true');
      menu.appendChild(sep);
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.textContent = item.label;
    b.addEventListener('click', () => {
      closeMenu();
      item.run();
    });
    menu.appendChild(b);
  });
  document.body.appendChild(menu);

  let menuTrigger = null;

  function openMenu(trigger) {
    const r = trigger.getBoundingClientRect();
    const width = 200;
    menu.style.top = Math.round(r.bottom + 6) + 'px';
    menu.style.left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - width - 12))) + 'px';
    menu.hidden = false;
    menuTrigger = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    const first = menu.querySelector('button');
    if (first) first.focus();
  }

  function closeMenu() {
    if (menu.hidden) return;
    menu.hidden = true;
    if (menuTrigger) menuTrigger.setAttribute('aria-expanded', 'false');
    menuTrigger = null;
  }

  const accountBtn = byId('accountBtn');
  const accountMobile = byId('accountMobile');
  [accountBtn, accountMobile].forEach((trigger) => {
    if (!trigger) return;
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menuTrigger === trigger) closeMenu();
      else openMenu(trigger);
    });
  });

  /* ---------- navigation ---------- */
  function go(view) {
    closeMenu();
    const fromSheet = sheet && !sheet.hidden;
    closeSheet(false);
    if (ctx.navigate) {
      const navigation = ctx.navigate(view);
      if (fromSheet && view === 'settings' && navigation && typeof navigation.then === 'function') {
        navigation.then(() => {
          const destination = byId('view-settings');
          if (destination && !destination.hidden && !destination.querySelector('.view-title')) destination.focus();
        });
      }
    }
  }

  document.querySelectorAll('.navbtn[data-view], .tab[data-view], .sheet-item[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => go(btn.getAttribute('data-view')));
  });

  /* The brand marks are real controls: the grid N goes home from the rail and,
     below 820px, from the topbar. */
  ['railMark', 'tbMark'].forEach((id) => {
    const mark = byId(id);
    if (mark) mark.addEventListener('click', () => go('dashboard'));
  });

  /* ---------- rail peek, hide, and the persisted preference ---------- */
  const rail = byId('rail');
  const railClose = byId('railClose');
  const railReopen = byId('railReopen');
  const RAIL_KEY = 'cortex.rail.closed';

  function railStoredClosed() {
    try { return localStorage.getItem(RAIL_KEY) === '1'; } catch (e) { return false; }
  }

  /* One state, two controls. Closed wins over the expand-on-account rail-open: the
     drawer keeps its width and slides out, and main gives the space back. While it
     is off-screen the rail is inert so nothing invisible stays in the tab order. */
  function applyRail(closed) {
    document.body.classList.toggle('rail-closed', closed);
    if (rail) {
      if (closed) rail.setAttribute('inert', '');
      else rail.removeAttribute('inert');
    }
    if (!closed && window.innerWidth >= 1100) document.body.classList.add('rail-open');
    if (railClose) railClose.setAttribute('aria-expanded', closed ? 'false' : 'true');
    if (railReopen) railReopen.setAttribute('aria-expanded', closed ? 'false' : 'true');
  }

  function setRailClosed(closed) {
    try { localStorage.setItem(RAIL_KEY, closed ? '1' : '0'); } catch (e) { /* degrade */ }
    applyRail(closed);
    /* Closing from the rail leaves focus inside a now-inert drawer, so hand it to
       the reopen control. Reopening hands it back to the close control. */
    if (closed && railReopen) railReopen.focus();
    else if (!closed && railClose && railClose.offsetParent) railClose.focus();
  }

  if (railStoredClosed()) applyRail(true);
  else if (window.innerWidth >= 1100) document.body.classList.add('rail-open');

  if (rail) {
    rail.addEventListener('mouseenter', () => {
      if (!document.body.classList.contains('rail-closed')) document.body.classList.add('rail-open');
    });
    rail.addEventListener('mouseleave', () => {
      if (window.innerWidth < 1100) document.body.classList.remove('rail-open');
    });
    rail.addEventListener('focusin', () => {
      if (!document.body.classList.contains('rail-closed')) document.body.classList.add('rail-open');
    });
  }
  if (railClose) railClose.addEventListener('click', () => setRailClosed(true));
  if (railReopen) railReopen.addEventListener('click', () => setRailClosed(false));

  /* ---------- top right ---------- */
  /* Settings is the last rail item now, so it binds with the other rail buttons above. */

  /* ---------- more sheet ---------- */
  const sheet = byId('moreSheet');
  const moreTab = byId('moreTab');

  function visibleSheetControls() {
    if (!sheet) return [];
    return Array.from(sheet.querySelectorAll('.sheet-card button:not([disabled])'))
      .filter((control) => control.getClientRects().length > 0);
  }

  function openSheet() {
    if (!sheet) return;
    sheet.hidden = false;
    if (moreTab) moreTab.setAttribute('aria-expanded', 'true');
    const first = visibleSheetControls()[0];
    if (first) first.focus();
  }
  function closeSheet(restoreFocus = true) {
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true;
    if (moreTab) moreTab.setAttribute('aria-expanded', 'false');
    if (restoreFocus && moreTab) moreTab.focus();
  }
  if (moreTab) moreTab.addEventListener('click', () => (sheet && sheet.hidden ? openSheet() : closeSheet(true)));
  if (sheet) sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(true); });
  const sheetClose = byId('sheetClose');
  if (sheetClose) sheetClose.addEventListener('click', () => closeSheet(true));
  const sheetSignOut = byId('sheetSignOut');
  if (sheetSignOut) sheetSignOut.addEventListener('click', signOut);

  /* ---------- dismiss ---------- */
  document.addEventListener('click', (e) => {
    if (menu.hidden) return;
    const inMenu = menu.contains(e.target);
    const inTrigger = (accountBtn && accountBtn.contains(e.target)) || (accountMobile && accountMobile.contains(e.target));
    if (!inMenu && !inTrigger) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (sheet && !sheet.hidden && e.key === 'Tab') {
      const controls = visibleSheetControls();
      if (!controls.length) {
        e.preventDefault();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!sheet.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    if (e.key !== 'Escape') return;
    if (!menu.hidden) { closeMenu(); if (menuTrigger) menuTrigger.focus(); return; }
    if (sheet && !sheet.hidden) { closeSheet(true); return; }
    /* Settings reads as an overlay, so Escape puts you back where you came from. */
    const settingsEl = byId('view-settings');
    if (settingsEl && !settingsEl.hidden) go(lastView);
  });

  /* ---------- sign out ---------- */
  async function signOut() {
    closeMenu();
    closeSheet(false);
    try { await auth.signOut(); } catch (e) { /* leave the app regardless */ }
    window.location.href = 'landing.html';
  }

  /* ---------- nav state ---------- */
  /* Where to land when settings is dismissed. Everything but settings counts. */
  let lastView = 'dashboard';

  function setActive(view) {
    if (view !== 'settings') lastView = view;
    document.querySelectorAll('.navbtn[data-view]').forEach((b) => {
      if (b.getAttribute('data-view') === view) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    document.querySelectorAll('.tab[data-view]').forEach((b) => {
      if (b.getAttribute('data-view') === view) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    if (moreTab) {
      if (MORE_VIEWS.indexOf(view) !== -1) moreTab.setAttribute('aria-current', 'page');
      else moreTab.removeAttribute('aria-current');
    }
    const title = byId('tbTitle');
    if (title) title.textContent = LABELS[view] || 'Neuralbase';
    const sub = byId('tbSub');
    if (sub) sub.textContent = SUBS[view] || '';
  }

  return { setActive, closeMenu, closeSheet, name };
}
