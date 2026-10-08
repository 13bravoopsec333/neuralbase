/* Neuralbase v2 leaderboard API.
   leaderboard(drillId, window) resolves to an array of { rank, username, bestValue, isMe }.
   On a failed configured-backend call it resolves to { ok: false, error } (and logs a warning)
   instead of throwing, so a real failure is never masked. Usernames are plain strings; callers
   must render them with textContent, never innerHTML.

   In demo mode both functions return a small synthetic board. */

import { getClient, isDemo } from './supabase.js';

const DIRECTION = {
  nback: 'higher',
  'exec-nback': 'higher',
  ufov: 'lower',
  palace: 'higher',
  reasoning: 'higher',
  spaced: 'higher',
  switching: 'higher',
};

const DEMO_NAMES = ['ada_l', 'quantum_fox', 'neuro_naut', 'pixel_pilgrim', 'deep_blue', 'cortex_demo'];
const DEMO_ME_INDEX = 3;

/* Pure: the synthetic demo board, ordered by the drill's score direction.
   Each row carries a stable synthetic user_id so the click-through to a profile
   exercises the real handoff. Those ids are deliberately not 'demo-user', so the
   profile view answers with its honest "not available in demo" state instead of
   inventing another person's data. */
export function demoBoard(drillId) {
  const dir = DIRECTION[drillId] || 'higher';
  const values = dir === 'lower' ? [180, 210, 240, 270, 300, 330] : [2, 3, 4, 5, 6, 7];
  const rows = DEMO_NAMES.map((username, i) => ({
    rank: i + 1,
    username,
    bestValue: values[i],
    isMe: i === DEMO_ME_INDEX,
    user_id: i === DEMO_ME_INDEX ? 'demo-user' : 'demo-row-' + username,
  }));
  rows.sort((a, b) => (dir === 'lower' ? a.bestValue - b.bestValue : b.bestValue - a.bestValue));
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });
  return rows;
}

function fail(error) {
  return { ok: false, error: typeof error === 'string' ? error : (error && error.message) || 'unknown_error' };
}

function warn(op, error) {
  console.warn(
    '[cortex] ' + op + ' failed against a configured backend:',
    error && error.message ? error.message : error
  );
}

export async function leaderboard(drillId, window = 'all') {
  if (isDemo()) return demoBoard(drillId);

  const client = getClient();
  if (!client) return fail('backend_unavailable');

  try {
    const { data, error } = await client.rpc('leaderboard', {
      p_drill_id: drillId,
      p_window: window,
    });
    if (error) {
      warn('leaderboard', error);
      return fail(error);
    }
    return (data || []).map((row) => ({
      rank: row.rank,
      username: row.username,
      bestValue: row.best_value,
      isMe: !!row.is_me,
      /* The RPC returns user_id so a row can be opened as a profile. It is a uuid,
         not an email, and the profile read path is the server-side profile_public(). */
      user_id: row.user_id || null,
    }));
  } catch (e) {
    warn('leaderboard', e);
    return fail(e);
  }
}

export async function myRank(drillId, window = 'all') {
  const board = await leaderboard(drillId, window);
  if (!Array.isArray(board)) return board;
  const me = board.find((row) => row.isMe);
  return me || null;
}

/* ---------------- friends ---------------- */

/* The friends RPC returns one row per relationship with a `kind` discriminator
   (friend | incoming | outgoing) and the counterpart's public fields, so the
   Friends view is one round trip. Grouped here into the three lists the view
   renders. Display names are plain strings; callers render them with textContent,
   never innerHTML. In demo mode there is one local account and no other people,
   so the honest answer is empty lists, not a fabricated friend. */

function isUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

async function currentUid(client) {
  try {
    const { data } = await client.auth.getSession();
    return data && data.session && data.session.user ? data.session.user.id : null;
  } catch (e) {
    return null;
  }
}

