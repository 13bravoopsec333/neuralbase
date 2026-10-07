/* Neuralbase v2 data layer.
   Every async function returns { ok: true, ... } or { ok: false, error }. Nothing throws.
   Writes are idempotent: each row carries a client_id. runs and sessions upsert with
   ignoreDuplicates (on conflict do nothing), so retries and the one-time merge never duplicate.
   cards upserts for real, because a graded card keeps its client_id and the schedule has to
   advance in place; runs has no UPDATE grant in the schema, so nothing here may rely on one.

   local_date is the user's own calendar day, taken from each record's own timestamp (t, or
   created_at for a cloud-shaped record) and falling back to now only when the record has none.
   Every write path goes through stampOf() for this, so the same record always lands on the same
   day whichever path saved it.

   Demo mode (no config keys) reads and writes localStorage. When a backend IS configured and a
   call fails, it is logged with console.warn and returned as { ok: false, error }; it never falls
   back to localStorage, so a real failure is never masked. Demo and real data use separate keys.

   Pure, testable helpers: stableClientId, mergePlan, localDateOf. */

import { getClient, isDemo } from './supabase.js';

const DEMO_KEYS = {
  runs: 'cortex.demo.runs',
  sessions: 'cortex.demo.sessions',
  cards: 'cortex.demo.cards',
  profile: 'cortex.demo.profile',
  decks: 'cortex.demo.decks',
  kudos: 'cortex.demo.kudos',
};

const ANON_STORE_KEY = 'cortex.app';
const ANON_LEGACY_KEY = 'cortex.as03';

/* ---------------- storage (browser localStorage, in-memory fallback) ---------------- */

const mem = {};

function storageGet(key) {
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
  } catch (e) {
    /* fall through to memory */
  }
  return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null;
}

function storageSet(key, value) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      return;
    }
  } catch (e) {
    /* fall through to memory */
  }
  mem[key] = value;
}

function storageRemove(key) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
      return;
    }
  } catch (e) {
    /* fall through */
  }
  delete mem[key];
}

