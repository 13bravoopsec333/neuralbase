/* Neuralbase router: one document, one visible view.
   The app is drills-only now, so there is a single route. navigate() shows the
   drills section and renders app/views/train.js via its render(container, ctx).
   Only modules registered in globalThis.CORTEX_VIEWS (see index.html) are
   imported, so an unbuilt view shows a placeholder instead of firing a request
   that would 404. */

const VIEWS = ['train'];

const LABELS = {
  train: 'Drills',
};

const NOTES = {
  train: 'The drill host and set controls land here.',
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

/* A view that owns something outside its own DOM: a running drill, a bound key,
   a timer. Replacing the children detaches the markup but does not stop any of
   that, so the previous module gets told to let go first. */
function teardown(name) {
  const mod = modules[name];
  if (!mod || typeof mod.teardown !== 'function') return;
  try {
    mod.teardown();
  } catch (e) {
    console.warn('[cortex] view "' + name + '" failed to tear down:', e && e.message ? e.message : e);
  }
}

export async function navigate(view) {
  const name = VIEWS.indexOf(view) !== -1 ? view : 'train';
  showLoader();

  /* Whatever is on screen goes away before the next view is built, so a drill
     cannot keep playing into a detached tree. */
  VIEWS.forEach((v) => {
    if (v === name) return;
    teardown(v);
  });

  VIEWS.forEach((v) => {
    const s = sectionFor(v);
    if (s) s.hidden = v !== name;
  });

  const sec = sectionFor(name);
  if (!sec) return;

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
