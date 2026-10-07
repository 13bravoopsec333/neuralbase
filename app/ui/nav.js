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
  method: 'Method',
  profile: 'Profile',
  settings: 'Settings',
  pricing: 'Upgrade',
};

const SUBS = {
  dashboard: 'Today at a glance.',
  onboarding: 'Set your goal and baseline.',
  train: 'Pick a drill and run a set.',
  study: 'Cards, due queue, and review.',
  circuit: 'Today\u2019s mix, built or adaptive.',
  progress: 'Trends over time.',
  leaderboards: 'Where you stand, per drill.',
  method: 'The evidence and its limits.',
  profile: 'What another player sees about you.',
  settings: '',
  pricing: 'Free and Pro plans.',
};

/* Views reachable from the More sheet (everything that is not a bottom tab). */
const MORE_VIEWS = ['study', 'leaderboards', 'method', 'settings'];

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
  const plan = String(profile.plan || 'free').toLowerCase();

  const nameEl = byId('accountName');
  if (nameEl) nameEl.textContent = name;
  const planEl = byId('accountPlan');
  if (planEl) planEl.textContent = plan === 'pro' ? 'Pro' : 'Free';

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
    closeSheet();
    if (ctx.navigate) ctx.navigate(view);
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
  const upgrade = byId('upgradeBtn');
  if (upgrade) {
    if (plan === 'pro') {
      upgrade.textContent = 'Pro';
      upgrade.classList.remove('btn-ghost');
      /* tag-pro, not tag. Plain .tag is --dim at 10px, which measured a 1.09
         contrast ratio against the topbar, so a Pro subscriber's own badge was
         effectively invisible. tag-pro is the readable variant that already
         existed for exactly this state. */
      upgrade.classList.add('tag-pro');
    }
    upgrade.addEventListener('click', () => go('pricing'));
  }
  /* Settings is the last rail item now, so it binds with the other rail buttons above. */

  /* ---------- more sheet ---------- */
  const sheet = byId('moreSheet');
  const moreTab = byId('moreTab');

  function openSheet() {
    if (!sheet) return;
    sheet.hidden = false;
    if (moreTab) moreTab.setAttribute('aria-expanded', 'true');
    const first = sheet.querySelector('.sheet-item');
    if (first) first.focus();
  }
  function closeSheet() {
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true;
    if (moreTab) moreTab.setAttribute('aria-expanded', 'false');
  }
  if (moreTab) moreTab.addEventListener('click', () => (sheet && sheet.hidden ? openSheet() : closeSheet()));
  if (sheet) sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
  const sheetClose = byId('sheetClose');
  if (sheetClose) sheetClose.addEventListener('click', closeSheet);
  const sheetUpgrade = byId('sheetUpgrade');
  if (sheetUpgrade) sheetUpgrade.addEventListener('click', () => go('pricing'));
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
    if (e.key !== 'Escape') return;
    if (!menu.hidden) { closeMenu(); if (menuTrigger) menuTrigger.focus(); return; }
    if (sheet && !sheet.hidden) { closeSheet(); if (moreTab) moreTab.focus(); return; }
    /* Settings reads as an overlay, so Escape puts you back where you came from. */
    const settingsEl = byId('view-settings');
    if (settingsEl && !settingsEl.hidden) go(lastView);
  });

  /* ---------- sign out ---------- */
  async function signOut() {
    closeMenu();
    closeSheet();
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
    /* A Pro user is not being asked to upgrade, so the topbar should not say so.
       The view itself already switches to a subscription page in that state. */
    const isProPricing = view === 'pricing' && plan === 'pro';
    const title = byId('tbTitle');
    if (title) title.textContent = isProPricing ? 'Subscription' : (LABELS[view] || 'Neuralbase');
    const sub = byId('tbSub');
    if (sub) sub.textContent = isProPricing ? 'Your plan and billing.' : (SUBS[view] || '');
  }

  return { setActive, closeMenu, closeSheet, name, plan };
}
