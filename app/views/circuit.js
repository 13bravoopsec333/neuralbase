/* Neuralbase view: Circuit, in the P2 preview-first layout.

   The shell is a narrow left rail and a big stage (see app/ui/p2.css for the
   shared .p2-shell geometry). The rail holds both halves of building: the
   add-a-drill palette that appends a step, and the ordered step list, where each
   step picks a drill, sets a wall-clock cap (Off, 30, 60, 90, 120 seconds), and
   carries its own validated settings under a settings disclosure. The stage is
   the hero: it draws the circuit as a duration-proportional timeline with the
   total run time, and the primary Start circuit action sits with it.

   Add step is a chooser, never an appender: it opens the rail's drill list and
   puts the cursor in it, and a step exists only once a drill has been picked.
   appendStep refuses an id that is not a real drill, so nothing can be added from
   a default or a random one.

   Start runs the steps in order in the full-screen focus stage, advancing on the
   drill's own completion or when the cap runs out. Runs and the session are saved
   through ctx.db the same way Train saves them, so Stats and the streak read a
   circuit exactly like a normal set. The model lives in app/lib/circuit.js under
   cortex.circuits, local only.

   One trap worth naming: Circuit.save() normalizes, and normalize rebuilds every
   step object. A row's captured step is therefore stale the moment anything is
   committed, so every edit re-resolves the live step by index (see stepAt).

   Scoped styles, design tokens only, both themes, no gradients, no shadows.
   The .p2-* classes are the shared shell contract; this file defines only .ci-*. */

import * as Circuit from '../lib/circuit.js';

var CACHE_KEY = 'cortex.cache.data';

/* A step appended from the filmstrip or Add step starts at the model's default
   cap, 90 seconds. */
var STEP_SECONDS = 90;

/* Drills whose trials come from a seedable stream, so a fresh seed means a fresh
   sequence for them. Copied from Train: the same map, the same reasoning. */
var SEEDED = { nback: 1, ufov: 1, palace: 1, reasoning: 1, switching: 1, sart: 1 };

/* The nine drills, grouped so the chooser reads as families. Presentation only:
   the registry still owns the list. */
var DRILL_GROUPS = [
  { label: 'Memory', ids: ['nback', 'palace', 'spaced'] },
  { label: 'Attention', ids: ['sart', 'switching'] },
  { label: 'Speed', ids: ['ufov', 'crt'] },
  { label: 'Reasoning', ids: ['reasoning', 'math'] }
];

function h(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function svgEl(tag, attrs) {
  var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) {
    for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
    }
  }
  return n;
}

/* The three step operations, drawn in currentColor so every theme picks them up. */
var ICON_PATHS = {
  up: 'M8 13V3M4 7l4-4 4 4',
  down: 'M8 3v10M4 9l4 4 4-4',
  remove: 'M4 4l8 8M12 4l-8 8'
};

function iconSvg(kind) {
  var svg = svgEl('svg', {
    viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
    'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true', focusable: 'false'
  });
  svg.appendChild(svgEl('path', { d: ICON_PATHS[kind] }));
  return svg;
}

function drillById(id) {
  var D = (globalThis.Content && globalThis.Content.DRILLS) || [];
  for (var i = 0; i < D.length; i++) if (D[i].id === id) return D[i];
  return { id: id, name: id, icon: '', desc: '', direction: 'higher', unit: '' };
}

function clientId() {
  try { if (globalThis.crypto && globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID(); } catch (e) { /* fall through */ }
  return 'run-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function newSeed() {
  var n = Math.floor(Math.random() * 0xffffffff) >>> 0;
  return ('00000000' + n.toString(16)).slice(-8).toUpperCase();
}

function fmtClock(ms) {
  var s = Math.max(0, Math.ceil(ms / 1000));
  var m = Math.floor(s / 60);
  var r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}

function fmtNum(v) {
  if (typeof v !== 'number' || !isFinite(v)) return '';
  return String(Math.round(v * 100) / 100);
}

function dirMap() {
  var m = {};
  var D = (globalThis.Content && globalThis.Content.DRILLS) || [];
  for (var i = 0; i < D.length; i++) m[D[i].id] = D[i].direction === 'lower' ? 'lower' : 'higher';
  return m;
}

/* ---------- data cache, the same shape Train and Stats read ---------- */

function readCache() {
  try { var raw = localStorage.getItem(CACHE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function writeCache(d) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      runs: (d && d.runs) || [],
      sessions: (d && d.sessions) || [],
      cards: (d && d.cards) || []
    }));
  } catch (e) { /* degrade */ }
}
function normRun(r) {
  return {
    drillId: r.drill_id || r.drillId,
    value: Number(r.value),
    unit: r.unit || '',
    t: typeof r.t === 'number' ? r.t : (Date.parse(r.created_at || '') || 0),
    meta: r.meta || null
  };
}
function toState(data) {
  var Store = globalThis.Store;
  var records = ((data && data.runs) || []).map(normRun).filter(function (r) { return r.drillId && isFinite(r.value); });
  var sessions = ((data && data.sessions) || []).map(function (s) {
    return { t: typeof s.t === 'number' ? s.t : (Date.parse(s.created_at || '') || 0), drills: (s.drills || []).slice() };
  });
  var days = [], seen = {};
  for (var i = 0; i < sessions.length; i++) {
    if (!sessions[i].t) continue;
    var k = Store && Store.iso ? Store.iso(new Date(sessions[i].t)) : '';
    if (k && !seen[k]) { seen[k] = 1; days.push(k); }
  }
  return { records: records, sessions: sessions, days: days, cards: ((data && data.cards) || []) };
}

/* ---------- module state ---------- */

var ctxRef = null;
var model = null;
var data = { runs: [], sessions: [], cards: [] };
var state = null;
var ui = {};

/* The runner. One step at a time; a fresh container and a fresh seed per step. */
var run = {
  on: false, scrim: null, stage: null, holder: null, progEl: null,
  index: 0, steps: [], outcomes: [], handle: null, gen: 0,
  cap: null, sessionDrills: [], keyHandler: null, finishing: false, stepStart: 0
};