function readJSON(key, fallback) {
  try {
    const raw = storageGet(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    storageSet(key, JSON.stringify(value));
  } catch (e) {
    /* ignore quota / serialization errors */
  }
}

/* ---------------- small utils ---------------- */

function fail(error) {
  return { ok: false, error: typeof error === 'string' ? error : (error && error.message) || 'unknown_error' };
}

function warn(op, error) {
  console.warn(
    '[cortex] ' + op + ' failed against a configured backend:',
    error && error.message ? error.message : error
  );
}

function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

const CARD_STATES = ['new', 'learning', 'review', 'relearning'];
const CARD_TYPES = ['basic', 'reverse', 'cloze'];

function oneOf(v, allowed, fallback) {
  return allowed.indexOf(v) >= 0 ? v : fallback;
}

/* A finite number, or null. FSRS treats null as "not initialised yet", so a
   non-number must never be written: null is meaningful, NaN is not. */
function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function intOr(v, fallback) {
  const n = Number(v);
  return isFinite(n) ? Math.trunc(n) : fallback;
}

/* A deck id is either a real id or null, never 0: Number(null) is 0, which would
   point at a deck that does not exist. */
function idOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

/* One card in either shape (camelCase from the app, snake_case from the cloud)
   to a cards row. Shared by saveCards, mergePlan and mergeLocal so the FSRS
   fields can never drift between the three write paths. */
function cardRow(c, uid) {
  const last = c.lastReview || c.last_review;
  return {
    user_id: uid,
    client_id: c.clientId || c.client_id || stableClientId(uid, 'card', c),
    deck_id: idOrNull(c.deckId != null ? c.deckId : c.deck_id),
    front: c.front,
    back: c.back == null ? '' : String(c.back),
    note: c.note == null ? null : String(c.note),
    /* Cloze hint. A real column, so the hint study.js renders survives a reload
       and a second device instead of living only in the loaded card. */
    hint: c.hint == null ? null : String(c.hint),
    card_type: oneOf(c.cardType || c.card_type, CARD_TYPES, 'basic'),
    box: intOr(c.box, 0),
    state: oneOf(c.state, CARD_STATES, 'new'),
    stability: numOrNull(c.stability),
    difficulty: numOrNull(c.difficulty),
    reps: intOr(c.reps, 0),
    lapses: intOr(c.lapses, 0),
    due: toIso(c.due),
    last_review: last == null ? null : toIso(last),
    seen: intOr(c.seen, 0),
    correct: intOr(c.correct, 0),
    /* Suspend is a real column, not a client-side flag, so it survives a reload
       and a second device instead of living only in the study overlay. */
    suspended: c.suspended === true,
  };
}

function toIso(ms) {
  if (ms == null) return new Date().toISOString();
  if (typeof ms === 'string') return ms;
  const d = new Date(ms);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/* The user's local calendar date, YYYY-MM-DD. Windows and streaks use local days, not UTC. */
export function localDateOf(ms) {
  const d = ms == null ? new Date() : new Date(ms);
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/* ---------------- deterministic client ids ---------------- */

function hash128(str) {
  let out = '';
  for (let s = 0; s < 4; s++) {
    let h = (2166136261 ^ (s * 0x9e3779b9)) >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    out += (h >>> 0).toString(16).padStart(8, '0');
  }
  return out;
}

function hexToUuid(hex) {
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' +
    hex.slice(16, 20) + '-' + hex.slice(20, 32);
}

/* Stable client_id for a local anonymous item. Same (uid, kind, content) always yields the same
   uuid, which is what makes a retried merge conflict-skip instead of duplicating. */
export function stableClientId(uid, kind, item) {
  const it = item || {};
  let key;
  if (kind === 'run') {
    key = [it.drillId || it.drill_id || '', it.value, it.unit || '', it.t || it.created_at || ''].join('|');
  } else if (kind === 'session') {
    key = [it.t || it.created_at || '', asArray(it.drills).join(',')].join('|');
  } else {
    /* A card's identity is its content, not its schedule. The FSRS fields
       (state, stability, difficulty, reps, lapses, lastReview, note, cardType)
       are deliberately left out: adding them would give the same card a new
       client_id after its first review, and a retried merge would insert a
       duplicate. due is kept because it was already part of the key and the
       one-time merge has to be stable against the row it originally produced. */
    /* Card identity must survive grading, so it keys on the card id alone.
       Keying on `due` made every grade mint a new client_id, which turned a
       graded card into a second row instead of an update. */
    key = String(it.id || '') + '|' + (it.front || '');
  }
  return hexToUuid(hash128([uid, kind, key].join('::')));
}

/* Pure: turn local anonymous data into a cloud insert batch. Idempotent and deduped by client_id.
   Accepts the MVP store shape ({ records, sessions, cards }) or the new shape ({ runs, ... }). */
export function mergePlan(local, uid) {
  const src = local || {};
  const runs = [];
  const seenRuns = new Set();
  asArray(src.runs || src.records).forEach((r) => {
    if (!r || typeof r.value !== 'number' || !isFinite(r.value)) return;
    const drillId = r.drillId || r.drill_id;
    if (!drillId) return;
    const clientId = r.clientId || r.client_id || stableClientId(uid, 'run', r);
    if (seenRuns.has(clientId)) return;
    seenRuns.add(clientId);
    runs.push({
      user_id: uid,
      client_id: clientId,
      drill_id: drillId,
      value: r.value,
      unit: r.unit || '',
      meta: r.meta || {},
      local_date: r.localDate || localDateOf(stampOf(r)),
      created_at: toIso(stampOf(r)),
    });
  });

  const sessions = [];
  const seenSessions = new Set();
  asArray(src.sessions).forEach((s) => {
    if (!s || typeof s !== 'object') return;
    const clientId = s.clientId || s.client_id || stableClientId(uid, 'session', s);
    if (seenSessions.has(clientId)) return;
    seenSessions.add(clientId);
    sessions.push({
      user_id: uid,
      client_id: clientId,
      drills: asArray(s.drills),
      local_date: s.localDate || localDateOf(stampOf(s)),
      created_at: toIso(stampOf(s)),
    });
  });

  const cards = [];
  const seenCards = new Set();
  asArray(src.cards).forEach((c) => {
    if (!c || typeof c.front !== 'string') return;
    const row = cardRow(c, uid);
    if (seenCards.has(row.client_id)) return;
    seenCards.add(row.client_id);
    cards.push(row);
  });

  return { runs, sessions, cards };
}

/* ---------------- current user ---------------- */

async function uidOrNull() {
  const client = getClient();
  if (!client) return null;
  try {
    const { data } = await client.auth.getSession();
    return data && data.session && data.session.user ? data.session.user.id : null;
  } catch (e) {
    return null;
  }
}

/* ---------------- demo store ---------------- */

function demoInsert(kind, rows) {
  const existing = readJSON(DEMO_KEYS[kind], []);
  const seen = new Set(existing.map((r) => r.client_id));
  const fresh = rows.filter((r) => !seen.has(r.client_id));
  writeJSON(DEMO_KEYS[kind], existing.concat(fresh));
  return fresh.length;
}

/* Demo-mode upsert. Rows carrying a client_id already in the store replace it, new
   ones append, and rows the caller no longer sends are kept. saveCards needs this:
   a graded card keeps its client_id, so an insert-only path silently dropped every
   schedule update and the review queue never advanced. */
function demoUpsert(kind, rows) {
  const existing = readJSON(DEMO_KEYS[kind], []);
  const index = new Map(existing.map((r, i) => [r.client_id, i]));
  let touched = 0;
  for (const row of rows) {
    if (!row || row.client_id == null) continue;
    if (index.has(row.client_id)) {
      existing[index.get(row.client_id)] = row;
    } else {
      index.set(row.client_id, existing.length);
      existing.push(row);
    }
    touched++;
  }
  writeJSON(DEMO_KEYS[kind], existing);
  return touched;
}

/* ---------------- writes ---------------- */

/* A record's own timestamp, in ms, from either the app shape (t) or the cloud
   shape (created_at). Null when the record carries none, so the caller can tell
   "no timestamp" from "epoch" and fall back to now exactly once. */
function stampOf(rec) {
  if (!rec) return null;
  const t = rec.t != null ? rec.t : rec.created_at;
  return t == null || t === '' ? null : t;
}

export async function saveRun(run) {
  if (!run) return fail('no_run');
  const drillId = run.drillId || run.drill_id;
  if (!drillId || typeof run.value !== 'number' || !isFinite(run.value)) return fail('invalid_run');

  /* Own timestamp first, now only as the fallback. saveRun used localDateOf()
   with no argument while mergePlan used localDateOf(r.t), so one run could land
   on two different local days depending on the path that saved it. */
  const t = stampOf(run);
  const localDate = run.localDate || localDateOf(t);

  if (isDemo()) {
    const clientId = run.clientId || run.client_id || uuid();
    demoInsert('runs', [{
      user_id: 'demo-user',
      client_id: clientId,
      drill_id: drillId,
      value: run.value,
      unit: run.unit || '',
      meta: run.meta || {},
      local_date: localDate,
      created_at: toIso(t),
    }]);
    return { ok: true, clientId, demo: true };
  }

  const client = getClient();
  if (!client) return fail('backend_unavailable');
  const uid = await uidOrNull();
  if (!uid) return fail('no_user');

  const clientId = run.clientId || run.client_id || uuid();
  const row = {
    user_id: uid,
    client_id: clientId,
    drill_id: drillId,
    value: run.value,
    unit: run.unit || '',
    meta: run.meta || {},
    local_date: localDate,
  };

  try {
    const { error } = await client.from('runs').upsert(row, { onConflict: 'user_id,client_id', ignoreDuplicates: true });
    if (error) {
      warn('saveRun', error);
      return fail(error);
    }
    return { ok: true, clientId };
  } catch (e) {
    warn('saveRun', e);
    return fail(e);
  }
}

export async function saveSession(s) {
  if (!s) return fail('no_session');
  const drills = asArray(s.drills);

  if (isDemo()) {
    const clientId = s.clientId || s.client_id || uuid();
    demoInsert('sessions', [{
      user_id: 'demo-user',
      client_id: clientId,
      drills,
      local_date: s.localDate || localDateOf(s.t),
      created_at: toIso(s.t),
    }]);
    return { ok: true, clientId, demo: true };
  }

  const client = getClient();
  if (!client) return fail('backend_unavailable');
  const uid = await uidOrNull();
  if (!uid) return fail('no_user');

  const clientId = s.clientId || s.client_id || uuid();
  const row = {
    user_id: uid,
    client_id: clientId,
    drills,
    local_date: s.localDate || localDateOf(s.t),
  };

  try {
    const { error } = await client.from('sessions').upsert(row, { onConflict: 'user_id,client_id', ignoreDuplicates: true });
    if (error) {
      warn('saveSession', error);
      return fail(error);
    }
    return { ok: true, clientId };
  } catch (e) {
    warn('saveSession', e);
    return fail(e);
  }
}

export async function saveCards(cards) {
  const list = asArray(cards);
  if (!list.length) return { ok: true, count: 0 };

  if (isDemo()) {
    const rows = list.map((c) => cardRow(c, 'demo-user'));
    const n = demoUpsert('cards', rows);
    return { ok: true, count: n, demo: true };
  }

  const client = getClient();
  if (!client) return fail('backend_unavailable');
  const uid = await uidOrNull();
  if (!uid) return fail('no_user');

  const rows = list.map((c) => cardRow(c, uid));

  try {
    /* A real upsert, no ignoreDuplicates: the conflict target is (user_id, client_id) and a
       graded card keeps its client_id, so this updates the schedule in place. ignoreDuplicates
       here would make saveCards insert-only and freeze every card at its first due date. */
    const { error } = await client.from('cards').upsert(rows, { onConflict: 'user_id,client_id' });
    if (error) {
      warn('saveCards', error);
      return fail(error);
    }
    return { ok: true, count: rows.length };
  } catch (e) {
    warn('saveCards', e);
    return fail(e);
  }
}

/* Remove cards by client_id. Dropping them from the local array alone is not enough:
   the next load reads the store and every deleted card comes back. */
export async function deleteCards(ids) {
  const list = asArray(ids).filter((x) => typeof x === 'string' && x.length);
  if (!list.length) return { ok: true, count: 0 };

  if (isDemo()) {
    const existing = readJSON(DEMO_KEYS.cards, []);
    const drop = new Set(list);
    const kept = existing.filter((r) => !drop.has(r.client_id));
    const n = existing.length - kept.length;
    writeJSON(DEMO_KEYS.cards, kept);
    return { ok: true, count: n, demo: true };
  }

  const client = getClient();
  if (!client) return fail('backend_unavailable');
  const uid = await uidOrNull();
  if (!uid) return fail('no_user');

  try {
    const { error } = await client.from('cards').delete().eq('user_id', uid).in('client_id', list);
    if (error) {
      warn('deleteCards', error);
      return fail(error);
    }
    return { ok: true, count: list.length };
  } catch (e) {
    warn('deleteCards', e);
    return fail(e);
  }
}

/* ---------------- reads ---------------- */

export async function loadUserData() {
  if (isDemo()) {
    return {
      ok: true,
      demo: true,
      data: {
        runs: readJSON(DEMO_KEYS.runs, []),
        sessions: readJSON(DEMO_KEYS.sessions, []),
        cards: readJSON(DEMO_KEYS.cards, []),
        profile: readJSON(DEMO_KEYS.profile, null),
        decks: readJSON(DEMO_KEYS.decks, []),
        kudos: readJSON(DEMO_KEYS.kudos, []),
      },
    };
  }

  const client = getClient();
  if (!client) return fail('backend_unavailable');
  const uid = await uidOrNull();
  if (!uid) return fail('no_user');

  try {
    const [runs, sessions, cards, profile, decks, kudos] = await Promise.all([
      client.from('runs').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(500),
      client.from('sessions').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(500),
      client.from('cards').select('*').eq('user_id', uid).order('due', { ascending: true }).limit(2000),
      client.from('profiles').select('*').eq('id', uid).maybeSingle(),
      client.from('decks').select('*').eq('user_id', uid).order('created_at', { ascending: true }),
      /* Own kudos only, so the UI can render which runs were given without
         exposing anybody else's rows (the select policy is owner-only). */
      client.from('kudos').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(500),
    ]);
    const firstError = runs.error || sessions.error || cards.error || profile.error || decks.error || kudos.error;
    if (firstError) {
      warn('loadUserData', firstError);
      return fail(firstError);
    }
    return {
      ok: true,
      data: {
        runs: runs.data || [],
        sessions: sessions.data || [],
        cards: cards.data || [],
        profile: profile.data || null,
        decks: decks.data || [],
        kudos: kudos.data || [],
      },
    };
  } catch (e) {
    warn('loadUserData', e);
    return fail(e);
  }
}

export async function getProfile() {
  if (isDemo()) {
    return { ok: true, data: readJSON(DEMO_KEYS.profile, null), demo: true };
  }

  const client = getClient();
  if (!client) return fail('backend_unavailable');
  const uid = await uidOrNull();
  if (!uid) return fail('no_user');

  try {
    const { data, error } = await client.from('profiles').select('*').eq('id', uid).maybeSingle();
    if (error) {
      warn('getProfile', error);
      return fail(error);
    }
    return { ok: true, data: data || null };
  } catch (e) {
    warn('getProfile', e);
    return fail(e);
  }
}

/* Sends the patch verbatim: the columns are not whitelisted here, so the v3
   additions (goal, baseline, timezone, reminder_time, streak_freezes,
   onboarded_at) already pass through with no change. Unknown keys are rejected
   by Postgres, which surfaces as { ok: false, error }.

   `plan` is sent verbatim too and is refused by the database, which is the point.
   Profiles is granted UPDATE per column (migration 002) and plan is not in the
   grant, so a client cannot self-upgrade by writing it here or by calling PostgREST
   directly. Postgres answers 42501 for a column outside the grant; it is named
   plainly below so the caller sees why the write did not land instead of a bare
   permission error. In demo mode there is no grant and no server, so plan still
   moves locally, which is what the demo pricing page is for. */
export async function updateProfile(patch) {
  const p = patch || {};

  if (isDemo()) {
    const current = readJSON(DEMO_KEYS.profile, {}) || {};
    const next = Object.assign({}, current, p);
    writeJSON(DEMO_KEYS.profile, next);
    return { ok: true, data: next, demo: true };
  }

  const client = getClient();
  if (!client) return fail('backend_unavailable');
  const uid = await uidOrNull();
  if (!uid) return fail('no_user');

  try {
    const { data, error } = await client
      .from('profiles')
      .update(p)
      .eq('id', uid)
      .select()
      .maybeSingle();
    if (error) {
      if (error.code === '23505') return fail('That username is taken.');
      /* 42501 on a column the caller asked for is the column grant saying no, and
         `plan` is the one that matters: a client cannot grant itself the paid tier.
         The pricing page writes plan through here, so it gets a sentence it can
         show rather than "permission denied for table profiles". */
      if (error.code === '42501') return fail(SERVER_OWNED_WRITE);
      warn('updateProfile', error);
      return fail(error);
    }
    return { ok: true, data: data || null };
  } catch (e) {
    warn('updateProfile', e);
    return fail(e);
  }
}

export const SERVER_OWNED_WRITE =
  'This field is set by the server and cannot be changed from the app.';

/* ---------------- baseline (first-run calibration) ---------------- */

/* Routed through updateProfile rather than a dedicated path: baseline is one
   jsonb column, so a second write path would be a second thing to keep working. */
export async function saveBaseline(baseline) {
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) return fail('invalid_baseline');
  const res = await updateProfile({ baseline });
  if (!res.ok) return res;
  return { ok: true, data: baseline, demo: res.demo === true };
}

export async function getBaseline() {
  const res = await getProfile();
  if (!res.ok) return res;
  return { ok: true, data: (res.data && res.data.baseline) || null, demo: res.demo === true };
}

/* ---------------- decks ---------------- */

function nextDemoId(rows) {
  let max = 0;
  asArray(rows).forEach((r) => {
    const n = Number(r && r.id);
    if (isFinite(n) && n > max) max = n;
  });
  return max + 1;
}

export async function saveDeck(deck) {
  const d = deck && typeof deck === 'object' ? deck : {};
  const name = typeof d.name === 'string' ? d.name.trim() : '';
  if (!name) return fail('deck_name_required');
  const description = d.description == null ? null : String(d.description);

  if (isDemo()) {
    const rows = readJSON(DEMO_KEYS.decks, []);
    /* Exact-name match, same as the (user_id, name) unique index. Case is
       significant in both modes, so demo never behaves differently from the
       backend. A clash returns the first deck instead of erroring. */
    const existing = rows.find((r) => r && r.name === name);
    if (existing) return { ok: true, deck: existing, duplicate: true, demo: true };
    const row = {
      id: nextDemoId(rows),
      user_id: 'demo-user',
      name,
      description,
      created_at: new Date().toISOString(),
    };
    writeJSON(DEMO_KEYS.decks, rows.concat([row]));
    return { ok: true, deck: row, demo: true };
  }

  const client = getClient();
  if (!client) return fail('backend_unavailable');
  const uid = await uidOrNull();
  if (!uid) return fail('no_user');

  try {
    const { data, error } = await client
      .from('decks')
      .upsert({ user_id: uid, name, description }, { onConflict: 'user_id,name', ignoreDuplicates: true })
      .select()
      .maybeSingle();
    if (error) {
      if (error.code === '23505') return fail('That deck name is already in use.');
      warn('saveDeck', error);
      return fail(error);
    }
    if (data) return { ok: true, deck: data };
    /* ignoreDuplicates returns no row on a name clash, so read it back to hand
       the caller the existing deck rather than a null. */
    const { data: existing, error: readError } = await client
      .from('decks')
      .select('*')
      .eq('user_id', uid)
      .eq('name', name)
      .maybeSingle();
    if (readError) {
      warn('saveDeck', readError);
      return fail(readError);
    }
    return { ok: true, deck: existing || null, duplicate: !existing };
  } catch (e) {
    warn('saveDeck', e);
    return fail(e);
  }
}

export async function listDecks() {
  if (isDemo()) {
    return { ok: true, data: readJSON(DEMO_KEYS.decks, []), demo: true };
  }

  const client = getClient();
  if (!client) return fail('backend_unavailable');
  const uid = await uidOrNull();
  if (!uid) return fail('no_user');

  try {
    const { data, error } = await client
      .from('decks')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: true });
    if (error) {
      warn('listDecks', error);
      return fail(error);
    }
    return { ok: true, data: data || [] };
  } catch (e) {
    warn('listDecks', e);
    return fail(e);
  }
}

