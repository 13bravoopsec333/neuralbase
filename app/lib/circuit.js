/* Neuralbase circuit: the ordered step model, pure and DOM-free.

   A circuit is a named, ordered list of drill steps, each with a wall-clock cap.
   The whole model lives under one localStorage key, cortex.circuits:

     { version: 1, active: "c_default",
       items: [ { id, name, steps: [ { drillId, seconds, mode?, options: {} } ] } ] }

   seconds: 0 runs the step to the drill's own natural completion; a positive
   value is a hard cap in seconds. options is a validated bag from the drill
   registry, so a hand-edited store can never put a drill out of range.

   No DOM here and no writes at import time. Drills and Content are read at call
   time and guarded, so the module loads in a test with neither present. */

var KEY = 'cortex.circuits';
var VERSION = 1;
var DEFAULT_SECONDS = 90;
var MAX_SECONDS = 3600;

/* The durations the builder offers. Exported so the view and the model agree. */
export var DURATIONS = [0, 30, 60, 90, 120];

function storage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; }
}

function drillList() { return (globalThis.Content && globalThis.Content.DRILLS) || []; }

function drillExists(id) {
  var D = drillList();
  for (var i = 0; i < D.length; i++) if (D[i] && D[i].id === id) return true;
  return false;
}

/* The option API lives on Drills.DrillsCore in the real build; a flat Drills
   with the same names is accepted too, so a different bundle still validates. */
function optionCore() {
  var D = globalThis.Drills;
  if (!D) return null;
  return D.DrillsCore || D;
}

/* Validated option bag for one drill. An unknown id has nothing to validate, so
   it returns an empty bag rather than throwing. */
export function optionsFor(drillId, overrides) {
  var C = optionCore();
  if (C && typeof C.drillOptions === 'function') return C.drillOptions(drillId, overrides);
  return {};
}

/* The per-drill control schema. Accepts either shape: a function that takes an
   id and returns that drill's list, or the registry's one-shot map. */
export function optionSpecFor(drillId) {
  var D = globalThis.Drills;
  if (D && typeof D.drillOptionSpec === 'function') {
    var one = D.drillOptionSpec(drillId);
    if (Array.isArray(one)) return one;
  }
  var C = optionCore();
  if (C && typeof C.drillOptionSpec === 'function') {
    var spec = C.drillOptionSpec();
    return (spec && spec[drillId]) ? spec[drillId] : [];
  }
  return [];
}

function newId(prefix) {
  try {
    if (globalThis.crypto && globalThis.crypto.randomUUID) return prefix + '_' + globalThis.crypto.randomUUID().slice(0, 8);
  } catch (e) { /* fall through */ }
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function coerceSeconds(v) {
  var n = Number(v);
  if (!isFinite(n) || n < 0) return 0;
  n = Math.round(n);
  return n > MAX_SECONDS ? MAX_SECONDS : n;
}

/* One step through the registry: a known drill id, a whole non-negative cap, and
   an options bag snapped to that drill's spec. An unknown drill id is dropped,
   which is the null. */
export function validate(step) {
  if (!step || typeof step !== 'object') return null;
  var id = typeof step.drillId === 'string' ? step.drillId : '';
  if (!drillExists(id)) return null;
  var out = { drillId: id, seconds: coerceSeconds(step.seconds), options: optionsFor(id, step.options) };
  if (typeof step.mode === 'string' && step.mode) out.mode = step.mode;
  return out;
}

export function newCircuit(name) {
  return {
    id: newId('c'),
    name: typeof name === 'string' && name ? name : 'Circuit',
    steps: []
  };
}

/* Three steps across three different drills, 90 seconds each, so the builder has
   something real to reorder and run on first open. */
export function defaultCircuit() {
  var D = drillList();
  var ids = [];
  for (var i = 0; i < D.length && ids.length < 3; i++) if (D[i] && D[i].id) ids.push(D[i].id);
  if (ids.length < 3) ids = ['nback', 'ufov', 'palace'];
  var steps = [];
  for (var j = 0; j < ids.length; j++) steps.push({ drillId: ids[j], seconds: DEFAULT_SECONDS, options: {} });
  return { version: VERSION, active: 'c_default', items: [{ id: 'c_default', name: 'Default circuit', steps: steps }] };
}

function normCircuit(it) {
  if (!it || typeof it !== 'object') return null;
  var id = typeof it.id === 'string' && it.id ? it.id : newId('c');
  var name = typeof it.name === 'string' && it.name ? it.name : 'Circuit';
  var raw = Array.isArray(it.steps) ? it.steps : [];
  var steps = [];
  for (var i = 0; i < raw.length; i++) {
    var s = validate(raw[i]);
    if (s) steps.push(s);
  }
  return { id: id, name: name, steps: steps };
}

/* Any input into a valid model. Garbage, an empty list or a raw that is not an
   object all fall back to the default circuit. A circuit with no steps is kept
   as-is: that is a real, empty state the user can add to, not corruption. */
export function normalize(raw) {
  if (!raw || typeof raw !== 'object') return defaultCircuit();
  var list = Array.isArray(raw.items) ? raw.items : null;
  if (!list || !list.length) return defaultCircuit();
  var items = [], seen = {};
  for (var i = 0; i < list.length; i++) {
    var c = normCircuit(list[i]);
    if (c && !seen[c.id]) { seen[c.id] = 1; items.push(c); }
  }
  if (!items.length) return defaultCircuit();
  var active = typeof raw.active === 'string' ? raw.active : '';
  var found = false;
  for (var j = 0; j < items.length; j++) if (items[j].id === active) found = true;
  if (!found) active = items[0].id;
  return { version: VERSION, active: active, items: items };
}

export function load() {
  var ls = storage();
  if (!ls) return defaultCircuit();
  try {
    var raw = ls.getItem(KEY);
    return normalize(raw ? JSON.parse(raw) : null);
  } catch (e) {
    return defaultCircuit();
  }
}

export function save(model) {
  var m = normalize(model);
  var ls = storage();
  if (ls) {
    try { ls.setItem(KEY, JSON.stringify(m)); } catch (e) { /* degrade */ }
  }
  return m;
}

/* The circuit the active id names, or the first one. */
export function activeOf(model) {
  var m = model || defaultCircuit();
  for (var i = 0; i < m.items.length; i++) if (m.items[i].id === m.active) return m.items[i];
  return m.items[0];
}