export async function friendsList() {
  if (isDemo()) return { ok: true, data: { friends: [], incoming: [], outgoing: [] }, demo: true };

  const client = getClient();
  if (!client) return fail('backend_unavailable');

  try {
    const { data, error } = await client.rpc('friends_list');
    if (error) {
      warn('friendsList', error);
      return fail(error);
    }
    const out = { friends: [], incoming: [], outgoing: [] };
    (data || []).forEach((row) => {
      if (!row) return;
      const userId = row.user_id;
      const username = row.username;
      const displayName = row.display_name;
      if (row.kind === 'friend') out.friends.push({ userId, username, displayName, since: row.at });
      else if (row.kind === 'incoming') out.incoming.push({ userId, username, displayName, requestedAt: row.at });
      else if (row.kind === 'outgoing') out.outgoing.push({ userId, username, displayName, requestedAt: row.at });
    });
    return { ok: true, data: out };
  } catch (e) {
    warn('friendsList', e);
    return fail(e);
  }
}

/* Search by handle. The RPC returns id/username/display_name and nothing else, so
   no email or private column can cross the wire; the map below picks exactly those
   three fields into the documented shape, and an empty query short-circuits to an
   empty list instead of a request. */
export async function friendSearch(username) {
  const q = typeof username === 'string' ? username.trim() : '';
  if (!q) return { ok: true, data: [] };

  if (isDemo()) return { ok: true, data: [], demo: true };

  const client = getClient();
  if (!client) return fail('backend_unavailable');

  try {
    const { data, error } = await client.rpc('search_profile_by_username', { p_username: q });
    if (error) {
      warn('friendSearch', error);
      return fail(error);
    }
    return {
      ok: true,
      data: (data || []).map((row) => ({
        userId: row.id,
        username: row.username,
        displayName: row.display_name,
      })),
    };
  } catch (e) {
    warn('friendSearch', e);
    return fail(e);
  }
}

/* Send a request, or answer one the other person already sent. The RPC returns a
   status text and is the only path that can see the reverse row, so a mutual
   request is flipped to accepted in place rather than duplicated. status is added
   alongside ok, so an existing caller that only checks ok keeps working. */
export async function friendRequest(userId) {
  if (!isUuid(userId)) return fail('invalid_user_id');
  if (isDemo()) return { ok: true, status: 'requested', demo: true };

  const client = getClient();
  if (!client) return fail('backend_unavailable');
  const uid = await currentUid(client);
  if (!uid) return fail('no_user');
  if (uid === userId) return fail('cannot_friend_self');

  try {
    const { data, error } = await client.rpc('friend_request', { p_user_id: userId });
    if (error) {
      warn('friendRequest', error);
      return fail(error);
    }
    /* requested | accepted | already_pending | already_friends */
    return { ok: true, status: data || 'requested' };
  } catch (e) {
    warn('friendRequest', e);
    return fail(e);
  }
}

/* Accept a request. The filter names the requester; RLS restricts the update to
   the rows where the caller is the addressee, so a request addressed to someone
   else is simply not a row this statement can reach. The addressee's own accept
   stamps responded_at, which is in the update column grant for exactly this. */
export async function friendAccept(userId) {
  if (!isUuid(userId)) return fail('invalid_user_id');
  if (isDemo()) return { ok: true, demo: true };

  const client = getClient();
  if (!client) return fail('backend_unavailable');

  try {
    const { error } = await client
      .from('friendships')
      .update({ status: 'accepted', responded_at: new Date().toISOString() })
      .eq('requester_id', userId);
    if (error) {
      warn('friendAccept', error);
      return fail(error);
    }
    return { ok: true };
  } catch (e) {
    warn('friendAccept', e);
    return fail(e);
  }
}

/* Remove a friendship or a pending request, in either direction. The or-filter
   names every row that involves the other person; RLS keeps only the ones the
   caller is a party to. */
export async function friendRemove(userId) {
  if (!isUuid(userId)) return fail('invalid_user_id');
  if (isDemo()) return { ok: true, demo: true };

  const client = getClient();
  if (!client) return fail('backend_unavailable');

  try {
    const { error } = await client
      .from('friendships')
      .delete()
      .or('requester_id.eq.' + userId + ',addressee_id.eq.' + userId);
    if (error) {
      warn('friendRemove', error);
      return fail(error);
    }
    return { ok: true };
  } catch (e) {
    warn('friendRemove', e);
    return fail(e);
  }
}
