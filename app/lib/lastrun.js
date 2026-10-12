/* Neuralbase handoff store: the run that just finished.

   The drill host lives in one view and the summary is another view, and the view
   swap clears the DOM, so the payload has to survive outside it. This is the
   smallest thing that does that: one module-level slot, plus a sessionStorage
   mirror so a reload of #summary still has the run.

   Every read tolerates a corrupt or missing mirror. A bad JSON string, a full
   store, or a browser that refuses sessionStorage all degrade to "no run", which
   is the same as a cold first paint. Nothing here throws. */

const KEY = 'cortex.lastrun';

let slot = null;

/* The mirror, or null when the browser will not hand one over. */
function mirror() {
  try {
    return typeof globalThis !== 'undefined' && globalThis.sessionStorage ? globalThis.sessionStorage : null;
  } catch (e) {
    return null;
  }
}

/* Store a payload. Passing null clears both the slot and the mirror. */
export function put(payload) {
  slot = (payload && typeof payload === 'object') ? payload : null;
  const s = mirror();
  if (!s) return slot;
  try {
    if (slot == null) s.removeItem(KEY);
    else s.setItem(KEY, JSON.stringify(slot));
  } catch (e) {
    /* Quota or a disabled store: the slot still holds it for this page. */
  }
  return slot;
}

/* The payload without consuming it, so a reload keeps showing the run. */
export function peek() {
  if (slot != null) return slot;
  const s = mirror();
  if (!s) return null;
  let raw = null;
  try {
    raw = s.getItem(KEY);
  } catch (e) {
    return null;
  }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === 'object') {
      slot = v;
      return v;
    }
  } catch (e) {
    /* Corrupt mirror: read as no run rather than throw. */
  }
  return null;
}

/* The payload, then clear it. Use when a run must be shown exactly once. */
export function take() {
  const v = peek();
  slot = null;
  const s = mirror();
  if (s) {
    try {
      s.removeItem(KEY);
    } catch (e) {
      /* degrade */
    }
  }
  return v;
}
