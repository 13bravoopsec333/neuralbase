/* Neuralbase v2 auth.
   Every async function returns an envelope: { ok: true, ...payload } or { ok: false, error }.
   Nothing throws. A configured backend that fails is logged with console.warn and returned as
   { ok: false, error }, never silently downgraded to demo/local. Demo mode only happens when
   config.js has no keys (isDemo()). */

import { getClient, isDemo } from './supabase.js';

const DEMO_USER_KEY = 'cortex.demo.user';

/* ---------------- demo helpers ---------------- */

const demoListeners = new Set();

function demoUser({ email, username, dob } = {}) {
  return {
    id: 'demo-user',
    email: email || 'demo@local',
    user_metadata: {
      username: username || 'demo',
      display_name: username || 'demo',
      dob: dob || '',
    },
  };
}

function readDemoUser() {
  try {
    const raw = localStorage.getItem(DEMO_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function writeDemoUser(user) {
  try {
    if (user) localStorage.setItem(DEMO_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(DEMO_USER_KEY);
  } catch (e) {
    /* storage unavailable: demo session lives only for this call */
  }
}

function emit(event, session) {
  demoListeners.forEach((cb) => {
    try {
      cb(event, session);
    } catch (e) {
      console.warn('[cortex] onAuthChange callback failed:', e && e.message ? e.message : e);
    }
  });
}

/* ---------------- pure age gate ---------------- */

function parseDob(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value == null ? '' : value).trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

/* Minimum age to hold an account. One number on purpose: the auth page copy,
   the field errors and the database trigger all have to agree, and three
   separate copies of a threshold is how they quietly drift apart. */
export const MIN_AGE = 16;

/* dob is a date string (YYYY-MM-DD). true only when the person is MIN_AGE or older today. */
export function ageOk(dob) {
  const birth = parseDob(dob);
  if (!birth) return false;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age >= MIN_AGE;
}

/* ---------------- actions ---------------- */

function fail(error) {
  return { ok: false, error: typeof error === 'string' ? error : (error && error.message) || 'unknown_error' };
}

function warn(op, error) {
  console.warn(
    '[cortex] ' + op + ' failed against a configured backend:',
    error && error.message ? error.message : error
  );
}

/* Signup is the one place the app can create an auth user, so it is also the one
   place an email address can be checked against a list. Supabase rejects a
   duplicate address with "User already registered"; that string is the
   enumeration oracle and it is normalized here to a generic failure so it never
   reaches a caller, whatever the caller does with the message. The UI (see
   friendly() in views/auth.js) reads this and shows something neutral. */
function normalizeSignupError(error) {
  const s = typeof error === 'string' ? error : (error && error.message) || '';
  if (/already registered|already been registered|user already exists|user_already/i.test(s)) {
    return 'signup_unavailable';
  }
  return error;
}

export async function signUp({ email, password, username, dob } = {}) {
  if (!ageOk(dob)) return { ok: false, error: 'You must be ' + MIN_AGE + ' or older.' };

  if (isDemo()) {
    const user = demoUser({ email, username, dob });
    writeDemoUser(user);
    const session = { user };
    emit('SIGNED_IN', session);
    return { ok: true, session, user, demo: true };
  }

  const client = getClient();
  if (!client) return fail('backend_unavailable');

  try {
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: new URL('/auth.html', location.origin).href,
        data: { username, dob, display_name: username },
      },
    });
    if (error) {
      warn('signUp', error);
      return fail(normalizeSignupError(error));
    }
    return { ok: true, data, session: data.session || null, user: data.user || null };
  } catch (e) {
    warn('signUp', e);
    return fail(e);
  }
}

/* Complete a signup that Supabase holds behind an email code. The token is the code
   from the confirmation email. In demo mode signUp already returns a session, so this
   step is never reached and this never touches the network. */
export async function verifySignupCode({ email, token } = {}) {
  if (isDemo()) return fail('not_available_in_demo');

  const client = getClient();
  if (!client) return fail('backend_unavailable');

  const mail = String(email == null ? '' : email).trim();
  const code = String(token == null ? '' : token).trim();
  if (!mail) return fail('missing_email');
  if (!code) return fail('missing_code');

  try {
    const { data, error } = await client.auth.verifyOtp({ email: mail, token: code, type: 'signup' });
    if (error) {
      warn('verifySignupCode', error);
      return fail(error);
    }
    return { ok: true, session: data.session || null, user: data.user || null };
  } catch (e) {
    warn('verifySignupCode', e);
    return fail(e);
  }
}

/* Send the signup code again. Demo mode sends no email, so it never runs there. */
export async function resendSignupCode({ email } = {}) {
  if (isDemo()) return fail('not_available_in_demo');

  const client = getClient();
  if (!client) return fail('backend_unavailable');

  const mail = String(email == null ? '' : email).trim();
  if (!mail) return fail('missing_email');

  try {
    const { data, error } = await client.auth.resend({ type: 'signup', email: mail });
    if (error) {
      warn('resendSignupCode', error);
      return fail(error);
    }
    return { ok: true, data };
  } catch (e) {
    warn('resendSignupCode', e);
    return fail(e);
  }
}

export async function signIn(email, password) {
  if (isDemo()) {
    const user = demoUser({ email, username: 'demo' });
    writeDemoUser(user);
    const session = { user };
    emit('SIGNED_IN', session);
    return { ok: true, session, user, demo: true };
  }

  const client = getClient();
  if (!client) return fail('backend_unavailable');

  try {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      warn('signIn', error);
      return fail(error);
    }
    return { ok: true, session: data.session || null, user: data.user || null };
  } catch (e) {
    warn('signIn', e);
    return fail(e);
  }
}