/* ---------- styles ---------- */

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById('nb-circuit-styles')) return;
  var s = document.createElement('style');
  s.id = 'nb-circuit-styles';
  var ACC = 'var(--accent,var(--lime))';
  var ACC_S = 'var(--accent-soft,var(--lime-soft))';
  var ACC_E = 'var(--accent-edge,var(--lime-edge))';
  s.textContent = [
    /* The view frame. The shell (app/ui/p2.css) owns .p2-shell, .p2-rail, .p2-stage,
       .p2-stage-meta, .p2-start and .p2-chip; everything here is .ci-*. */
    '.ci-view{width:100%;max-width:none;margin-inline:0;justify-content:flex-start;padding-top:var(--gap-4)}',
    '.ci-wrap{width:100%;max-width:none;margin-inline:0;display:flex;flex-direction:column;flex:1 1 auto;min-height:0}',

    /* ---------- rail: the add-a-drill palette, then the ordered step list ---------- */
    '.ci-rail-head{display:flex;align-items:baseline;justify-content:space-between;gap:var(--gap-3)}',
    '.ci-rail-title{margin:0;font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}',
    '.ci-rail-count{font-family:var(--mono);font-size:11.5px;color:var(--dim)}',
    '.ci-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}',
    '.ci-step{border:1px solid var(--line2);border-radius:var(--r);background:var(--panel);padding:11px;display:flex;flex-direction:column;gap:10px;min-width:0}',
    '.ci-step-top{display:flex;align-items:center;gap:8px;min-width:0}',
    '.ci-grip{flex:none;width:10px;height:16px;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(3,1fr);gap:2px;color:var(--line2)}',
    '.ci-grip i{display:block;width:3px;height:3px;border-radius:50%;background:currentColor}',
    '.ci-n{flex:none;width:20px;height:20px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:11px;color:var(--muted);border:1px solid var(--line2)}',
    '.ci-drill{width:100%;min-width:0;max-width:100%;appearance:none;-webkit-appearance:none;background:transparent;border:1px solid transparent;border-radius:6px;color:var(--ink);font-family:var(--sans);font-size:12.5px;font-weight:600;padding:5px 6px;cursor:pointer}',
    '.ci-drill:hover{border-color:var(--line2)}',
    '.ci-ops{margin-left:auto;display:flex;gap:4px;flex:none}',
    '.ci-icon{width:26px;height:26px;flex:none;display:flex;align-items:center;justify-content:center;border:1px solid var(--line2);border-radius:5px;background:transparent;color:var(--muted);cursor:pointer;transition:color .12s ease,border-color .12s ease,background-color .12s ease}',
    '.ci-icon:hover:not(:disabled){color:var(--ink);background:var(--hover)}',
    '.ci-icon:disabled{opacity:.35;cursor:not-allowed}',
    '.ci-icon svg{width:13px;height:13px;display:block}',
    '.ci-icon-rm:hover:not(:disabled){color:var(--warn);border-color:var(--warn)}',
    '.ci-dur{display:flex;align-items:center;gap:9px;min-width:0}',
    '.ci-dur-lbl{flex:none;font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim)}',

    /* segmented controls (duration, and every choice setting) */
    '.ci-seg{display:flex;flex:1 1 auto;min-width:0;border:1px solid var(--line2);border-radius:6px;overflow:hidden}',
    '.ci-seg-btn{flex:1 1 0;min-width:0;display:flex;align-items:center;justify-content:center;padding:6px 2px;background:transparent;border:0;border-right:1px solid var(--line2);color:var(--muted);font-family:var(--mono);font-size:12px;font-variant-numeric:tabular-nums;cursor:pointer;transition:background-color .12s ease,color .12s ease}',
    '.ci-seg-btn:last-child{border-right:0}',
    '.ci-seg-btn:hover{background:var(--hover);color:var(--ink)}',
    '.ci-seg-btn[aria-pressed="true"]{background:' + ACC_S + ';color:' + ACC + ';font-weight:600}',

    /* settings disclosure */
    '.ci-set{border-top:1px solid var(--line2);padding-top:9px}',
    '.ci-set-sum{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-family:var(--sans);font-size:11.5px;font-weight:600;color:var(--muted);transition:color .12s ease}',
    '.ci-set-sum::-webkit-details-marker{display:none}',
    '.ci-set-sum::before{content:"+";font-family:var(--mono);font-size:13px;line-height:1}',
    '.ci-set[open] .ci-set-sum::before{content:"-"}',
    '.ci-set[open] .ci-set-sum{color:' + ACC + '}',
    '.ci-set-body{display:flex;flex-direction:column;gap:var(--gap-3);margin-top:11px}',
    '.ci-field{display:flex;flex-direction:column;gap:7px;min-width:0}',
    '.ci-field-head{display:flex;align-items:baseline;justify-content:space-between;gap:var(--gap-3)}',
    '.ci-field-name{font-family:var(--sans);font-size:12.5px;font-weight:600;color:var(--ink)}',
    '.ci-field-val{font-family:var(--mono);font-size:12px;color:' + ACC + '}',
    '.ci-chips{display:flex;flex-wrap:wrap;gap:6px}',
    '.ci-chips .ci-seg-btn{flex:0 0 auto;border:1px solid var(--line2);border-radius:999px;padding:5px 11px}',
    '.ci-chips .ci-seg-btn[aria-pressed="true"]{border-color:' + ACC_E + ';background:' + ACC_S + ';color:' + ACC + '}',
    '.ci-switch .ci-seg-btn[aria-pressed="true"]{background:' + ACC + ';color:var(--bg)}',
    /* A number past four values is a slider: a bar with an accent fill and the
       value in the field's readout. accent-color fills the track natively, so no
       gradient is needed and the theme still holds. */
    '.ci-range-wrap{display:flex;align-items:center;width:100%;min-width:0}',
    '.ci-range{width:100%;height:24px;margin:0;background:transparent;accent-color:' + ACC + ';cursor:pointer}',

    /* ---------- rail: the add-a-drill palette ---------- */
    /* The nine drills live in the rail, so a step is appended without leaving the
       workspace. Two columns keep it short; the rail scrolls if it runs long. */
    '.ci-palette{display:flex;flex-direction:column;gap:9px}',
    '.ci-palette-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}',
    '.ci-palette-grid .p2-chip{max-width:none;min-width:0;padding:7px 9px;font-size:12px}',
    '.ci-palette-grid .p2-chip-name{min-width:0;overflow:hidden;text-overflow:ellipsis}',
    /* Add step opened the list: a brief accent edge says where to pick. */
    '.ci-palette-ask .ci-palette-grid .p2-chip{border-color:' + ACC_E + '}',
    '.ci-add{width:100%}',

    /* ---------- stage: the duration-proportional timeline ---------- */
    /* The top padding clears the absolutely-positioned meta strip, so a short
       stage never lets the timeline ride up under it. Matches the shared
       .p2-stage-body on the drill screen. */
    '.ci-stage-body{align-self:stretch;width:100%;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:var(--gap-4);padding:44px var(--gap-5) var(--gap-3)}',
    '.ci-total{display:flex;align-items:baseline;gap:var(--gap-3);flex-wrap:wrap}',
    '.ci-total-big{font-family:var(--mono);font-size:clamp(30px,5.5vw,44px);font-weight:650;letter-spacing:-.02em;color:' + ACC + ';line-height:1}',
    '.ci-total-cap{font-size:12px;color:var(--muted)}',
    '.ci-total-steps{margin-left:auto;font-family:var(--mono);font-size:12px;color:var(--dim)}',
    '.ci-track{position:relative;display:flex;height:78px;border:1px solid var(--line2);border-radius:var(--r);overflow:hidden;background:var(--panel2)}',
    '.ci-seg-block{flex:0 0 var(--w,25%);min-width:0;border-right:1px solid var(--line2);display:flex;flex-direction:column;justify-content:center;gap:3px;padding:0 14px;overflow:hidden;transition:filter .12s ease}',
    '.ci-seg-block:last-of-type{border-right:0}',
    '.ci-seg-block:hover{filter:brightness(1.15)}',
    '.ci-sb-top{display:flex;align-items:baseline;gap:8px;min-width:0}',
    '.ci-sb-n{font-family:var(--mono);font-size:11px;color:var(--dim)}',
    '.ci-sb-name{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ci-sb-dur{font-family:var(--mono);font-size:11.5px;color:var(--muted)}',
    '.ci-playhead{position:absolute;top:0;bottom:0;left:0;width:2px;background:' + ACC + '}',
    '.ci-ruler{position:relative;height:24px;margin:0 2px}',
    '.ci-tick{position:absolute;top:0;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:3px}',
    '.ci-tick i{display:block;width:1px;height:6px;background:var(--line2)}',
    '.ci-tick-major i{height:9px;background:var(--muted)}',
    '.ci-tick b{font-family:var(--mono);font-size:10.5px;font-weight:500;color:var(--dim);white-space:nowrap}',

    '.ci-empty{margin:0;color:var(--dim);font-size:12.5px;line-height:1.5}',

    /* focus-visible rings on every real control this view owns */
    '.ci-drill:focus-visible,.ci-seg-btn:focus-visible,.ci-range:focus-visible,.ci-icon:focus-visible,.ci-set-sum:focus-visible,.ci-chip:focus-visible,.ci-add:focus-visible,.ci-res-act:focus-visible,.nb-focus-btn:focus-visible,.nb-exit-btn:focus-visible{outline:2px solid ' + ACC + ';outline-offset:2px}',

    /* Results: the circuit's own summary, rendered in the stage, then one line
       per step, then the actions. Token-only, no shadows. */
    '.ci-res-stage{display:block;overflow-y:auto;padding:var(--gap-5) var(--gap-5) var(--gap-4)}',
    '.ci-res{display:flex;flex-direction:column;gap:var(--gap-3);width:100%;max-width:640px;margin-inline:auto}',
    '.ci-res-title{margin:0;font-size:20px;font-weight:600;letter-spacing:-.015em}',
    '.ci-res-totals{display:flex;align-items:baseline;gap:var(--gap-3);flex-wrap:wrap;padding-bottom:var(--gap-2);border-bottom:1px solid var(--line2)}',
    '.ci-res-big{font-family:var(--mono);font-size:clamp(24px,3.4vw,32px);font-weight:650;letter-spacing:-.02em;color:' + ACC + ';line-height:1}',
    '.ci-res-total-cap{font-size:12px;color:var(--muted)}',
    '.ci-res-total-steps{margin-left:auto;font-family:var(--mono);font-size:12px;color:var(--dim)}',
    '.ci-res-overall{margin:0;font-size:13px;color:var(--muted)}',
    '.ci-res-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}',
    '.ci-res-item{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;padding:10px 0;border-top:1px solid var(--line2);font-size:14px}',
    '.ci-res-item:first-child{border-top:0}',
    '.ci-res-n{flex:none;width:18px;font-family:var(--mono);font-size:11px;color:var(--dim)}',
    '.ci-res-name{color:var(--ink)}',
    '.ci-res-dur{font-family:var(--mono);font-size:12px;color:var(--dim)}',
    '.ci-res-out{margin-left:auto;color:var(--muted);font-variant-numeric:tabular-nums;text-align:right}',
    '.ci-res-out.mono{color:var(--ink)}',
    '.ci-res-actions{display:flex;gap:var(--gap-5);flex-wrap:wrap;margin-top:var(--gap-2)}',
    '.ci-res-act{background:none;border:0;padding:6px 0;font-family:var(--sans);font-size:15px;font-weight:600;color:var(--muted);cursor:pointer;transition:color .15s ease}',
    '.ci-res-act:hover{color:var(--ink)}',
    '.ci-res-again{color:' + ACC + '}',

    /* Focus stage: reuse focus.css. Only the progress readout needs a rule. */
    '.nb-focus-stage .ci-prog{font-family:var(--mono);font-size:11px;letter-spacing:.06em;color:var(--muted);white-space:nowrap}',

    '@media (max-width:560px){.ci-total-steps{display:none}.ci-seg-btn{font-size:11.5px;padding:6px 1px}.ci-stage-body{padding:34px var(--gap-4) var(--gap-3);gap:var(--gap-3)}.ci-track{height:58px}}',
    '@media (max-width:380px){.ci-sb-name{display:none}.ci-total-big{font-size:28px}}',
    /* On phones the shell stacks. The hero comes first here too, the same order
       the drill screen uses: stage (with Start circuit), then the rail, which now
       holds both the add-a-drill palette and the step list and scrolls inside its
       own row. The stage floor keeps the timeline and its Start whole on a short
       viewport but yields to 62% of the shell so the rail always keeps a usable
       row of its own. Scoped to .ci-view, so the shared shell keeps its own order
       for anything else. */
    '@media (max-width:720px){.ci-view .p2-shell{grid-template-rows:minmax(min(260px,62%),1.3fr) minmax(0,1fr)}.ci-view .p2-stage{grid-row:1}.ci-view .p2-rail{grid-row:2;border-right:0;border-top:1px solid var(--line)}}',
    '@media (prefers-reduced-motion:reduce){.ci-seg-btn,.ci-icon,.ci-set-sum,.ci-seg-block,.ci-res-act{transition:none}}'
  ].join('');
  document.head.appendChild(s);
}

