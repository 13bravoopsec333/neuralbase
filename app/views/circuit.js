/* Neuralbase view: Circuit.

   A third view next to Drills and Stats. The builder is an ordered list of drill
   steps: each step picks a drill, sets a wall-clock cap (Off, 30, 60, 90, 120
   seconds), and carries its own validated settings. Start runs the steps in
   order in the full-screen focus stage, advancing on the drill's own completion
   or when the cap runs out.

   Runs and the session are saved through ctx.db the same way Train saves them,
   so Stats and the streak read a circuit exactly like a normal set. The model
   itself lives in app/lib/circuit.js under cortex.circuits, local only.

   Scoped styles, design tokens only, both themes, no gradients, no shadows. */

import * as Circuit from '../lib/circuit.js';

var CACHE_KEY = 'cortex.cache.data';

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
  cap: null, sessionDrills: [], keyHandler: null, finishing: false
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
    '.ci-wrap{display:flex;flex-direction:column;gap:var(--gap-4);width:100%;max-width:none;margin-inline:0;padding-top:var(--gap-5)}',
    '.ci-lede{margin:0;color:var(--dim);font-size:13px;line-height:1.5;max-width:70ch}',
    '.ci-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}',
    '.ci-step{display:flex;flex-direction:column;gap:10px;padding:14px 0;border-top:1px solid var(--line2)}',
    '.ci-step:first-child{border-top:0}',
    '.ci-step-main{display:grid;grid-template-columns:max-content minmax(0,1fr) max-content max-content;gap:10px 14px;align-items:center}',
    '.ci-pos{font-family:var(--mono);font-size:12px;color:var(--dim);min-width:1.5em;text-align:right}',
    '.ci-drill{appearance:none;background:var(--panel2);border:1px solid var(--line2);border-radius:8px;color:var(--ink);font-family:var(--sans);font-size:13px;font-weight:500;padding:7px 10px;min-height:34px;min-width:0;max-width:100%;cursor:pointer}',
    '.ci-drill:hover{border-color:var(--line2)}',
    '.ci-seg{display:flex;flex-wrap:wrap;gap:2px;padding:3px;border:1px solid var(--line2);border-radius:10px;background:var(--panel2);min-width:0}',
    '.ci-seg-btn{display:inline-flex;align-items:center;justify-content:center;background:transparent;border:1px solid transparent;padding:4px 9px;border-radius:7px;min-height:28px;color:var(--muted);font-family:var(--sans);font-size:13px;font-weight:500;font-variant-numeric:tabular-nums;line-height:1.4;transition:color .15s ease,background-color .15s ease,border-color .15s ease}',
    '.ci-seg-btn:not(:disabled):hover{color:var(--ink)}',
    '.ci-seg-btn[aria-pressed="true"]{color:' + ACC + ';background:' + ACC_S + ';border-color:' + ACC_E + '}',
    '.ci-rowacts{display:flex;gap:4px;align-items:center;flex:none}',
    '.ci-act{background:none;border:1px solid transparent;border-radius:8px;padding:6px 8px;min-height:32px;font-family:var(--sans);font-size:13px;font-weight:500;color:var(--muted);cursor:pointer;transition:color .15s ease,border-color .15s ease}',
    '.ci-act:not(:disabled):hover{color:var(--ink);border-color:var(--line2)}',
    '.ci-act:disabled{opacity:.4;cursor:not-allowed}',
    '.ci-act-rm:hover{color:var(--warn);border-color:var(--warn)}',
    '.ci-set{border:0;padding:0;margin:0}',
    '.ci-set-sum{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:6px;padding:2px 0}',
    '.ci-set-sum::-webkit-details-marker{display:none}',
    '.ci-set-sum::before{content:"+";font-family:var(--mono)}',
    '.ci-set[open] .ci-set-sum::before{content:"-" }',
    '.ci-set-body{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:10px 12px;align-items:center;padding:10px 0 2px;max-width:640px}',
    '.ci-set-row{display:grid;grid-column:1 / -1;grid-template-columns:subgrid;align-items:center}',
    '.ci-set-head{display:flex;align-items:center;gap:8px;min-width:0;justify-content:flex-end}',
    '.ci-set-label{font-family:var(--sans);font-size:13px;font-weight:500;color:var(--muted);white-space:nowrap;text-align:right;justify-self:end}',
    '.ci-set-val{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
    '.ci-chips{display:flex;flex-wrap:wrap;gap:6px;min-width:0}',
    '.ci-chips .ci-seg-btn{border-color:var(--line2);border-radius:999px;padding:4px 12px}',
    '.ci-chips .ci-seg-btn[aria-pressed="true"]{border-color:' + ACC_E + ';background:' + ACC_S + ';color:' + ACC + '}',
    '.ci-switch{padding:3px;border:1px solid var(--line2);border-radius:999px;background:var(--panel2);display:flex;gap:2px}',
    '.ci-switch .ci-seg-btn{min-width:52px}',
    '.ci-switch .ci-seg-btn[aria-pressed="true"]{color:var(--bg);background:' + ACC + ';border-color:' + ACC + '}',
    '.ci-bar{display:flex;flex-wrap:wrap;gap:var(--gap-3);align-items:center;margin-top:var(--gap-2)}',
    '.ci-hint{margin:0;color:var(--dim);font-size:13px;line-height:1.5}',
    '.ci-empty{padding:var(--gap-4) 0;border-top:1px solid var(--line2);color:var(--dim);font-size:13px}',
    /* focus-visible rings on every real control */
    '.ci-drill:focus-visible,.ci-seg-btn:focus-visible,.ci-act:focus-visible,.ci-set-sum:focus-visible,.ci-start:focus-visible,.nb-focus-btn:focus-visible,.nb-exit-btn:focus-visible,.ci-res-act:focus-visible{outline:2px solid ' + ACC + ';outline-offset:2px}',
    /* Results: plain list, quiet, one action line. */
    '.ci-res{display:flex;flex-direction:column;gap:var(--gap-3);width:100%;max-width:640px;margin-inline:auto;padding-top:var(--gap-5)}',
    '.ci-res-title{margin:0;font-size:20px;font-weight:600;letter-spacing:-.015em}',
    '.ci-res-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}',
    '.ci-res-item{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;padding:10px 0;border-top:1px solid var(--line2);font-size:14px}',
    '.ci-res-item:first-child{border-top:0}',
    '.ci-res-name{color:var(--ink)}',
    '.ci-res-out{color:var(--muted);font-variant-numeric:tabular-nums}',
    '.ci-res-out.mono{color:var(--ink)}',
    '.ci-res-time{color:var(--dim);font-size:12px}',
    '.ci-res-actions{display:flex;gap:var(--gap-5);flex-wrap:wrap;margin-top:var(--gap-2)}',
    '.ci-res-act{background:none;border:0;padding:6px 0;font-family:var(--sans);font-size:15px;font-weight:600;color:var(--muted);cursor:pointer;transition:color .15s ease}',
    '.ci-res-act:hover{color:var(--ink)}',
    '.ci-res-again{color:' + ACC + '}',
    /* Focus stage: reuse focus.css. Only the progress readout needs a rule. */
    '.nb-focus-stage .ci-prog{font-family:var(--mono);font-size:11px;letter-spacing:.06em;color:var(--muted);white-space:nowrap}',
    '@media (max-width:560px){.ci-step-main{grid-template-columns:max-content minmax(0,1fr)}.ci-seg{grid-column:1 / -1}.ci-rowacts{grid-column:1 / -1;justify-content:flex-start}.ci-set-body{grid-template-columns:minmax(0,1fr)}}',
    '@media (prefers-reduced-motion:reduce){.ci-seg-btn,.ci-act,.ci-res-act{transition:none}}'
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