export async function deleteDeck(deck) {
  const d = deck && typeof deck === 'object' ? deck : { id: deck };
  const id = idOrNull(d.id);
  if (!id) return fail('no_deck_id');

  if (isDemo()) {
    const rows = readJSON(DEMO_KEYS.decks, []);
    const left = rows.filter((r) => Number(r && r.id) !== id);
    writeJSON(DEMO_KEYS.decks, left);
    return { ok: true, deleted: rows.length - left.length, demo: true };
  }

  const client = getClient();
  if (!client) return fail('backend_unavailable');
  const uid = await uidOrNull();
  if (!uid) return fail('no_user');

  try {
    const { data, error } = await client.from('decks').delete().eq('user_id', uid).eq('id', id).select('id');
    if (error) {
      warn('deleteDeck', error);
      return fail(error);
    }
    return { ok: true, deleted: asArray(data).length };
  } catch (e) {
    warn('deleteDeck', e);
    return fail(e);
  }
}

/* ---------------- kudos ---------------- */

function isUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/* In demo mode every run belongs to 'demo-user', so the own-run check the RPC
   does server-side is a local lookup: an unknown run_client_id is refused here
   too, which keeps the two modes honest about what is allowed. Both modes are
   self-only. toggle_kudos() accepts a run the caller owns and nothing else, so a
   kudos marks one of your own runs. It is a bookmark, not a message to somebody
   else: no client can learn another user's run client_id today, because runs is
   owner-only for select and leaderboard() returns no ids. */
