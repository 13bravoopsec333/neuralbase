/* Neuralbase router: one document, one visible view at a time.
   navigate(name) shows the matching section, hides the rest, and renders the view module
   from app/views/<name>.js via its render(container, ctx). Only modules registered in
   globalThis.CORTEX_VIEWS (see index.html) are imported, so an unbuilt view shows a
   placeholder instead of firing a request that would 404. */

const VIEWS = [
  'dashboard',
  'onboarding',
  'train',
  'study',
  'circuit',
  'programs',
  'progress',
  'leaderboards',
  'method',
  'profile',
  'settings',
  'pricing',
];

const LABELS = {
  dashboard: 'Dashboard',
  onboarding: 'Welcome',
  train: 'Train',
  study: 'Study',
  circuit: 'Circuit',
  programs: 'Programs',
  progress: 'Progress',
  leaderboards: 'Leaderboards',
  method: 'Method',
  profile: 'Profile',
  settings: 'Settings',
  pricing: 'Upgrade',
};

const NOTES = {
  dashboard: 'Your daily goal, stats, and today\u2019s circuit land here.',
  onboarding: 'Pick a goal, then calibrate your starting point.',
  train: 'The drill host and set controls land here.',
  study: 'Your cards, due queue, and review land here.',
  circuit: 'Today\u2019s mix, the builder, and adaptive mode land here.',
  programs: 'The drill browser lands here.',
  progress: 'Trends and records land here.',
  leaderboards: 'Per-drill rankings land here.',
  method: 'The evidence note lands here.',
  profile: 'Your name, plan, and personal records land here.',
  settings: 'Theme, sound, motion, account, and plan land here.',
  pricing: 'Free and Pro plans land here.',
};

const REGISTERED = Array.isArray(globalThis.CORTEX_VIEWS) ? globalThis.CORTEX_VIEWS.slice() : [];

let ctx = null;
const modules = {}; /* name -> module | null, resolved once */

/* Boot and view-change loader. The element lives in index.html; it is non-blocking
   (pointer-events off) and clears once the view has rendered, after a short minimum
   so it reads as a deliberate beat rather than a flicker. */
const LOADER_MIN = 220;
let loaderShownAt = 0;
let loaderTimer = 0;

function loaderEl() {
  return typeof document !== 'undefined' ? document.getElementById('nbLoader') : null;
}
function showLoader() {
  const el = loaderEl();
  if (!el) return;
  clearTimeout(loaderTimer);
  el.classList.remove('nb-loader-out');
  el.hidden = false;
  loaderShownAt = Date.now();
}
function hideLoader() {
  const el = loaderEl();
  if (!el || el.hidden) return;
  const wait = Math.max(0, LOADER_MIN - (Date.now() - loaderShownAt));
  clearTimeout(loaderTimer);
  loaderTimer = setTimeout(() => {
    el.classList.add('nb-loader-out');
    loaderTimer = setTimeout(() => { el.hidden = true; }, 300);
  }, wait);
}

export function initRouter(context) {
  ctx = context;
}

function sectionFor(name) {
  return document.getElementById('view-' + name);
}

async function loadModule(name) {
  if (name in modules) return modules[name];
  let mod = null;
  if (REGISTERED.indexOf(name) !== -1) {
    try {
      mod = await import('./views/' + name + '.js');
    } catch (e) {
      console.warn('[cortex] view "' + name + '" failed to load:', e && e.message ? e.message : e);
      mod = null;
    }
  }
  modules[name] = mod;
  return mod;
}

function placeholder(sec, name) {
  const head = document.createElement('div');
  head.className = 'view-head';
  const h = document.createElement('h2');
  h.className = 'view-title';
  h.tabIndex = -1;
  h.textContent = LABELS[name] || 'Neuralbase';
  head.appendChild(h);
  sec.appendChild(head);

  const card = document.createElement('div');
  card.className = 'card';
  const p = document.createElement('p');
  p.className = 'view-note';
  p.textContent = (NOTES[name] || 'This view is being built.') + ' Not built yet.';
  card.appendChild(p);
  sec.appendChild(card);
}

export async function navigate(view) {
  const name = VIEWS.indexOf(view) !== -1 ? view : 'dashboard';
  showLoader();

  VIEWS.forEach((v) => {
    const s = sectionFor(v);
    if (s) s.hidden = v !== name;
  });

  const sec = sectionFor(name);
  if (!sec) return;

  if (ctx && ctx.shell && ctx.shell.setActive) ctx.shell.setActive(name);

  const mod = await loadModule(name);
  sec.replaceChildren();

  if (mod && typeof mod.render === 'function') {
    try {
      await mod.render(sec, ctx);
    } catch (e) {
      console.warn('[cortex] view "' + name + '" failed to render:', e && e.message ? e.message : e);
      sec.replaceChildren();
      placeholder(sec, name);
    }
  } else {
    placeholder(sec, name);
  }

  if (ctx && ctx.motion && ctx.motion.reveal) ctx.motion.reveal(sec);
  const h = sec.querySelector('.view-title');
  if (h && h.focus) h.focus();
  hideLoader();
}