/* ---------- small live region ---------- */

function say(msg) {
  var n = ui.live;
  if (!n) return;
  n.textContent = '';
  window.setTimeout(function () { n.textContent = msg; }, 30);
}

/* ---------- builder ---------- */

function activeCircuit() { return Circuit.activeOf(model); }

function commitModel() {
  model = Circuit.save(model);
}

/* Swap one node for another in place. removeChild + appendChild rather than
   replaceChild, because the two fake DOMs the test suite mounts views against
   implement the former and not the latter. The shell has exactly two children
   (rail, stage) and the stage is always the last, so appending lands it in the
   same slot. */
function swapNode(oldNode, nextNode) {
  var parent = oldNode && oldNode.parentNode;
  if (!parent) return false;
  parent.removeChild(oldNode);
  parent.appendChild(nextNode);
  return true;
}

/* The stage reads the model, so a commit that changes the timeline has to repaint
   it. Swapping just the stage node keeps the rail, its scroll position and the
   focused control exactly where they were. */
function refreshStage() {
  if (!ui.stage) return;
  var next = buildStage();
  if (!swapNode(ui.stage, next)) return;
  ui.stage = next;
}

/* A row's identity is its index: it stays valid while the row is on screen,
   because every add, remove and reorder rebuilds the whole rail. save() rebuilds
   the step objects, so an edit must never trust the object it captured at build
   time, or the second change on a row writes into a detached copy and is lost. */
function stepAt(index) {
  var c = activeCircuit();
  return (c && c.steps && c.steps[index]) || null;
}

/* The chooser: a native grouped select. Same four families as the Drills picker,
   in one compact control per step, so a list of steps stays scannable and the
   whole thing is keyboard-operable without a custom roving tabindex per row. */
