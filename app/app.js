/* Neuralbase bootstrap: config, session, data, router.
   The app is drills-only. Demo mode (no Supabase keys) runs fully local. A
   configured backend with no session redirects to auth.html. No secrets live
   here; config.js holds the public anon key. */

import { isDemo } from './lib/supabase.js';
import * as auth from './lib/auth.js';
import * as db from './lib/db.js';
import * as api from './lib/api.js';
import { audio } from './ui/audio.js';
import * as router from './router.js';

const ANON_KEY = 'cortex.app';

function glob(name) {
  return typeof globalThis !== 'undefined' ? globalThis[name] : undefined;
}

/* The anonymous MVP store shape ({ records, sessions, cards }) for the one-time merge. */
function localAnon() {
  try {
    const raw = localStorage.getItem(ANON_KEY);
    if (!raw) return { records: [], sessions: [], cards: [] };
    const s = JSON.parse(raw) || {};
    return {
      records: Array.isArray(s.records) ? s.records : Array.isArray(s.runs) ? s.runs : [],
      sessions: Array.isArray(s.sessions) ? s.sessions : [],
      cards: Array.isArray(s.cards) ? s.cards : [],
    };
  } catch (e) {
    return { records: [], sessions: [], cards: [] };
  }
}

function fallbackProfile(user) {
  const meta = (user && user.user_metadata) || {};
  const handle = meta.username || (user && user.email ? String(user.email).split('@')[0] : 'demo');
  const themes = glob('Themes');
  return {
    username: handle,
    display_name: meta.display_name || meta.username || 'Demo',
    plan: 'free',
    theme: themes && themes.current ? themes.current() : 'graphite',
    avatar_url: '',
  };
}

function displayNameOf(user, profile) {
  const meta = (user && user.user_metadata) || {};
  return (
    (profile && (profile.display_name || profile.username)) ||
    meta.display_name ||
    meta.username ||
    (user && user.email ? String(user.email).split('@')[0] : 'Account')
  );
}

async function signOut() {
  try { await auth.signOut(); } catch (e) { /* leave the app regardless */ }
  window.location.href = 'auth.html';
}

async function boot() {
  const themes = glob('Themes') || { boot() {}, apply() {}, current() { return 'graphite'; }, has() { return false; } };
  const motion = glob('Motion') || { reduced() { return false; }, reveal() {}, countUp() {}, flash() {} };

  /* ---------- theme ---------- */
  if (themes.boot) themes.boot();

  /* ---------- session ---------- */
  const got = await auth.getSession();
  const session = got && got.ok ? got.session : null;
  const user = session && session.user ? session.user : null;

  if (!user) {
    window.location.replace('auth.html');
    return;
  }

  /* ---------- profile ---------- */
  let profile = null;
  const prof = await db.getProfile();
  if (prof && prof.ok && prof.data) profile = prof.data;
  if (!profile) profile = fallbackProfile(user);

  /* ---------- context ---------- */
  const ctx = {
    user, profile, db, api, audio, themes, motion, navigate: () => {},
    signOut,
    deleteAccount: async function () {
      try { await db.deleteAccount(); } catch (e) {}
      try { await auth.signOut(); } catch (e) {}
    },
  };

  /* drills.js is a classic script; expose the module audio player to it. */
  try { globalThis.CortexAudio = audio; } catch (e) {}

  /* ---------- audio, scheduled at idle by the module ---------- */
  try {
    audio.load();
  } catch (e) {
    /* audio is optional */
  }

  /* ---------- one-time merge of anonymous runs (per-uid flag lives in db.mergeLocal) ---------- */
  if (user && user.id) {
    try {
      await db.mergeLocal(localAnon(), user.id);
    } catch (e) {
      /* a merge failure must never block the shell */
    }
  }

  /* ---------- demo banner ---------- */
  if (isDemo()) {
    const banner = document.getElementById('demoBanner');
    if (banner) banner.hidden = false;
  }

  /* ---------- header: account name and sign out ---------- */
  const nameEl = document.getElementById('accountName');
  if (nameEl) nameEl.textContent = displayNameOf(user, profile);
  const outBtn = document.getElementById('signOutBtn');
  if (outBtn) outBtn.addEventListener('click', signOut);

  /* ---------- router: the single drills view ---------- */
  router.initRouter(ctx);
  ctx.navigate = router.navigate;
  await router.navigate('train');

  /* ---------- react to later auth changes ---------- */
  auth.onAuthChange((event, s) => {
    if (event === 'SIGNED_OUT') {
      window.location.replace('auth.html');
      return;
    }
    if (event === 'SIGNED_IN' && s && s.user) {
      db.mergeLocal(localAnon(), s.user.id).catch(() => {});
    }
  });
}

boot().catch((e) => {
  console.warn('[cortex] boot failed:', e && e.message ? e.message : e);
});