function firstDrillId() {
  var D = (globalThis.Content && globalThis.Content.DRILLS) || [];
  return (D[0] && D[0].id) || 'nback';
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
    step.drillId = sel.value;
    step.options = {};
    commitModel();
    showBuilder();
  });
  return sel;
}

function buildDuration(step) {
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
      step.seconds = sec;
      markPressed(seg, step.seconds, false);
      commitModel();
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

/* One setting row. The control updates its own pressed state, so changing a
   value never rebuilds the list or moves focus. */
function buildSettingRow(step, entry) {
  var current = step.options ? step.options[entry.key] : undefined;
  var row = h('div', 'ci-set-row');
  var head = h('div', 'ci-set-head');
  head.appendChild(h('span', 'ci-set-label', entry.label));
  head.appendChild(h('span', 'ci-set-val mono', optionReadout(entry, current)));
  row.appendChild(head);

  var type = entry.type || 'number';
  if (type === 'toggle') row.appendChild(buildToggle(step, entry, current));
  else if (type === 'choice') row.appendChild(entry.multi ? buildMulti(step, entry, current) : buildChoice(step, entry, current));
  else row.appendChild(buildNumber(step, entry, current));
  return row;
}

function commitSetting(step, entry, value, seg, multi) {
  step.options = step.options || {};
  step.options[entry.key] = value;
  var v = Circuit.validate(step);
  step.options = v ? v.options : step.options;
  markPressed(seg, step.options[entry.key], multi);
  commitModel();
  say(entry.label + ' set to ' + optionReadout(entry, step.options[entry.key]) + '.');
}

function buildNumber(step, entry, current) {
  var seg = segGroup(entry, 'ci-seg-bar');
  var count = Math.round((entry.max - entry.min) / entry.step) + 1;
  for (var k = 0; k < count; k++) {
    (function (value) {
      var b = h('button', 'ci-seg-btn', String(value));
      b.type = 'button';
      b._v = value;
      b.setAttribute('aria-pressed', value === current ? 'true' : 'false');
      b.addEventListener('click', function () { commitSetting(step, entry, value, seg, false); });
      seg.appendChild(b);
    })(Math.round((entry.min + k * entry.step) * 1e10) / 1e10);
  }
  return seg;
}

function buildToggle(step, entry, current) {
  var seg = segGroup(entry, 'ci-switch');
  [[false, 'Off'], [true, 'On']].forEach(function (pair) {
    var b = h('button', 'ci-seg-btn', pair[1]);
    b.type = 'button';
    b._v = pair[0];
    b.setAttribute('aria-pressed', current === pair[0] ? 'true' : 'false');
    b.addEventListener('click', function () { commitSetting(step, entry, pair[0], seg, false); });
    seg.appendChild(b);
  });
  return seg;
}

function buildChoice(step, entry, current) {
  var seg = segGroup(entry, 'ci-seg-bar');
  entry.options.forEach(function (o) {
    var b = h('button', 'ci-seg-btn', o.label);
    b.type = 'button';
    b._v = o.value;
    b.setAttribute('aria-pressed', current === o.value ? 'true' : 'false');
    b.addEventListener('click', function () { commitSetting(step, entry, o.value, seg, false); });
    seg.appendChild(b);
  });
  return seg;
}

function buildMulti(step, entry, current) {
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
      commitSetting(step, entry, next, seg, true);
    });
    seg.appendChild(b);
  });
  return seg;
}