function demoRunOwned(runClientId) {
  const runs = readJSON(DEMO_KEYS.runs, []);
  return runs.some((r) => r && r.client_id === runClientId);
}

export async function toggleKudos(runClientId) {
  if (!isUuid(runClientId)) return fail('invalid_run_id');

  if (isDemo()) {
    if (!demoRunOwned(runClientId)) return fail('kudos: unknown run');
    const rows = readJSON(DEMO_KEYS.kudos, []);
    const mine = rows.filter((r) => r && r.run_client_id === runClientId && r.user_id === 'demo-user');
    let given;
    let next;
    if (mine.length) {
      next = rows.filter((r) => !(r && r.run_client_id === runClientId && r.user_id === 'demo-user'));
      given = false;
    } else {
      next = rows.concat([{ run_client_id: runClientId, user_id: 'demo-user', created_at: new Date().toISOString() }]);
      given = true;
    }
    writeJSON(DEMO_KEYS.kudos, next);
    return { ok: true, given, count: next.filter((r) => r && r.run_client_id === runClientId).length, demo: true };
  }

  const client = getClient();
  if (!client) return fail('backend_unavailable');

  try {
    const { data, error } = await client.rpc('toggle_kudos', { p_run_client_id: runClientId });
    if (error) {
      warn('toggleKudos', error);
      return fail(error);
    }
    return { ok: true, given: data === true };
  } catch (e) {
    warn('toggleKudos', e);
    return fail(e);
  }
}