export async function signInWithGoogle() {
  if (isDemo()) {
    const user = demoUser({ username: 'demo' });
    writeDemoUser(user);
    const session = { user };
    emit('SIGNED_IN', session);
    return { ok: true, session, user, demo: true };
  }

  const client = getClient();
  if (!client) return fail('backend_unavailable');

  try {
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: new URL('/index.html', location.origin).href,
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) {
      warn('signInWithGoogle', error);
      return fail(error);
    }
    return { ok: true, data };
  } catch (e) {
    warn('signInWithGoogle', e);
    return fail(e);
  }
}

export async function signOut() {
  if (isDemo()) {
    writeDemoUser(null);
    emit('SIGNED_OUT', null);
    return { ok: true, demo: true };
  }

  const client = getClient();
  if (!client) return fail('backend_unavailable');

  try {
    const { error } = await client.auth.signOut();
    if (error) {
      warn('signOut', error);
      return fail(error);
    }
    return { ok: true };
  } catch (e) {
    warn('signOut', e);
    return fail(e);
  }
}

export async function getSession() {
  if (isDemo()) {
    const user = readDemoUser();
    return { ok: true, session: user ? { user } : null, demo: true };
  }

  const client = getClient();
  if (!client) return fail('backend_unavailable');

  try {
    const { data, error } = await client.auth.getSession();
    if (error) {
      warn('getSession', error);
      return fail(error);
    }
    return { ok: true, session: data.session || null };
  } catch (e) {
    warn('getSession', e);
    return fail(e);
  }
}

/* Returns an unsubscribe function. cb receives (event, session). */
export function onAuthChange(cb) {
  if (isDemo()) {
    demoListeners.add(cb);
    return () => demoListeners.delete(cb);
  }

  const client = getClient();
  if (!client) return () => {};

  const sub = client.auth.onAuthStateChange((event, session) => {
    /* Deferred: awaiting other supabase.* calls inside this callback deadlocks. */
    setTimeout(() => cb(event, session), 0);
  }).data.subscription;

  return () => sub.unsubscribe();
}

/* Upsert the signed-in user's profile. Used to finish Google signups (username + dob). */
export async function saveProfile(patch = {}) {
  const { username, dob, display_name } = patch;
  if (dob != null && dob !== '' && !ageOk(dob)) return { ok: false, error: 'You must be ' + MIN_AGE + ' or older.' };

  if (isDemo()) {
    const user = readDemoUser() || demoUser({});
    const meta = Object.assign({}, user.user_metadata);
    if (username) { meta.username = username; if (!meta.display_name) meta.display_name = username; }
    if (display_name) meta.display_name = display_name;
    if (dob) meta.dob = dob;
    user.user_metadata = meta;
    writeDemoUser(user);
    return { ok: true, user, demo: true };
  }

  const client = getClient();
  if (!client) return fail('backend_unavailable');

  try {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    const uid = sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
    if (!uid) return fail('no_user');

    const payload = { id: uid };
    if (username) payload.username = username;
    if (dob) payload.dob = dob;
    if (display_name) payload.display_name = display_name;

    const { error } = await client
      .from('profiles')
      .upsert(payload, { onConflict: 'id' });
    if (error) {
      if (error.code === '23505') return fail('That username is taken.');
      warn('saveProfile', error);
      return fail(error);
    }

    const metaPatch = {};
    if (username) metaPatch.username = username;
    if (dob) metaPatch.dob = dob;
    if (Object.keys(metaPatch).length) {
      try { await client.auth.updateUser({ data: metaPatch }); } catch (e) { /* metadata is best-effort */ }
    }
    return { ok: true };
  } catch (e) {
    warn('saveProfile', e);
    return fail(e);
  }
}