function buildSettings(step, index) {
  var det = h('details', 'ci-set');
  var sum = h('summary', 'ci-set-sum', 'Settings');
  sum.setAttribute('aria-label', 'Settings for step ' + (index + 1));
  det.appendChild(sum);
  var body = h('div', 'ci-set-body');
  var spec = Circuit.optionSpecFor(step.drillId);
  if (!spec.length) {
    body.appendChild(h('p', 'ci-hint', 'This drill has no settings.'));
  } else {
    for (var i = 0; i < spec.length; i++) body.appendChild(buildSettingRow(step, spec[i]));
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

function addStep() {
  activeCircuit().steps.push({ drillId: firstDrillId(), seconds: 90, options: {} });
  commitModel();
  showBuilder();
  say('Step added.');
}

function buildStepRow(step, index, count) {
  var li = h('li', 'ci-step');

  var main = h('div', 'ci-step-main');
  main.appendChild(h('span', 'ci-pos mono', String(index + 1)));
  main.appendChild(buildDrillChooser(step, index));
  main.appendChild(buildDuration(step));

  var acts = h('div', 'ci-rowacts');
  var up = h('button', 'ci-act', 'Up');
  up.type = 'button';
  up.setAttribute('aria-label', 'Move step ' + (index + 1) + ' up');
  up.disabled = index === 0;
  up.addEventListener('click', function () { moveStep(index, index - 1); });
  var down = h('button', 'ci-act', 'Down');
  down.type = 'button';
  down.setAttribute('aria-label', 'Move step ' + (index + 1) + ' down');
  down.disabled = index === count - 1;
  down.addEventListener('click', function () { moveStep(index, index + 1); });
  var rm = h('button', 'ci-act ci-act-rm', 'Remove');
  rm.type = 'button';
  rm.setAttribute('aria-label', 'Remove step ' + (index + 1));
  rm.addEventListener('click', function () { removeStep(index); });
  acts.appendChild(up);
  acts.appendChild(down);
  acts.appendChild(rm);
  main.appendChild(acts);

  li.appendChild(main);
  li.appendChild(buildSettings(step, index));
  return li;
}

function showBuilder() {
  if (!ui.root) return;
  ui.root.replaceChildren();

  ui.root.appendChild(h('p', 'ci-lede', 'Build an ordered list of drills, set how long each one runs, then start the circuit.'));

  var steps = activeCircuit().steps;
  if (!steps.length) {
    ui.root.appendChild(h('p', 'ci-empty', 'No steps yet. Add a step to start building your circuit.'));
  } else {
    var list = h('ol', 'ci-list');
    for (var i = 0; i < steps.length; i++) list.appendChild(buildStepRow(steps[i], i, steps.length));
    ui.root.appendChild(list);
  }

  var bar = h('div', 'ci-bar');
  var add = h('button', 'btn-ghost ci-add', 'Add step');
  add.type = 'button';
  add.addEventListener('click', addStep);
  var start = h('button', 'btn-primary ci-start', 'Start circuit');
  start.type = 'button';
  start.disabled = !steps.length;
  start.addEventListener('click', function () { startRun(); });
  bar.appendChild(add);
  bar.appendChild(start);
  ui.root.appendChild(bar);

  if (!steps.length) ui.root.appendChild(h('p', 'ci-hint', 'Add at least one step to start a circuit.'));

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
  if (!seconds) return;
  run.cap = { remaining: seconds * 1000, last: Date.now(), timer: 0, done: false };
  run.cap.timer = setInterval(capTick, 200);
}

/* Pause-aware: the remaining time does not drain while the tab is hidden, so a
   step is never cut short by the browser throttling the interval. */
function capTick() {
  var c = run.cap;
  if (!c || c.done) return;
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
  var outcome = { step: step, drillId: step.drillId, kind: kind, rec: rec || null };
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
  if (gen !== run.gen) return;
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
  run.sessionDrills = [];
  showResults(outcomes);
}

/* ---------- results ---------- */

function showResults(outcomes) {
  if (!ui.root) return;
  ui.root.replaceChildren();

  var view = h('div', 'ci-res');
  view.setAttribute('aria-label', 'Circuit result');
  view.appendChild(h('h2', 'ci-res-title', 'Circuit complete'));

  var list = h('ul', 'ci-res-list');
  for (var i = 0; i < outcomes.length; i++) {
    var o = outcomes[i];
    var li = h('li', 'ci-res-item');
    li.appendChild(h('span', 'ci-res-name', drillById(o.drillId).name));
    if (o.kind === 'done') {
      li.appendChild(h('span', 'ci-res-out mono', fmtNum(o.value) + (o.unit ? ' ' + o.unit : '')));
      if (o.isPR) li.appendChild(h('span', 'ci-res-time', 'new best'));
    } else if (o.kind === 'timeout') {
      li.appendChild(h('span', 'ci-res-out', 'timed out'));
      li.appendChild(h('span', 'ci-res-time', 'no run recorded'));
    } else {
      li.appendChild(h('span', 'ci-res-out', 'skipped'));
    }
    list.appendChild(li);
  }
  if (!outcomes.length) list.appendChild(h('li', 'ci-res-item', 'No steps ran.'));
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

  ui.root.appendChild(view);
  var live = h('div', 'sr');
  live.setAttribute('aria-live', 'polite');
  ui.root.appendChild(live);
  ui.live = live;

  var done = outcomes.filter(function (o) { return o.kind === 'done'; }).length;
  say('Circuit finished. ' + done + ' of ' + outcomes.length + ' steps completed.');
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

  container.classList.add('view', 'view-mid-wide', 'ci-view');
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