export async function kudosCounts(runClientIds) {
  /* A non-array is a caller bug, so it fails. An empty array is a legitimate
     "nothing to count" and succeeds with no keys. */
  if (!Array.isArray(runClientIds)) return fail('invalid_run_ids');
  const ids = runClientIds.filter(isUuid);
  if (!ids.length) return { ok: true, data: {} };

  if (isDemo()) {
    const rows = readJSON(DEMO_KEYS.kudos, []);
    const counts = {};
    ids.forEach((id) => {
      counts[id] = rows.filter((r) => r && r.run_client_id === id).length;
    });
    return { ok: true, data: counts, demo: true };
  }

  const client = getClient();
  if (!client) return fail('backend_unavailable');

  try {
    /* One RPC per id: the function is the only path that can see other users'
       kudos, and PostgREST takes a single argument. Unknown ids answer 0. */
    const answers = await Promise.all(ids.map((id) => client.rpc('kudos_count', { p_run_client_id: id })));
    const counts = {};
    let firstError = null;
    ids.forEach((id, i) => {
      const r = answers[i];
      if (!r || r.error) {
        if (!firstError) firstError = (r && r.error) || new Error('kudos_count_failed');
        return;
      }
      counts[id] = Number(r.data) || 0;
    });
    if (firstError) {
      warn('kudosCounts', firstError);
      return fail(firstError);
    }
    return { ok: true, data: counts };
  } catch (e) {
    warn('kudosCounts', e);
    return fail(e);
  }
}