function buildDrillChooser(step, index) {
  var sel = h('select', 'ci-drill');
  sel.setAttribute('aria-label', 'Drill for step ' + (index + 1));
  var D = (globalThis.Content && globalThis.Content.DRILLS) || [];
  var byId = {};
  D.forEach(function (p) { byId[p.id] = p; });
  var seen = {};
  var groups = [];
  DRILL_GROUPS.forEach(function (g) {
    var ids = g.ids.filter(function (id) { return byId[id] && !seen[id]; });
    ids.forEach(function (id) { seen[id] = 1; });
    if (ids.length) groups.push({ label: g.label, ids: ids });
  });
  var rest = D.map(function (p) { return p.id; }).filter(function (id) { return !seen[id]; });
  if (rest.length) groups.push({ label: 'More', ids: rest });
  groups.forEach(function (g) {
    var og = document.createElement('optgroup');
    og.setAttribute('label', g.label);
    g.ids.forEach(function (id) {
      var o = document.createElement('option');
      o.value = id;
      o.textContent = byId[id].name;
      if (id === step.drillId) o.selected = true;
      og.appendChild(o);
    });
    sel.appendChild(og);
  });
  sel.addEventListener('change', function () {
    var live = stepAt(index) || step;
    live.drillId = sel.value;
    live.options = {};
    commitModel();
    showBuilder();
  });
  return sel;
}

function buildDuration(step, index) {
  var seg = h('div', 'ci-seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Duration in seconds');
  Circuit.DURATIONS.forEach(function (sec) {
    var b = h('button', 'ci-seg-btn', sec === 0 ? 'Off' : String(sec));
    b.type = 'button';
    b._v = sec;
    b.setAttribute('aria-pressed', step.seconds === sec ? 'true' : 'false');
    b.setAttribute('aria-label', sec === 0 ? 'No limit' : sec + ' seconds');
    b.addEventListener('click', function () {
      var live = stepAt(index);
      if (!live) return;
      live.seconds = sec;
      markPressed(seg, live.seconds, false);
      commitModel();
      refreshStage();
      say(sec === 0 ? 'Step runs to completion.' : 'Step capped at ' + sec + ' seconds.');
    });
    seg.appendChild(b);
  });
  return seg;
}

