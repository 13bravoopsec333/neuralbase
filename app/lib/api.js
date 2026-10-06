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