/* ---------------- public profile ---------------- */

/* The privacy columns on profiles, in the order the schema declares them. Kept
   as one list so saveProfilePrivacy and the settings view cannot drift apart on
   what is publishable. bio is a string, not a toggle, so it is separate. */
const PRIVACY_TOGGLES = ['show_avatar', 'show_bests', 'show_streak', 'show_sessions', 'show_activity', 'show_joined'];

function isBool(v) {
  return v === true || v === false;
}

/* Coerce a privacy patch to only the keys the schema knows, each the right
   type. Anything else is dropped rather than passed to Postgres, which would
   answer 42703 for an unknown column. bio is trimmed and capped at the 280
   characters profile_public() returns; null clears it. */
function privacyPatch(patch) {
  const src = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  const out = {};
  PRIVACY_TOGGLES.forEach((k) => {
    if (isBool(src[k])) out[k] = src[k];
  });
  if (typeof src.bio === 'string' || src.bio === null) {
    const b = src.bio === null ? '' : src.bio.trim();
    out.bio = b ? b.slice(0, 280) : null;
  }
  return out;
}

/* Save the owner's privacy choices and bio. Routed through updateProfile so
   there is one profile write path; the columns are ordinary profiles columns,
   so the server is what enforces them. Returns the privacy keys that were
   actually applied. */