function markPressed(seg, active, multi) {
  for (var i = 0; i < seg.children.length; i++) {
    var b = seg.children[i];
    var on = multi ? (Array.isArray(active) && active.indexOf(b._v) >= 0) : (b._v === active);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

function optionReadout(entry, current) {
  var type = entry.type || 'number';
  if (type === 'toggle') return current ? 'On' : 'Off';
  if (type === 'choice') {
    if (entry.multi) {
      var on = entry.options.filter(function (o) { return current && current.indexOf(o.value) >= 0; });
      return on.length ? on.map(function (o) { return o.label; }).join(', ') : 'None';
    }
    for (var i = 0; i < entry.options.length; i++) if (entry.options[i].value === current) return entry.options[i].label;
    return String(current);
  }
  return String(current);
}

function segGroup(entry, variant) {
  var seg = h('div', 'ci-seg ' + variant);
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', entry.label);
  return seg;
}

/* One setting: label and value on a line, the control under it, so the narrow
   rail stays readable. The control updates its own pressed state, so changing a
   value never rebuilds the list or moves focus. */
function buildSettingRow(step, entry, index) {
  var current = step.options ? step.options[entry.key] : undefined;
  var field = h('div', 'ci-field');
  var head = h('div', 'ci-field-head');
  head.appendChild(h('span', 'ci-field-name', entry.label));
  /* Held so a slider can follow the drag on the readout without a rebuild. */
  var readout = h('span', 'ci-field-val mono', optionReadout(entry, current));
  head.appendChild(readout);
  field.appendChild(head);

  var type = entry.type || 'number';
  if (type === 'toggle') field.appendChild(buildToggle(step, entry, current, index));
  else if (type === 'choice') field.appendChild(entry.multi ? buildMulti(step, entry, current, index) : buildChoice(step, entry, current, index));
  else field.appendChild(buildNumber(step, entry, current, readout, index));
  return field;
}

/* One setting committed in place: the control updates its own state, so changing
   a value never rebuilds the list or moves focus. Returns the stored value, which
   the store may have snapped. */
function commitSetting(step, entry, value, seg, multi, index) {
  var live = stepAt(index) || step;
  live.options = live.options || {};
  live.options[entry.key] = value;
  var v = Circuit.validate(live);
  live.options = v ? v.options : live.options;
  if (seg) markPressed(seg, live.options[entry.key], multi);
  commitModel();
  say(entry.label + ' set to ' + optionReadout(entry, live.options[entry.key]) + '.');
  return live.options[entry.key];
}

/* A number on a segmented bar works while the whole set fits on one line. Past
   four values it becomes a slider, the same rule the drill screen uses: a bar
   with an accent fill and the value in the field's readout. */
var SEG_MAX = 4;

function numberValues(entry) {
  var count = Math.round((entry.max - entry.min) / entry.step) + 1;
  var out = [];
  for (var k = 0; k < count; k++) out.push(Math.round((entry.min + k * entry.step) * 1e10) / 1e10);
  return out;
}

/* A slider's raw string back to a spec value: snapped to the step grid and
   rounded, so a 0.05 step does not leave float noise behind. */
function sliderValue(raw, entry) {
  var v = Number(raw);
  if (!isFinite(v)) return entry.def;
  var snapped = entry.min + Math.round((v - entry.min) / entry.step) * entry.step;
  return Math.round(snapped * 1e10) / 1e10;
}

function buildNumber(step, entry, current, readout, index) {
  var values = numberValues(entry);
  if (values.length > SEG_MAX) return buildRange(step, entry, current, readout, index);
  var seg = segGroup(entry, 'ci-seg-bar');
  values.forEach(function (value) {
    var b = h('button', 'ci-seg-btn', String(value));
    b.type = 'button';
    b._v = value;
    b.setAttribute('aria-pressed', value === current ? 'true' : 'false');
    b.addEventListener('click', function () { commitSetting(step, entry, value, seg, false, index); });
    seg.appendChild(b);
  });
  return seg;
}

/* A real range input. The readout follows the drag live and the value is
   committed on release without rebuilding the node, so neither the drag nor the
   focus is pulled out from under the pointer. */
function buildRange(step, entry, current, readout, index) {
  var wrap = h('div', 'ci-range-wrap');
  var input = document.createElement('input');
  input.type = 'range';
  input.className = 'ci-range';
  input.min = String(entry.min);
  input.max = String(entry.max);
  input.step = String(entry.step);
  input.value = String(current);
  input.setAttribute('aria-label', entry.label);
  input.setAttribute('aria-valuetext', optionReadout(entry, current));
  input.addEventListener('input', function () {
    var text = optionReadout(entry, sliderValue(input.value, entry));
    if (readout) readout.textContent = text;
    input.setAttribute('aria-valuetext', text);
  });
  input.addEventListener('change', function () {
    var stored = commitSetting(step, entry, sliderValue(input.value, entry), null, false, index);
    if (readout) readout.textContent = optionReadout(entry, stored);
  });
  wrap.appendChild(input);
  return wrap;
}

function buildToggle(step, entry, current, index) {
  var seg = segGroup(entry, 'ci-switch');
  [[false, 'Off'], [true, 'On']].forEach(function (pair) {
    var b = h('button', 'ci-seg-btn', pair[1]);
    b.type = 'button';
    b._v = pair[0];
    b.setAttribute('aria-pressed', current === pair[0] ? 'true' : 'false');
    b.addEventListener('click', function () { commitSetting(step, entry, pair[0], seg, false, index); });
    seg.appendChild(b);
  });
  return seg;
}

function buildChoice(step, entry, current, index) {
  var seg = segGroup(entry, 'ci-seg-bar');
  entry.options.forEach(function (o) {
    var b = h('button', 'ci-seg-btn', o.label);
    b.type = 'button';
    b._v = o.value;
    b.setAttribute('aria-pressed', current === o.value ? 'true' : 'false');
    b.addEventListener('click', function () { commitSetting(step, entry, o.value, seg, false, index); });
    seg.appendChild(b);
  });
  return seg;
}

function buildMulti(step, entry, current, index) {
  var seg = segGroup(entry, 'ci-chips');
  var on = Array.isArray(current) ? current.slice() : [];
  entry.options.forEach(function (o) {
    var b = h('button', 'ci-seg-btn', o.label);
    b.type = 'button';
    b._v = o.value;
    b.setAttribute('aria-pressed', on.indexOf(o.value) >= 0 ? 'true' : 'false');
    b.addEventListener('click', function () {
      var next = on.slice();
      var at = next.indexOf(o.value);
      if (at >= 0) {
        next.splice(at, 1);
        if (!next.length) { say('Keep at least one option on.'); return; }
      } else {
        next.push(o.value);
      }
      on = next;
      commitSetting(step, entry, next, seg, true, index);
    });
    seg.appendChild(b);
  });
  return seg;
}

function buildSettings(step, index) {
  var det = h('details', 'ci-set');
  var sum = h('summary', 'ci-set-sum', 'settings');
  sum.setAttribute('aria-label', 'Settings for step ' + (index + 1));
  det.appendChild(sum);
  var body = h('div', 'ci-set-body');
  var spec = Circuit.optionSpecFor(step.drillId);
  if (!spec.length) {
    body.appendChild(h('p', 'ci-empty', 'This drill has no settings.'));
  } else {
    for (var i = 0; i < spec.length; i++) body.appendChild(buildSettingRow(step, spec[i], index));
  }
  det.appendChild(body);
  return det;
}

function moveStep(from, to) {
  var steps = activeCircuit().steps;
  if (to < 0 || to >= steps.length) return;
  var s = steps.splice(from, 1)[0];
  steps.splice(to, 0, s);
  commitModel();
  showBuilder();
}

function removeStep(index) {
  activeCircuit().steps.splice(index, 1);
  commitModel();
  showBuilder();
  say('Step removed.');
}

/* Append one step for a drill, at the default cap. The only entry point is an
   explicit pick in the rail's drill list, and the pick is put through the same
   validate() the store uses, so a missing or unknown drill id is refused rather
   than turned into a default. No step can appear without a drill the user chose. */
function appendStep(drillId) {
  var step = Circuit.validate({ drillId: drillId, seconds: STEP_SECONDS, options: {} });
  if (!step) { say('Pick a drill to add as a step.'); return; }
  activeCircuit().steps.push(step);
  commitModel();
  showBuilder();
  say(drillById(step.drillId).name + ' added as a step.');
}

/* Add step is a chooser, not an appender. It opens the rail's drill list and puts
   the cursor in it, so the step is only created once a drill has been picked. */
function askForDrill() {
  var picker = ui.palette;
  if (!picker) return;
  var first = picker.querySelector('.p2-chip');
  if (!first) return;
  picker.classList.add('ci-palette-ask');
  window.setTimeout(function () {
    if (ui.palette === picker) picker.classList.remove('ci-palette-ask');
  }, 1800);
  try {
    if (first.scrollIntoView) first.scrollIntoView({ block: 'nearest' });
    first.focus();
  } catch (e) { /* degrade */ }
  say('Pick a drill to add as a step.');
}

function iconBtn(kind, disabled, label, onClick, extra) {
  var b = h('button', 'ci-icon' + (extra ? ' ' + extra : ''));
  b.type = 'button';
  b.setAttribute('aria-label', label);
  if (disabled) b.disabled = true;
  b.appendChild(iconSvg(kind));
  b.addEventListener('click', onClick);
  return b;
}

function buildStepRow(step, index, count) {
  var li = h('li', 'ci-step');

  var top = h('div', 'ci-step-top');
  var grip = h('span', 'ci-grip');
  grip.setAttribute('aria-hidden', 'true');
  for (var g = 0; g < 6; g++) grip.appendChild(h('i'));
  top.appendChild(grip);
  top.appendChild(h('span', 'ci-n mono', String(index + 1)));

  var ops = h('div', 'ci-ops');
  ops.appendChild(iconBtn('up', index === 0, 'Move step ' + (index + 1) + ' up', function () { moveStep(index, index - 1); }));
  ops.appendChild(iconBtn('down', index === count - 1, 'Move step ' + (index + 1) + ' down', function () { moveStep(index, index + 1); }));
  ops.appendChild(iconBtn('remove', false, 'Remove step ' + (index + 1), function () { removeStep(index); }, 'ci-icon-rm'));
  top.appendChild(ops);
  li.appendChild(top);

  /* The drill chooser gets its own full-width row, so the step's drill name is
     readable rather than clipped inside the header row. */
  li.appendChild(buildDrillChooser(step, index));

  var dur = h('div', 'ci-dur');
  dur.appendChild(h('span', 'ci-dur-lbl', 'Run'));
  dur.appendChild(buildDuration(step, index));
  li.appendChild(dur);

  li.appendChild(buildSettings(step, index));
  return li;
}

/* ---------- the stage: total time and the proportional timeline ---------- */

/* A step set to Off has no fixed length, so it has no share of the scale. It is
   drawn at a nominal width so it stays visible and labelled "open", and the
   numeric total counts only the fixed caps. */
var OPEN_WEIGHT = 60;

function buildTimeline(steps) {
  var totalFixed = 0, sumW = 0, open = 0, weights = [];
  for (var i = 0; i < steps.length; i++) {
    var sec = steps[i].seconds;
    var w;
    if (sec > 0) { w = sec; totalFixed += sec; } else { w = OPEN_WEIGHT; open++; }
    weights.push(w);
    sumW += w;
  }

  var tl = h('div', 'ci-stage-body');

  var total = h('div', 'ci-total');
  total.appendChild(h('span', 'ci-total-big mono', totalFixed > 0 ? fmtClock(totalFixed * 1000) : 'Open'));
  total.appendChild(h('span', 'ci-total-cap', open > 0 ? 'total run time, plus open steps' : 'total run time'));
  var fixed = [];
  for (var p = 0; p < steps.length; p++) if (steps[p].seconds > 0) fixed.push(String(steps[p].seconds));
  var breakdown = fixed.length ? fixed.join(' + ') + ' s' : '';
  if (open) breakdown += (breakdown ? ' + ' : '') + open + ' open';
  total.appendChild(h('span', 'ci-total-steps mono', breakdown));
  tl.appendChild(total);

  var track = h('div', 'ci-track');
  for (var j = 0; j < steps.length; j++) {
    var block = h('div', 'ci-seg-block');
    block.setAttribute('style', '--w:' + (sumW ? (weights[j] / sumW) * 100 : 0) + '%');
    var bTop = h('span', 'ci-sb-top');
    bTop.appendChild(h('span', 'ci-sb-n mono', String(j + 1)));
    bTop.appendChild(h('span', 'ci-sb-name', drillById(steps[j].drillId).name));
    block.appendChild(bTop);
    block.appendChild(h('span', 'ci-sb-dur mono', steps[j].seconds > 0 ? steps[j].seconds + ' s' : 'open'));
    track.appendChild(block);
  }
  var playhead = h('span', 'ci-playhead');
  playhead.setAttribute('aria-hidden', 'true');
  track.appendChild(playhead);
  tl.appendChild(track);

  var ruler = h('div', 'ci-ruler');
  ruler.setAttribute('aria-hidden', 'true');
  var fracs = [0, 0.25, 0.5, 0.75, 1];
  for (var f = 0; f < fracs.length; f++) {
    var tick = h('span', 'ci-tick' + (f === 0 || f === 2 || f === 4 ? ' ci-tick-major' : ''));
    tick.setAttribute('style', 'left:' + (fracs[f] * 100) + '%');
    tick.appendChild(h('i'));
    if (open === 0 || f === 0 || f === 4) tick.appendChild(h('b', null, String(Math.round(totalFixed * fracs[f]))));
    ruler.appendChild(tick);
  }
  tl.appendChild(ruler);

  return tl;
}

function buildStage() {
  var steps = activeCircuit().steps;
  var stage = h('section', 'p2-stage');
  stage.setAttribute('aria-label', 'Circuit stage');

  var meta = h('div', 'p2-stage-meta', 'Timeline \u00b7 ' + steps.length + (steps.length === 1 ? ' step' : ' steps'));
  stage.appendChild(meta);

  if (steps.length) {
    stage.appendChild(buildTimeline(steps));
  } else {
    var empty = h('div', 'ci-stage-body');
    empty.appendChild(h('p', 'ci-empty', 'No steps yet.'));
    stage.appendChild(empty);
  }

  /* The Start is the last item in the stage's centred column, the same place the
     drill screen puts its own: with the timeline it starts, not floating at an
     edge of the frame. */
  var start = h('button', 'btn-primary p2-start ci-start', 'Start circuit');
  start.type = 'button';
  start.disabled = !steps.length;
  start.addEventListener('click', function () { startRun(); });
  stage.appendChild(start);
  return stage;
}

/* ---------- the rail's add-a-drill palette: every drill, one click to append ---------- */

/* Grouped in the same four families as the step chooser, in two columns, so the
   whole registry is reachable without leaving the rail. Every chip is a real
   button, so tab and enter work with no custom key handling. */
function buildPalette() {
  var block = h('div', 'ci-palette');
  block.setAttribute('role', 'group');
  block.setAttribute('aria-label', 'Add a drill as a step');
  block.appendChild(h('p', 'ci-rail-title', 'Add a drill'));

  var grid = h('div', 'ci-palette-grid');
  var D = (globalThis.Content && globalThis.Content.DRILLS) || [];
  var byId = {};
  for (var b = 0; b < D.length; b++) byId[D[b].id] = D[b];
  var seen = {};
  var groups = [];
  DRILL_GROUPS.forEach(function (g) {
    var ids = g.ids.filter(function (id) { return byId[id] && !seen[id]; });
    ids.forEach(function (id) { seen[id] = 1; });
    if (ids.length) groups.push(ids);
  });
  var rest = D.map(function (p) { return p.id; }).filter(function (id) { return !seen[id]; });
  if (rest.length) groups.push(rest);

  groups.forEach(function (ids) {
    ids.forEach(function (id) {
      var d = byId[id];
      var chip = h('button', 'p2-chip ci-chip');
      chip.type = 'button';
      chip.setAttribute('aria-label', 'Add ' + d.name + ' as a step');
      chip.title = d.name;
      var art = h('span', 'p2-chip-art');
      art.setAttribute('aria-hidden', 'true');
      /* The registry icon is a trusted, static SVG string from content.js, not
         user text, so it is the one place innerHTML is used. */
      if (d.icon) art.innerHTML = d.icon;
      chip.appendChild(art);
      chip.appendChild(h('span', 'p2-chip-name', d.name));
      chip.addEventListener('click', function () { appendStep(id); });
      grid.appendChild(chip);
    });
  });
  block.appendChild(grid);
  return block;
}

function buildRail() {
  var steps = activeCircuit().steps;
  var rail = h('aside', 'p2-rail');
  rail.setAttribute('aria-label', 'Circuit steps');

  var head = h('div', 'ci-rail-head');
  head.appendChild(h('p', 'ci-rail-title', 'Steps'));
  head.appendChild(h('span', 'ci-rail-count mono', String(steps.length)));
  rail.appendChild(head);

  /* The drill list and the Add step control travel together and sit above the
     step list, so both are in view at the top of the rail without scrolling it
     however many steps the circuit has. */
  ui.palette = buildPalette();
  rail.appendChild(ui.palette);

  /* Opens the drill list directly above. It never appends on its own: a step
     exists only after a drill has been picked. */
  var add = h('button', 'btn-ghost ci-add', 'Add step');
  add.type = 'button';
  add.addEventListener('click', askForDrill);
  rail.appendChild(add);

  if (!steps.length) {
    rail.appendChild(h('p', 'ci-empty', 'No steps yet.'));
  } else {
    var list = h('ol', 'ci-steps');
    for (var i = 0; i < steps.length; i++) list.appendChild(buildStepRow(steps[i], i, steps.length));
    rail.appendChild(list);
  }
  return rail;
}

function showBuilder() {
  if (!ui.root) return;
  ui.root.replaceChildren();

  var shell = h('div', 'p2-shell');
  shell.appendChild(buildRail());
  ui.stage = buildStage();
  shell.appendChild(ui.stage);
  ui.root.appendChild(shell);

  var live = h('div', 'sr');
  live.setAttribute('aria-live', 'polite');
  ui.root.appendChild(live);
  ui.live = live;
}

/* ---------- recording, mirrors Train ---------- */

function recordRun(rec) {
  var Store = globalThis.Store;
  var d = drillById(rec.drillId);
  var isPR = (Store && typeof Store.isPersonalBest === 'function' && state) ? Store.isPersonalBest(state, rec, dirMap()) : false;
  if (Store && typeof Store.record === 'function' && state) Store.record(state, rec);
  var row = {
    drillId: rec.drillId, value: rec.value, unit: rec.unit || '',
    meta: rec.meta || {}, t: rec.t || Date.now(), clientId: clientId()
  };
  data.runs = data.runs || [];
  data.runs.push({
    drill_id: row.drillId, value: row.value, unit: row.unit, meta: row.meta,
    created_at: new Date(row.t).toISOString(), client_id: row.clientId
  });
  writeCache(data);
  if (ctxRef && ctxRef.db && ctxRef.db.saveRun) ctxRef.db.saveRun(row);
  return { isPR: isPR, value: rec.value, unit: rec.unit || d.unit || '' };
}

function saveSession(drills) {
  if (!drills.length) return;
  var Store = globalThis.Store;
  var t = Date.now();
  var s = { t: t, drills: drills.slice(), clientId: clientId() };
  if (state && Store && typeof Store.iso === 'function') {
    state.sessions.push({ t: t, drills: s.drills });
    var k = Store.iso(new Date(t));
    if (state.days.indexOf(k) === -1) state.days.push(k);
  }
  data.sessions = data.sessions || [];
  data.sessions.push({ drills: s.drills, created_at: new Date(t).toISOString(), client_id: s.clientId });
  writeCache(data);
  if (ctxRef && ctxRef.db && ctxRef.db.saveSession) ctxRef.db.saveSession(s);
  if (ctxRef && ctxRef.audio && ctxRef.audio.playSfx) {
    try { ctxRef.audio.playSfx('complete'); } catch (e) { /* degrade */ }
  }
}

/* ---------- runner ---------- */

function paintProgress() {
  if (!run.progEl) return;
  var step = run.steps[run.index];
  if (!step) return;
  var text = 'Step ' + (run.index + 1) + ' of ' + run.steps.length + ' \u00b7 ' + drillById(step.drillId).name;
  if (run.cap && step.seconds > 0) text += ' \u00b7 ' + fmtClock(run.cap.remaining) + ' left';
  run.progEl.textContent = text;
}

function clearCap() {
  if (run.cap && run.cap.timer) clearInterval(run.cap.timer);
  run.cap = null;
}

function startCap(seconds) {
  clearCap();
  /* A finished circuit must never arm a new cap: the last step can complete
     synchronously inside start(), and finishRun does not bump run.gen, so the
     frame that launched it can still be live. */
  if (!seconds || run.finishing) return;
  run.cap = { remaining: seconds * 1000, last: Date.now(), timer: 0, done: false };
  run.cap.timer = setInterval(capTick, 200);
}

/* Pause-aware: the remaining time does not drain while the tab is hidden, so a
   step is never cut short by the browser throttling the interval. */
function capTick() {
  var c = run.cap;
  if (!c || c.done || run.finishing) return;
  /* A stale interval must never score a step the circuit has already left. */
  if (!run.steps[run.index]) { clearCap(); return; }
  var now = Date.now();
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { c.last = now; return; }
  c.remaining -= (now - c.last);
  c.last = now;
  if (c.remaining <= 0) {
    c.remaining = 0;
    c.done = true;
    paintProgress();
    capHit();
    return;
  }
  paintProgress();
}

function stopHandle() {
  if (run.handle && run.handle.stop) run.handle.stop();
  run.handle = null;
}

/* ponytail: a capped or skipped step that never finished naturally records no
   run, because the drill registry exposes no partial completion. It is marked in
   the results and left out of the session, so nothing is invented. If a drill
   ever reports partials, record them here instead. */
function finishStep(kind, rec) {
  stopHandle();
  clearCap();
  var step = run.steps[run.index];
  var outcome = {
    step: step, drillId: step.drillId, kind: kind, rec: rec || null,
    seconds: step.seconds,
    elapsed: run.stepStart ? Math.max(0, Date.now() - run.stepStart) : 0
  };
  if (kind === 'done') {
    var summary = recordRun(rec);
    outcome.value = summary.value;
    outcome.unit = summary.unit;
    outcome.isPR = summary.isPR;
    run.sessionDrills.push(step.drillId);
  }
  run.outcomes.push(outcome);
  run.index++;
  runStep();
}

function runStep() {
  if (run.finishing) return;
  stopHandle();
  clearCap();
  if (run.index >= run.steps.length) { finishRun(false); return; }
  var step = run.steps[run.index];
  run.stepStart = Date.now();
  paintProgress();

  run.holder.replaceChildren();
  var mount = h('div', 'drill-mount');
  run.holder.appendChild(mount);

  /* A generation token: a drill that completes synchronously inside start()
     would otherwise advance the circuit and then have this frame assign a stale
     handle and start a stale cap on top of the next step. */
  var gen = ++run.gen;
  var seed = newSeed();
  var Drills = globalThis.Drills;
  if (!Drills || typeof Drills.start !== 'function') {
    /* No engine (a test or a partial bundle): skip to results rather than hang. */
    finishRun(true);
    return;
  }
  run.handle = Drills.start(step.drillId, mount, {
    cards: state ? state.cards : [],
    mode: step.mode,
    seed: SEEDED[step.drillId] ? seed : undefined,
    options: Circuit.optionsFor(step.drillId, step.options),
    onCards: function (cards) {
      if (state) state.cards = cards;
      data.cards = cards;
      writeCache(data);
      if (ctxRef && ctxRef.db && ctxRef.db.saveCards) ctxRef.db.saveCards(cards);
    },
    onComplete: function (rec) {
      if (gen !== run.gen) return;
      if (rec) {
        rec.meta = rec.meta || {};
        rec.meta.seed = seed;
        if (step.mode) rec.meta.mode = step.mode;
      }
      finishStep('done', rec);
    }
  });
  if (gen !== run.gen || run.finishing) return;
  startCap(step.seconds);
  paintProgress();
}

function capHit() {
  say('Step timed out.');
  finishStep('timeout', null);
}

function skipStep() {
  say('Step skipped.');
  finishStep('skip', null);
}

function endCircuit() { finishRun(true); }

function enterStage() {
  var scrim = h('div', 'nb-focus-scrim');
  var stage = h('div', 'nb-focus-stage');
  var bar = h('div', 'nb-focus-bar');
  bar.appendChild(h('p', 'nb-focus-title', activeCircuit().name));

  var prog = h('span', 'ci-prog', '');
  bar.appendChild(prog);
  bar.appendChild(h('div', 'nb-focus-spacer'));

  var skip = h('button', 'nb-focus-btn', 'Skip step');
  skip.type = 'button';
  skip.addEventListener('click', skipStep);
  var end = h('button', 'nb-exit-btn', 'End circuit');
  end.type = 'button';
  end.addEventListener('click', endCircuit);
  bar.appendChild(skip);
  bar.appendChild(end);

  var holder = h('div', 'drill-mount');
  stage.appendChild(bar);
  stage.appendChild(holder);

  document.body.appendChild(scrim);
  document.body.appendChild(stage);
  document.body.classList.add('focus');

  run.scrim = scrim;
  run.stage = stage;
  run.holder = holder;
  run.progEl = prog;

  run.keyHandler = function (e) {
    if (e.key === 'Escape' && run.on) { e.preventDefault(); endCircuit(); }
  };
  document.addEventListener('keydown', run.keyHandler, true);
  try { end.focus(); } catch (e) { /* degrade */ }
}

function leaveStage() {
  if (run.keyHandler) {
    document.removeEventListener('keydown', run.keyHandler, true);
    run.keyHandler = null;
  }
  if (run.scrim && run.scrim.parentNode) run.scrim.parentNode.removeChild(run.scrim);
  if (run.stage && run.stage.parentNode) run.stage.parentNode.removeChild(run.stage);
  document.body.classList.remove('focus');
  run.scrim = null;
  run.stage = null;
  run.holder = null;
  run.progEl = null;
}

function startRun() {
  var steps = [];
  var raw = activeCircuit().steps;
  for (var i = 0; i < raw.length; i++) {
    var v = Circuit.validate(raw[i]);
    if (v) steps.push(v);
  }
  if (!steps.length) return;
  if (ctxRef && ctxRef.audio && ctxRef.audio.resume) {
    try { ctxRef.audio.resume(); } catch (e) { /* degrade */ }
  }
  run.on = true;
  run.finishing = false;
  run.steps = steps;
  run.index = 0;
  run.outcomes = [];
  run.sessionDrills = [];
  run.cap = null;
  enterStage();
  runStep();
}

function finishRun() {
  if (run.finishing) return;
  run.finishing = true;
  stopHandle();
  clearCap();
  leaveStage();
  run.on = false;
  if (ctxRef && ctxRef.audio && ctxRef.audio.silence) {
    try { ctxRef.audio.silence(); } catch (e) { /* degrade */ }
  }
  saveSession(run.sessionDrills);
  var outcomes = run.outcomes.slice();
  var planned = run.steps.length;
  run.sessionDrills = [];
  showResults(outcomes, planned);
}

/* ---------- results ---------- */

/* Elapsed time, rounded to the nearest second: a 30 s cap ran for 30 s, not the
   0:31 a countdown's ceiling would print. */
function fmtElapsed(ms) {
  var s = Math.max(0, Math.round((ms || 0) / 1000));
  var m = Math.floor(s / 60);
  var r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}

/* The whole circuit, not just a list: circuit totals, then one honest line per
   step. A step the cap cut short records no run (the drill registry reports no
   partial), so it says so instead of printing a number nobody measured.

   It renders in the stage, so the shell (and the page pin that keeps the screen
   from scrolling) stays up and the rail is still there to run the circuit again
   or edit it. Editing a duration from the rail repaints the timeline back over
   the summary, which is the builder again. */
function showResults(outcomes, planned) {
  if (!ui.root) return;
  /* The shell has to be up for the summary to land in the stage. */
  if (!ui.root.querySelector('.p2-shell') || !ui.stage || !ui.stage.parentNode) showBuilder();

  var done = 0, timedOut = 0, skipped = 0, totalMs = 0;
  for (var c = 0; c < outcomes.length; c++) {
    if (outcomes[c].kind === 'done') done++;
    else if (outcomes[c].kind === 'timeout') timedOut++;
    else skipped++;
    totalMs += outcomes[c].elapsed || 0;
  }
  var plannedCount = (typeof planned === 'number' && planned > outcomes.length) ? planned : outcomes.length;

  var stage = h('section', 'p2-stage ci-res-stage');
  stage.setAttribute('aria-label', 'Circuit result');
  stage.appendChild(h('div', 'p2-stage-meta', 'Results \u00b7 ' + outcomes.length + ' of ' + plannedCount + (plannedCount === 1 ? ' step' : ' steps')));

  var view = h('div', 'ci-res');
  view.appendChild(h('h2', 'ci-res-title', 'Circuit complete'));

  var totals = h('div', 'ci-res-totals');
  totals.appendChild(h('span', 'ci-res-big mono', fmtElapsed(totalMs)));
  totals.appendChild(h('span', 'ci-res-total-cap', 'total time'));
  totals.appendChild(h('span', 'ci-res-total-steps mono',
    outcomes.length + ' of ' + plannedCount + (plannedCount === 1 ? ' step run' : ' steps run')));
  view.appendChild(totals);

  var parts = [];
  if (done) parts.push(done + ' completed');
  if (timedOut) parts.push(timedOut + ' timed out');
  if (skipped) parts.push(skipped + ' skipped');
  view.appendChild(h('p', 'ci-res-overall', parts.length ? parts.join(', ') : 'No steps ran'));

  var list = h('ul', 'ci-res-list');
  for (var i = 0; i < outcomes.length; i++) {
    var o = outcomes[i];
    var li = h('li', 'ci-res-item');
    li.appendChild(h('span', 'ci-res-n mono', String(i + 1)));
    li.appendChild(h('span', 'ci-res-name', drillById(o.drillId).name));
    li.appendChild(h('span', 'ci-res-dur mono', fmtElapsed(o.elapsed)));
    if (o.kind === 'done') {
      li.appendChild(h('span', 'ci-res-out mono', fmtNum(o.value) + (o.unit ? ' ' + o.unit : '')));
      if (o.isPR) li.appendChild(h('span', 'ci-res-dur', 'new best'));
    } else if (o.kind === 'timeout') {
      li.appendChild(h('span', 'ci-res-out', 'timed out, no run recorded'));
    } else {
      li.appendChild(h('span', 'ci-res-out', 'skipped, no run recorded'));
    }
    list.appendChild(li);
  }
  view.appendChild(list);

  var actions = h('div', 'ci-res-actions');
  var again = h('button', 'ci-res-act ci-res-again', 'Run again');
  again.type = 'button';
  again.addEventListener('click', function () { showBuilder(); startRun(); });
  var back = h('button', 'ci-res-act', 'Back to builder');
  back.type = 'button';
  back.addEventListener('click', function () { showBuilder(); });
  actions.appendChild(again);
  actions.appendChild(back);
  view.appendChild(actions);

  stage.appendChild(view);
  swapNode(ui.stage, stage);
  ui.stage = stage;

  if (!ui.live || !ui.live.parentNode) {
    ui.live = h('div', 'sr');
    ui.live.setAttribute('aria-live', 'polite');
    ui.root.appendChild(ui.live);
  }

  say('Circuit finished. ' + done + ' of ' + plannedCount + ' steps completed.');
  try { again.focus(); } catch (e) { /* degrade */ }
}

/* ---------- lifecycle ---------- */

function reset() {
  stopHandle();
  clearCap();
  if (run.on || run.stage) leaveStage();
  run.on = false;
  run.finishing = false;
  run.steps = [];
  run.outcomes = [];
  run.sessionDrills = [];
}

export function teardown() {
  reset();
  if (ctxRef && ctxRef.audio && ctxRef.audio.silence) {
    try { ctxRef.audio.silence(); } catch (e) { /* degrade */ }
  }
}

export async function render(container, ctx) {
  reset();
  ctxRef = ctx;
  injectStyles();

  container.classList.add('view', 'ci-view');
  container.setAttribute('aria-label', 'Circuit');
  container.replaceChildren();

  model = Circuit.load();
  data = readCache() || { runs: [], sessions: [], cards: [] };
  state = toState(data);

  ui.root = h('div', 'ci-wrap');
  ui.container = container;
  container.appendChild(ui.root);
  showBuilder();

  var seq = 0;
  if (ctx && ctx.db && ctx.db.loadUserData) {
    ctx.db.loadUserData().then(function (res) {
      if (!container.isConnected || seq !== 0) return;
      if (res && res.ok && res.data) {
        data = res.data;
        state = toState(data);
        writeCache(data);
      }
    });
  }

  try { container.focus({ preventScroll: true }); } catch (e) { /* degrade */ }
}