export async function saveProfilePrivacy(patch) {
  const p = privacyPatch(patch);
  if (!Object.keys(p).length) return fail('invalid_privacy');
  const res = await updateProfile(p);
  if (!res.ok) return res;
  return { ok: true, data: p, demo: res.demo === true };
}

/* Drill direction and unit, read from the same registry the drills use, so a
   demo best is ranked the way the database would rank it. content.js is a
   classic script, so it is read off globalThis rather than imported. */
function drillMeta(drillId) {
  const content = (typeof globalThis !== 'undefined' && globalThis.Content) || null;
  const list = (content && content.DRILLS) || [];
  const d = list.find((x) => x && x.id === drillId);
  return { direction: (d && d.direction) || 'higher', unit: (d && d.unit) || null };
}

/* Best per drill from the local demo runs, same shape as the bests jsonb the
   RPC builds: { drillId, best, unit, direction, achievedOn }. Built from rows
   the demo user actually saved, never invented. */
function demoBests(runs) {
  const byDrill = new Map();
  asArray(runs).forEach((r) => {
    if (!r || typeof r.value !== 'number' || !isFinite(r.value) || !r.drill_id) return;
    const meta = drillMeta(r.drill_id);
    const prev = byDrill.get(r.drill_id);
    if (prev && (meta.direction === 'lower' ? prev.best <= r.value : prev.best >= r.value)) return;
    byDrill.set(r.drill_id, {
      drillId: r.drill_id,
      best: r.value,
      unit: r.unit || meta.unit,
      direction: meta.direction,
      achievedOn: localDateOf(stampOf(r)),
    });
  });
  return Array.from(byDrill.values()).sort((a, b) => (a.drillId < b.drillId ? -1 : 1));
}

/* The demo profile for 'demo-user', computed from the same local store
   loadUserData reads. Any other id answers not_available_in_demo: the demo store
   holds exactly one person's rows, so there is nothing truthful to return for a
   real account and fabricating bests for one would be worse than an error. */
function demoPublicProfile(userId) {
  if (userId !== 'demo-user') return fail('not_available_in_demo');
  const profile = readJSON(DEMO_KEYS.profile, null);
  if (!profile) return fail('not_available_in_demo');
  const runs = readJSON(DEMO_KEYS.runs, []);
  const sessions = readJSON(DEMO_KEYS.sessions, []);
  const on = (k) => profile[k] !== false;

  /* Days are integers from the epoch so "is this the next day" is arithmetic,
     which is what the SQL gap-and-islands does with dates too. */
  const dayNo = (d) => Date.parse(d + 'T00:00:00Z') / 86400000;
  const todayN = dayNo(localDateOf());
  const days = new Set(asArray(sessions).map((s) => s && s.local_date).filter(Boolean));

  let streak = 0;
  for (let i = 0; i < 400; i++) {
    if (days.has(localDateOf(Date.now() - i * 86400000))) streak++;
    else if (i > 0) break;      /* today not trained yet keeps the streak live */
  }
  let longest = 0;
  let run = 0;
  let prevN = null;
  Array.from(days).sort().forEach((d) => {
    const n = dayNo(d);
    run = prevN != null && n === prevN + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    prevN = n;
  });

  /* sessions_per_day covers 90 days keyed by date; activity_30d is the same
     counts narrowed to 30 and flattened to an ordered array, matching the two
     shapes the RPC builds. */
  const perDay = {};
  const counts30 = {};
  asArray(sessions).forEach((s) => {
    const d = s && s.local_date;
    if (!d || !isFinite(dayNo(d))) return;
    const age = todayN - dayNo(d);
    if (age < 0 || age >= 90) return;
    perDay[d] = (perDay[d] || 0) + 1;
    if (age < 30) counts30[d] = perDay[d];
  });
  const activity = Object.keys(counts30).sort().map((key) => ({ key, n: counts30[key] }));

  const bio = typeof profile.bio === 'string' && profile.bio.trim() ? profile.bio.trim().slice(0, 280) : null;
  return {
    ok: true,
    demo: true,
    data: {
      user_id: 'demo-user',
      username: profile.username || 'demo',
      display_name: profile.visibility === 'anon' ? 'Anonymous'
        : (profile.display_name || profile.username || 'Demo'),
      avatar_url: on('show_avatar') ? profile.avatar_url || null : null,
      bio: profile.visibility === 'anon' ? null : bio,
      plan: profile.plan || 'free',
      joined_on: on('show_joined') ? localDateOf(stampOf(profile)) : null,
      bests: on('show_bests') ? demoBests(runs) : null,
      streak: on('show_streak') ? streak : null,
      longest_streak: on('show_streak') ? longest : null,
      sessions_per_day: on('show_sessions') ? perDay : null,
      activity_30d: on('show_activity') ? activity : null,
    },
  };
}

/* Another person's public profile. One RPC, and the server decides what comes
   back: the owner's show_* columns, not anything asked for here. A missing
   user is a no row, so this resolves { ok: true, data: null } rather than an
   error, which is also how a caller learns an id does not exist without the
   database telling it that is the reason. */
export async function fetchPublicProfile(userId) {
  if (typeof userId !== 'string' || !userId.trim()) return fail('invalid_user_id');

  if (isDemo()) return demoPublicProfile(userId.trim());

  const client = getClient();
  if (!client) return fail('backend_unavailable');

  try {
    const { data, error } = await client.rpc('profile_public', { p_user_id: userId });
    if (error) {
      warn('fetchPublicProfile', error);
      return fail(error);
    }
    return { ok: true, data: (asArray(data)[0]) || null };
  } catch (e) {
    warn('fetchPublicProfile', e);
    return fail(e);
  }
}

/* ---------------- one-time merge ---------------- */

function clearLocalAnonymous() {
  if (isDemo()) {
    storageRemove(DEMO_KEYS.runs);
    storageRemove(DEMO_KEYS.sessions);
    storageRemove(DEMO_KEYS.cards);
    return;
  }
  /* Keep non-run state (settings, days, sequences); blank only the merged arrays. */
  storageRemove(ANON_LEGACY_KEY);
  const raw = storageGet(ANON_STORE_KEY);
  if (raw) {
    try {
      const state = JSON.parse(raw);
      state.records = [];
      state.runs = [];
      state.sessions = [];
      state.cards = [];
      storageSet(ANON_STORE_KEY, JSON.stringify(state));
    } catch (e) {
      storageRemove(ANON_STORE_KEY);
    }
  }
}

/* Insert local anonymous data for this uid with conflict-skip. Clears local only after every
   insert is confirmed. The "merged" flag is keyed per uid, never global. */
export async function mergeLocal(local, uid) {
  if (!uid) return fail('no_user');

  const flagKey = 'cortex.merged.' + uid;
  if (storageGet(flagKey) === '1') return { ok: true, merged: 0, already: true };

  const plan = mergePlan(local, uid);
  const total = plan.runs.length + plan.sessions.length + plan.cards.length;

  if (isDemo()) {
    const merged =
      demoInsert('runs', plan.runs) + demoInsert('sessions', plan.sessions) + demoInsert('cards', plan.cards);
    storageSet(flagKey, '1');
    clearLocalAnonymous();
    return { ok: true, merged, demo: true };
  }

  const client = getClient();
  if (!client) return fail('backend_unavailable');

  try {
    if (plan.runs.length) {
      const { error } = await client.from('runs').upsert(plan.runs, { onConflict: 'user_id,client_id', ignoreDuplicates: true });
      if (error) throw error;
    }
    if (plan.sessions.length) {
      const { error } = await client.from('sessions').upsert(plan.sessions, { onConflict: 'user_id,client_id', ignoreDuplicates: true });
      if (error) throw error;
    }
    if (plan.cards.length) {
      const { error } = await client.from('cards').upsert(plan.cards, { onConflict: 'user_id,client_id', ignoreDuplicates: true });
      if (error) throw error;
    }
  } catch (e) {
    warn('mergeLocal', e);
    return fail(e);
  }

  /* Confirmed. Only now clear local and set the per-uid flag. */
  storageSet(flagKey, '1');
  clearLocalAnonymous();
  return { ok: true, merged: total };
}

/* Delete the signed-in user's rows and profile. Deleting the auth.users row itself needs an
   admin/edge function, so the account shell is removed and the client is signed out; a server
   cleanup job or edge function finishes the job. In demo mode, clears local. */
export async function deleteAccount() {
  if (isDemo()) {
    try { storageRemove(ANON_STORE_KEY); } catch (e) {}
    return { ok: true, demo: true };
  }

  const client = getClient();
  if (!client) return fail('backend_unavailable');

  try {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    const uid = data && data.session && data.session.user ? data.session.user.id : null;
    if (!uid) return fail('no_user');

    /* Order is FK-safe: kudos is independent, cards.deck_id points at decks
       (set null, but deleting the child first is still cleaner), and profiles
       goes last because every table cascades from it. Explicit deletes run
       before the profile delete so nothing relies on the cascade alone. */
    const tables = ['kudos', 'cards', 'decks', 'sessions', 'runs', 'bests'];
    for (const t of tables) {
      const { error: delError } = await client.from(t).delete().eq('user_id', uid);
      if (delError) throw delError;
    }
    const { error: profError } = await client.from('profiles').delete().eq('id', uid);
    if (profError) throw profError;
    return { ok: true };
  } catch (e) {
    warn('deleteAccount', e);
    return fail(e);
  }
}
