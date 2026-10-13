/* Neuralbase view: Train.
   Runs one drill at a time, records runs and sessions through ctx.db (idempotent client_id
   writes with demo fallback), and keeps a local cache for instant paint. Gating via Engine.
   Mounts its own DOM into the container. Reads cloud data; never touches index.html ids.

   A finished set hands one payload to the Summary end screen through
   app/lib/lastrun.js and navigates there, so this view keeps no results surface
   of its own: there is exactly one place a finished run is read. */

import * as lastrun from '../lib/lastrun.js';
import { navigate } from '../router.js';

var CACHE_KEY = 'cortex.cache.data';
var SELECT_KEY = 'cortex.train.select';
var QUEUE_KEY = 'cortex.train.queue';
var MODE_KEY = 'cortex.train.mode';
var SEED_KEY = 'cortex.train.seed';

/* Every drill draws its trial stream from the seed train hands over. The six in
   this file and the three in drills-extra.js all build their stream from
   opts.seed (rngFrom, or rngFor for sart, crt and math), and Spaced Retrieval's
   shuffled order draws from it too. A run records meta.seed, so the seed has to
   reach every drill or the record is a promise the run cannot keep. */
var SEEDED = { nback: 1, ufov: 1, palace: 1, reasoning: 1, switching: 1, sart: 1, spaced: 1, crt: 1, math: 1 };

function h(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
/* The exit confirmation blocks key input but cannot stop a drill's own clock, so
   trials behind the modal time out and score as no response. The drill side
   listens for nb:pause on document while the confirm is up and nb:resume when the
   player keeps training. Guarded: the view smoke test mounts a document stub with
   no dispatchEvent. */
function signalDrill(name) {
  try {
    if (typeof CustomEvent === 'function' && document && typeof document.dispatchEvent === 'function') {
      document.dispatchEvent(new CustomEvent(name));
    }
  } catch (e) { /* degrade */ }
}
function drillById(id) {
  var D = (globalThis.Content && globalThis.Content.DRILLS) || [];
  for (var i = 0; i < D.length; i++) if (D[i].id === id) return D[i];
  return { id: id, name: 'Legacy run', icon: '', desc: '', trains: '', works: '', evidence: '', pro: false, direction: 'lower', unit: '' };
}
function clientId() {
  try { if (globalThis.crypto && globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID(); } catch (e) { /* fall through */ }
  return 'run-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}
/* Mode picker state. The remembered mode is validated against the current plan
   on every read, so an unknown mode falls back to the default instead of
   silently handing Drills a mode that no longer exists. */
function readMode(plan) {
  var Engine = globalThis.Engine;
  var want = Engine && Engine.DEFAULT_MODE ? Engine.DEFAULT_MODE : 'dual';
  var v = null;
  try { v = localStorage.getItem(MODE_KEY); } catch (e) { return want; }
  if (!v) return want;
  return v || want;
}
function writeMode(id) {
  try { localStorage.setItem(MODE_KEY, id); } catch (e) { /* degrade */ }
}

/* A seed is an 8 digit hex label. Short enough to read out loud, wide enough
   that a collision is not worth worrying about. It is not on screen. Every set
   draws a new one, so a repeat run is a new sequence; the recorded seed is what
   makes a single run reproducible after the fact. */
function newSeed() {
  var n = Math.floor(Math.random() * 0xffffffff) >>> 0;
  var s = ('00000000' + n.toString(16)).slice(-8);
  return s.toUpperCase();
}
function writeSeed(s) {
  try { localStorage.setItem(SEED_KEY, s); } catch (e) { /* degrade */ }
}

/* ---------- per-drill starting settings ----------
   One localStorage object keyed by drill id, each bag validated through the drill
   registry's own spec on every read, so a hand-edited or half-written store can
   never put a drill out of range. */
var OPTIONS_KEY = 'cortex.train.options';

function readOptions() {
  try {
    var raw = localStorage.getItem(OPTIONS_KEY);
    var v = raw ? JSON.parse(raw) : null;
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  } catch (e) { return {}; }
}

function writeOptions(all) {
  try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(all || {})); } catch (e) { /* degrade */ }
}

/* The option API lives on Drills.DrillsCore. Guarded so a stub without it (the
   view smoke test, an older bundle) degrades to no settings rather than throwing. */
function optionCore() {
  var D = globalThis.Drills;
  return (D && D.DrillsCore) ? D.DrillsCore : null;
}

function optionSpecFor(id) {
  var C = optionCore();
  var spec = (C && typeof C.drillOptionSpec === 'function') ? C.drillOptionSpec() : null;
  return (spec && spec[id]) ? spec[id] : [];
}

function validateOptions(id, overrides) {
  var C = optionCore();
  return (C && typeof C.drillOptions === 'function') ? C.drillOptions(id, overrides) : {};
}

/* Validated settings for one drill, ready to hand to Drills.start. */
export function optionsFor(id) {
  var all = readOptions();
  var raw = (all[id] && typeof all[id] === 'object' && !Array.isArray(all[id])) ? all[id] : {};
  return validateOptions(id, raw);
}

/* Store one value, keeping the whole bag valid. The written bag is snapped to the
   spec here, and optionsFor validates again on read. */
export function setOption(id, key, value) {
  var all = readOptions();
  var cur = (all[id] && typeof all[id] === 'object' && !Array.isArray(all[id])) ? all[id] : {};
  cur[key] = value;
  all[id] = validateOptions(id, cur);
  writeOptions(all);
  return all[id];
}

function readCache() {
  try { var raw = localStorage.getItem(CACHE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      runs: (data && data.runs) || [],
      sessions: (data && data.sessions) || [],
      cards: (data && data.cards) || []
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
function normSession(s) {
  return {
    t: typeof s.t === 'number' ? s.t : (Date.parse(s.created_at || '') || 0),
    drills: (s.drills || []).slice()
  };
}
/* One card in the shape Spacing.grade expects and db.cardRow round-trips.
   clientId and the FSRS fields are carried, not just the legacy box/seen/correct:
   without client_id a graded card hashes to a fresh id on save, so the store
   grows a duplicate row and the schedule it was just given is lost. */
function normCard(c) {
  var due = c.due;
  if (typeof due !== 'number') due = Date.parse(due || '') || 0;
  var last = c.lastReview != null ? c.lastReview : c.last_review;
  return {
    id: c.id || c.clientId || c.client_id || '',
    clientId: c.clientId || c.client_id || '',
    front: c.front,
    back: c.back == null ? '' : String(c.back),
    note: c.note == null ? '' : String(c.note),
    cardType: c.cardType || c.card_type || 'basic',
    hint: c.hint == null ? '' : String(c.hint),
    deckId: c.deckId != null ? c.deckId : (c.deck_id != null ? c.deck_id : null),
    due: due,
    lastReview: last == null ? null : (typeof last === 'number' ? last : Date.parse(last) || null),
    stability: Number(c.stability) || 0,
    difficulty: Number(c.difficulty) || 0,
    reps: Number(c.reps) || 0,
    lapses: Number(c.lapses) || 0,
    state: c.state || 'new',
    box: Number(c.box) || 0,
    seen: Number(c.seen) || 0,
    correct: Number(c.correct) || 0,
    suspended: c.suspended === true
  };
}
function toState(data, plan) {
  var Store = globalThis.Store;
  var records = ((data && data.runs) || []).map(normRun).filter(function (r) { return r.drillId && isFinite(r.value); });
  var sessions = ((data && data.sessions) || []).map(normSession);
  var days = [], seen = {};
  for (var i = 0; i < sessions.length; i++) {
    var k = Store.iso(new Date(sessions[i].t));
    if (!seen[k]) { seen[k] = 1; days.push(k); }
  }
  return { records: records, sessions: sessions, days: days, cards: ((data && data.cards) || []).map(normCard), plan: plan, sequences: [] };
}
function takeSelect() {
  try { var v = localStorage.getItem(SELECT_KEY); localStorage.removeItem(SELECT_KEY); return v; } catch (e) { return null; }
}
function takeQueue() {
  try {
    var raw = localStorage.getItem(QUEUE_KEY);
    localStorage.removeItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

var ui = {};
var ctxRef = null;
var data = { runs: [], sessions: [], cards: [] };
var state = null;
var currentDrill = 'nback';
var pending = [];
var sessionDrills = [];
var handle = null;
var writeSeq = 0;
var mode = null;
var seed = null;
/* True from the moment a set starts until it ends. The mode picker changes the
   trial stream a running drill already committed to, so it is locked for the
   life of the set and unlocked at the finish. */
var running = false;
/* The run that was just recorded, kept so the end screen can be handed its parts,
   value and unit. Cleared when a set is abandoned. */
var lastRun = null;
/* When the current set started, so the end screen can report the real elapsed
   time instead of a fabricated one. Set once, on the first drill of a set. */
var setStart = 0;

/* ---------- focus mode ----------
   A running drill gets the whole screen. app/focus.css was written for this and
   loaded, but nothing switched it on, so a set ran in a 320px box in the middle
   of the Train page with the programs band and the topbar all still competing
   for attention. The stage is a real node here, not a CSS class on body: the
   drill has to be moved into it, and moved back on exit, so the running drill
   keeps its DOM and its timers. */
var focus = { stage: null, scrim: null, on: false, drill: null, from: null, holder: null, dialog: null, deferred: false };

function enterFocus() {
  if (focus.on) {
    var drill = ui.mount && ui.mount.querySelector('.drill');
    if (drill && focus.holder) {
      focus.holder.replaceChildren(drill);
      focus.drill = drill;
    }
    return;
  }
  var mount = ui.mount;
  if (!mount || !mount.parentNode) return;
  var drill = mount.querySelector('.drill');
  if (!drill) return;

  var scrim = document.createElement('div');
  scrim.className = 'nb-focus-scrim';
  var stage = document.createElement('div');
  stage.className = 'nb-focus-stage';

  var bar = h('div', 'nb-focus-bar');
  var title = h('p', 'nb-focus-title', '');
  title.textContent = drillById(currentDrill).name;
  bar.appendChild(title);

  var fsHint = h('span', 'nb-fs-hint', '');
  bar.appendChild(fsHint);

  var spacer = h('div', 'nb-focus-spacer');
  bar.appendChild(spacer);

  var fsBtn = h('button', 'nb-focus-btn', 'Full screen');
  fsBtn.type = 'button';
  var exit = h('button', 'nb-exit-btn', 'Exit');
  exit.type = 'button';
  bar.appendChild(fsBtn);
  bar.appendChild(exit);

  var holder = h('div', 'drill-mount');
  holder.appendChild(drill);

  stage.appendChild(bar);
  stage.appendChild(holder);

  var dialog = document.createElement('dialog');
  dialog.setAttribute('aria-labelledby', 'nb-exit-title');
  var dialogTitle = h('h2', null, 'End this training session?');
  dialogTitle.id = 'nb-exit-title';
  var keep = h('button', 'nb-dialog-keep', 'Keep Training');
  keep.type = 'button';
  keep.autofocus = true;
  var end = h('button', 'nb-dialog-end', 'End Session');
  end.type = 'button';
  dialog.appendChild(dialogTitle);
  dialog.appendChild(keep);
  dialog.appendChild(end);
  stage.appendChild(dialog);

  document.body.appendChild(scrim);
  document.body.appendChild(stage);
  document.body.classList.add('focus');

  focus.stage = stage;
  focus.scrim = scrim;
  focus.drill = drill;
  focus.from = mount;
  focus.holder = holder;
  focus.dialog = dialog;
  focus.on = true;
  var returnFocus = null;

  dialog.addEventListener('close', function () {
    if (!focus.on || focus.stage !== stage) return;
    var target = returnFocus;
    returnFocus = null;
    if (target && target.isConnected && stage.contains(target)) target.focus();
    else exit.focus();
  });
  dialog.addEventListener('cancel', function (e) {
    e.preventDefault();
    dialog.close();
    /* Escape dismisses the confirm, which is keeping training by another route.
       Without this the drill stays frozen after the dialog is gone. */
    signalDrill('nb:resume');
    /* Keeping by escape has to advance the queue exactly like the Keep button:
       a drill that completed behind the modal was held back, and leaving it held
       would strand the set with the dialog already gone. */
    if (focus.deferred) {
      focus.deferred = false;
      nextDrill();
    }
  });
  keep.addEventListener('click', function () {
    dialog.close();
    signalDrill('nb:resume');
    /* A drill that completed while the dialog was up was held back so the queue
       could not advance behind the modal. Keeping resumes it now. */
    if (focus.deferred) {
      focus.deferred = false;
      nextDrill();
    }
  });
  end.addEventListener('click', function () {
    dialog.close();
    endSession();
  });

  /* Fullscreen is a hint, not a takeover. It needs a gesture and it is refused
     in some embedded contexts, so the stage has to be usable without it and the
     copy has to admit when it was not granted. */
  var fs = document.fullscreenElement || document.webkitFullscreenElement;
  fsHint.textContent = fs ? 'Full screen on' : '';
  fsBtn.hidden = !!fs;
  fsBtn.addEventListener('click', function () {
    var el = stage;
    var req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) { fsHint.textContent = 'Full screen is unavailable here'; fsBtn.hidden = true; return; }
    req.call(el).then(function () {
      fsHint.textContent = 'Full screen on';
      fsBtn.hidden = true;
    }).catch(function () {
      fsHint.textContent = 'Full screen was refused';
      fsBtn.hidden = true;
    });
  });

  /* Leaving the stage ends the set. Putting a still-running drill back into the
     page-sized box would be the complaint again with the fix halfway applied, and
     the run was abandoned either way, so it is stopped rather than recorded. */
  function out() {
    if (dialog.open) return;
    returnFocus = document.activeElement;
    dialog.showModal();
    signalDrill('nb:pause');
  }

  function endSession() {
    /* Stage down first: leaveFocus puts the drill node back in the mount, and
       stopSet then clears the mount and writes the idle placeholder, so the two
       run in that order or a stale drill node ends up sitting beside the
       placeholder. */
    leaveFocus();
    stopSet();
    if (ctxRef && ctxRef.audio && ctxRef.audio.silence) {
      try { ctxRef.audio.silence(); } catch (e) { /* degrade */ }
    }
    /* The stage is gone and focus was on a button inside it, so it would fall to
       body. Hand it to the Start control, or the Train section if that is gone. */
    var target = (ui.startBtn && ui.startBtn.isConnected) ? ui.startBtn : ui.container;
    if (target && target.focus) {
      try { target.focus({ preventScroll: true }); } catch (e) { try { target.focus(); } catch (e2) { /* degrade */ } }
    }
  }
  exit.addEventListener('click', out);

  /* Escape leaves. It only applies while the stage is up, and the listener goes
     away with it so it cannot fire on a normal page afterwards. */
  focus.onKey = function (e) {
    if (e.key === 'Escape' && !dialog.open) { e.preventDefault(); out(); }
  };
  document.addEventListener('keydown', focus.onKey, true);

  /* While the confirmation is up the drill must not take input. Drill key
     handlers are bound to document in the bubble phase, so stopping propagation
     here, in the capture phase, keeps a keypress from reaching them. Escape is
     left alone so the native dialog still cancels. */
  focus.onBlock = function (e) {
    if (dialog.open && e.key !== 'Escape') e.stopPropagation();
  };
  document.addEventListener('keydown', focus.onBlock, true);

  if (exit.focus) exit.focus();
}

/* Stop a set without recording it. Distinct from finishSession, which banks the
   runs and the session. Used when the player leaves focus mode mid-trial. */
function stopSet() {
  if (handle && handle.stop) handle.stop();
  handle = null;
  running = false;
  pending = [];
  sessionDrills = [];
  lastRun = null;
  if (ui.startBtn) { ui.startBtn.disabled = false; ui.startBtn.textContent = 'Start'; }
  paintIdle();
  setIdle(true);
  paintAll();
}

/* The idle mount. It carries the selected drill's settings panel, so the mount is
   the one place the drill is set up before a run. Rebuilt whole on every selection
   and on every value change, so the panel can never show a stale value. */
function paintIdle() {
  if (!ui.mount) return;
  ui.mount.replaceChildren();
  /* The mode picker is rebuilt with the panel, so the old node references go with
     the old nodes rather than pointing at a detached tree. */
  ui.modesBlock = null;
  ui.modeBtns = {};
  ui.modeBlurb = null;
  ui.modeVal = null;
  /* The mount's content is a .drill node: that is the node the focus stage adopts
     when a set starts and the node the exit flow moves back, so the mount keeps that
     contract. Idle, the node holds the settings panel instead of a drill. */
  var wrap = h('div', 'drill');
  wrap.appendChild(buildSetup(drillById(currentDrill)));
  ui.mount.appendChild(wrap);
}

/* The panel is one group of setting rows. Each row is a labelled control: a
   number as a row of value buttons, a toggle as Off and On, a choice as a small
   segmented control, a multi choice as a set of on or off buttons. Every control
   is a real button, so Tab reaches it and Enter or Space works; the current value
   is the pressed one. */
function buildSetup(d) {
  var panel = h('div', 'tr-setup');
  var spec = optionSpecFor(d.id);
  var opts = optionsFor(d.id);
  var rows = h('div', 'tr-set-rows');
  /* The mode row sits in the same grid as the settings, so its label and its
     track line up with every other label and control instead of starting at a
     different x. It is a .tr-mode-row, not a .tr-set-row, because it is not one
     of the drill's settings. */
  if (d.id === 'nback') rows.appendChild(buildModeBlock());
  /* Spec order, with the settings this drill's current mode does not use left
     out. The value stays stored, so switching mode back brings it back. */
  for (var i = 0; i < spec.length; i++) {
    if (!optionVisible(d.id, spec[i])) continue;
    rows.appendChild(buildOptionRow(d.id, spec[i], opts[spec[i].key]));
  }
  panel.appendChild(rows);
  return panel;
}

/* A setting only some modes use is hidden, not disabled. The cue length governs
   the rule cue, and only Dual n-back has a rule cue to govern, so the row is
   noise in the other five modes. */
function optionVisible(id, entry) {
  if (id === 'nback' && entry.key === 'cueLength') return mode === 'dual';
  return true;
}

/* The value readout beside a setting's label. */
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

/* Store one value and repaint the panel. Changing a value never starts a drill.
   `keep` skips the repaint for a control that is mid-interaction (a slider drag):
   replacing the node under the pointer would drop the drag and the focus with it.
   Returns the validated bag, so a caller can show what was actually stored. */
function commitOption(id, entry, value, keep) {
  if (running) return null;
  var bag = setOption(id, entry.key, value);
  if (!keep) {
    paintIdle();
    setIdle(true);
    paintAll();
  }
  say(entry.label + ' set to ' + optionReadout(entry, bag[entry.key]) + '.');
  return bag;
}

function buildOptionRow(id, entry, current) {
  var row = h('div', 'tr-set-row');
  var head = h('div', 'tr-set-head');
  head.appendChild(h('span', 'tr-set-label', entry.label));
  /* Held so a slider can follow the drag on the readout without a repaint. */
  var readout = h('span', 'tr-set-val mono', optionReadout(entry, current));
  head.appendChild(readout);
  row.appendChild(head);

  var type = entry.type || 'number';
  if (type === 'toggle') row.appendChild(buildToggleRow(id, entry, current));
  else if (type === 'choice') row.appendChild(entry.multi ? buildMultiRow(id, entry, current) : buildChoiceRow(id, entry, current));
  else row.appendChild(buildNumberRow(id, entry, current, readout));
  return row;
}

/* One group of option buttons, named by the setting, so a screen reader hears
   "Starting level, 2, pressed" rather than a bare number. The variant class picks
   the control's shape: a segmented bar, a pill switch, or a row of chips. */
function segGroup(entry, variant) {
  var seg = h('div', 'tr-seg ' + variant);
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', entry.label);
  return seg;
}

/* A number on a segmented bar works while the whole set fits on one line. Past
   four values it is a wall of buttons, so it becomes a slider: the same value, a
   bar with an accent fill, and the number in the row's readout. */
var SEG_MAX = 4;

/* The values a number setting can take, from the index count rather than an
   accumulating loop, so a fractional step lands on every value without drift. */
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

function buildNumberRow(id, entry, current, readout) {
  var values = numberValues(entry);
  if (values.length > SEG_MAX) return buildRangeRow(id, entry, current, readout);
  var seg = segGroup(entry, 'tr-seg-bar');
  values.forEach(function (value) {
    var b = h('button', 'tr-seg-btn', String(value));
    b.type = 'button';
    b.setAttribute('aria-pressed', value === current ? 'true' : 'false');
    b.addEventListener('click', function () { commitOption(id, entry, value); });
    seg.appendChild(b);
  });
  return seg;
}

/* A real range input, so the keyboard model is the platform's. The readout
   follows the drag live and the value is committed on release without repainting,
   so neither the drag nor the focus is pulled out from under the pointer. */
function buildRangeRow(id, entry, current, readout) {
  var wrap = h('div', 'tr-range-wrap');
  var input = document.createElement('input');
  input.type = 'range';
  input.className = 'tr-range';
  input.min = String(entry.min);
  input.max = String(entry.max);
  input.step = String(entry.step);
  input.value = String(current);
  input.setAttribute('aria-label', entry.label);
  input.setAttribute('aria-valuetext', optionReadout(entry, current));
  function preview() {
    var text = optionReadout(entry, sliderValue(input.value, entry));
    if (readout) readout.textContent = text;
    input.setAttribute('aria-valuetext', text);
  }
  input.addEventListener('input', preview);
  input.addEventListener('change', function () {
    var bag = commitOption(id, entry, sliderValue(input.value, entry), true);
    /* The store snaps the value, so the readout is taken from what was stored. */
    if (readout) readout.textContent = optionReadout(entry, bag ? bag[entry.key] : sliderValue(input.value, entry));
  });
  wrap.appendChild(input);

  /* A tick per value and the range ends, so the slider reads as a scale with a
     known span instead of a bare handle. The lit ticks fill up to the current
     value; the live number stays in the row's readout. */
  var values = numberValues(entry);
  var scale = h('div', 'tr-scale');
  scale.setAttribute('aria-hidden', 'true');
  values.forEach(function (v) {
    var tick = h('i');
    if (v <= Number(current)) tick.className = 'on';
    scale.appendChild(tick);
  });
  wrap.appendChild(scale);
  var ends = h('div', 'tr-scale-ends');
  ends.setAttribute('aria-hidden', 'true');
  ends.appendChild(h('span', null, String(entry.min)));
  ends.appendChild(h('span', null, String(entry.max)));
  wrap.appendChild(ends);
  return wrap;
}

function buildToggleRow(id, entry, current) {
  var seg = segGroup(entry, 'tr-seg-switch');
  [[false, 'Off'], [true, 'On']].forEach(function (pair) {
    var b = h('button', 'tr-seg-btn');
    b.type = 'button';
    b.setAttribute('aria-pressed', current === pair[0] ? 'true' : 'false');
    /* The LED is the switch's tell: a bare Off / On reads as two buttons, the
       lamp reads as one control with a live side. No text, so the button's own
       name is still just Off or On. */
    b.appendChild(h('span', 'led'));
    b.appendChild(h('span', 'tr-seg-txt', pair[1]));
    b.addEventListener('click', function () { commitOption(id, entry, pair[0]); });
    seg.appendChild(b);
  });
  return seg;
}

/* A single-select is a segmented bar on one hairline track while every label fits
   that track on one line. Past four options they cannot all fit a 280px rail, and
   the overflow was clipped, so the labels read as nothing. A longer set is a
   wrapping chip bank instead: the same buttons and the same pressed state, one
   hairline box each, so every option stays legible. No registry drill has five or
   six options today; the rule is here so a longer set cannot come back clipped. */
var SEG_BAR_MAX = 4;

function buildChoiceRow(id, entry, current) {
  var long = entry.options.length > SEG_BAR_MAX;
  var seg = segGroup(entry, long ? 'tr-seg-chips' : 'tr-seg-bar');
  entry.options.forEach(function (o) {
    var b = h('button', 'tr-seg-btn', o.label);
    b.type = 'button';
    b.setAttribute('aria-pressed', current === o.value ? 'true' : 'false');
    b.addEventListener('click', function () { commitOption(id, entry, o.value); });
    seg.appendChild(b);
  });
  return seg;
}

/* A multi choice keeps a set of values. Turning off the last one is refused, so
   the drill always has at least one option to run. */
function buildMultiRow(id, entry, current) {
  var seg = segGroup(entry, 'tr-seg-chips');
  var on = Array.isArray(current) ? current.slice() : [];
  entry.options.forEach(function (o) {
    var b = h('button', 'tr-seg-btn', o.label);
    b.type = 'button';
    b.setAttribute('aria-pressed', on.indexOf(o.value) >= 0 ? 'true' : 'false');
    b.addEventListener('click', function () {
      var next = on.slice();
      var at = next.indexOf(o.value);
      if (at >= 0) {
        next.splice(at, 1);
        if (!next.length) {
          say(entry.key === 'ops' ? 'Keep at least one operation on.' : 'Keep at least one option on.');
          return;
        }
      } else {
        next.push(o.value);
      }
      commitOption(id, entry, next);
    });
    seg.appendChild(b);
  });
  return seg;
}

function buildModeBlock() {
  var MODES = (globalThis.Content && globalThis.Content.MODES) || [];
  /* The blurb is a sibling of the row, not a line inside it: a percentage-width
     line in a wrapping flex row inflates the row's max-content, which would push
     the whole panel wide of its real content. */
  var block = h('div', 'tr-mode-block');
  var head = h('div', 'tr-mode-head');
  head.appendChild(h('span', 'tr-field', 'Variant'));
  /* The current variant next to its label, the same label / readout pairing as
     every other setting, so the choice is legible without reading the chips. */
  var readout = h('span', 'tr-set-val mono', '');
  head.appendChild(readout);
  block.appendChild(head);
  var set = h('div', 'tr-modeset');
  set.setAttribute('role', 'group');
  set.setAttribute('aria-label', 'N-back variant');
  var btns = {};
  for (var i = 0; i < MODES.length; i++) {
    (function (m) {
      var b = h('button', 'tr-mode');
      b.type = 'button';
      b.setAttribute('data-mode', m.id);
      b.setAttribute('aria-pressed', 'false');
      /* A lamp plus the name: the lamp marks the live chip, the name is the
         button's own label, so its accessible name stays the variant. */
      b.appendChild(h('span', 'm'));
      b.appendChild(h('span', 'tr-mode-name', m.name));
      b.addEventListener('click', function () { pickMode(m); });
      btns[m.id] = b;
      set.appendChild(b);
    })(MODES[i]);
  }
  block.appendChild(set);
  var blurb = h('p', 'tr-blurb', '');
  block.appendChild(blurb);
  /* paintModes reads these, so the panel owns them while it is on screen. */
  ui.modesBlock = block;
  ui.modeBtns = btns;
  ui.modeBlurb = blurb;
  ui.modeVal = readout;
  return block;
}

function leaveFocus() {
  if (!focus.on) return;
  if (focus.onKey) {
    document.removeEventListener('keydown', focus.onKey, true);
    focus.onKey = null;
  }
  if (focus.onBlock) {
    document.removeEventListener('keydown', focus.onBlock, true);
    focus.onBlock = null;
  }
  /* Put the drill back where the Train page expects it before anything reads
     ui.mount, so the page is intact whether or not anyone navigates next. */
  if (focus.drill && focus.from) focus.from.appendChild(focus.drill);
  if (focus.stage && focus.stage.parentNode) focus.stage.parentNode.removeChild(focus.stage);
  if (focus.scrim && focus.scrim.parentNode) focus.scrim.parentNode.removeChild(focus.scrim);
  document.body.classList.remove('focus');
  var el = document.fullscreenElement || document.webkitFullscreenElement;
  if (el && (document.exitFullscreen || document.webkitExitFullscreen)) {
    var out = document.exitFullscreen || document.webkitExitFullscreen;
    try { out.call(document); } catch (e) { /* already out */ }
  }
  focus.on = false;
  focus.stage = null;
  focus.scrim = null;
  focus.drill = null;
  focus.from = null;
  focus.holder = null;
  focus.dialog = null;
  focus.deferred = false;
}

/* Direction map for Store.personalBest / isPersonalBest, which take an explicit
   map so the store stays free of any knowledge of the drill registry. */
function dirMap() {
  var m = {};
  var D = (globalThis.Content && globalThis.Content.DRILLS) || [];
  for (var i = 0; i < D.length; i++) {
    m[D[i].id] = D[i].direction === 'lower' ? 'lower' : 'higher';
  }
  return m;
}

/* Scoped styles. Theme tokens only, so every theme picks them up. */
function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById('nb-train-styles')) return;
  var s = document.createElement('style');
  s.id = 'nb-train-styles';
  /* One accent alias with a fallback, so the view still reads if the shell lane
     has not landed --accent yet. Everything else is an existing token. */
  var ACC = 'var(--accent,var(--lime))';
  var ACC_S = 'var(--accent-soft,var(--lime-soft))';
  var ACC_E = 'var(--accent-edge,var(--lime-edge))';
  s.textContent = [
    /* The root is one column that keeps the frame .view gives every page: a flex
       column taking the height the shell has left. max-width:none cancels the
       view-mid-wide ceiling the container carries, because that is a measure width
       for running text, not a limit on the drill area. justify-content:flex-start
       overrides the shell's safe-center, so the shell is pinned to the top of the
       frame and the stage keeps its full height. The shell grid itself lives in
       ui/p2.css, shared with the Circuit screen. */
    /* padding-top:0 hands the .content top padding straight to the rail and the
       stage, so every pixel the shell is given goes to the settings column. */
    '.tr-view{display:flex;flex-direction:column;gap:var(--gap-4);width:100%;max-width:none;margin-inline:0;flex:1 1 auto;min-height:0;justify-content:flex-start;padding-top:0}',
    /* The rail head: which drill the settings below belong to. A small-caps
       eyebrow, the drill name, then the family in mono, the identity block of the
       instrument reference. Tight gaps: it is a reference line, not a paragraph. */
    '.p2-rail-head{display:flex;flex-direction:column;gap:2px}',
    '.p2-eyebrow{font-family:var(--sans);font-size:10px;font-weight:600;letter-spacing:.15em;text-transform:uppercase;color:var(--dim)}',
    '.p2-rail-drill{font-size:18px;font-weight:650;letter-spacing:-.01em;color:var(--ink)}',
    '.p2-rail-sub{font-family:var(--mono);font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim)}',
    /* The rail pins: head, then a scrolling settings pane, then the foot. Start
       lives in the foot, so it cannot drift as a drill's settings grow; the
       settings scroll under it instead. The rail's own padding and gap are trimmed
       to the compact rhythm of the rows it holds, so the settings column is the
       full remaining height and the pane stops scrolling on a desktop viewport. */
    '.tr-view .p2-rail{overflow:hidden;padding:10px var(--gap-3);gap:var(--gap-2)}',
    '.tr-view .p2-rail-head{flex:none;padding-bottom:var(--gap-2)}',
    '.p2-set-block{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden}',
    '.p2-rail-foot{flex:none;border-top:1px solid var(--line2);padding-top:var(--gap-2)}',
    /* The idle mount holds the settings panel; a run adopts its .drill node into
       the focus stage, so the mount never has to grow to fill anything. */
    '.tr-view .drill-mount{display:block;width:100%;min-height:0}',
    '.tr-view .drill{width:100%}',
    /* Settings: one field per setting, a small-caps label with the mono value
       beside it, the control under them, a hairline between fields. The rows carry
       the padding, so each rule spans the rail's full width. The rhythm is compact
       on purpose: a rail that fits its column needs no internal scroll, and the
       whole settings list stays readable at a glance instead of half off screen. */
    '.tr-setup{display:flex;flex-direction:column;width:100%}',
    '.tr-set-rows{display:flex;flex-direction:column;gap:0}',
    '.tr-set-row{display:flex;flex-direction:column;gap:4px;min-width:0;padding:6px 0;border-bottom:1px solid var(--line)}',
    '.tr-set-head{display:flex;align-items:baseline;justify-content:space-between;gap:var(--gap-3);line-height:1.1}',
    '.tr-set-label{font-family:var(--sans);font-size:10px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}',
    '.tr-set-val{font-family:var(--mono);font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--ink);white-space:nowrap}',
    /* Every setting is a real control. A single-select is a segmented bar on one
       hairline track, a toggle is a rocker switch with a lamp, a multi-select is a
       row of on/off chips. Every control reserves its box, so a state change
       repaints colour and border only and never the metrics. */
    '.tr-seg{display:flex;flex-wrap:wrap;gap:5px;min-width:0}',
    '.tr-seg-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;background:transparent;border:1px solid transparent;padding:4px 9px;border-radius:2px;min-height:26px;color:var(--muted);font-family:var(--sans);font-size:12.5px;font-weight:500;font-variant-numeric:tabular-nums;line-height:1.25;transition:color .15s ease,background-color .15s ease,border-color .15s ease}',
    '.tr-seg-btn:not(:disabled):hover{color:var(--ink)}',
    '.tr-seg-btn[aria-pressed="true"]{color:' + ACC + ';background:' + ACC_S + '}',
    '.tr-seg-bar{flex-wrap:nowrap;gap:0;border:1px solid var(--line2);border-radius:2px;background:var(--panel);overflow:hidden}',
    '.tr-seg-bar .tr-seg-btn{flex:1 1 0;min-width:0;border:0;border-left:1px solid var(--line2);border-radius:0}',
    '.tr-seg-bar .tr-seg-btn:first-child{border-left:0}',
    '.tr-seg-bar .tr-seg-btn[aria-pressed="true"]{outline:1px solid ' + ACC_E + ';outline-offset:-1px}',
    /* The toggle reads as one rocker with a lamp per side, so it is a switch and
       not two buttons: same track, same lamp shape, no shift on press. */
    '.tr-seg-switch{border:1px solid var(--line2);border-radius:2px;background:var(--panel);overflow:hidden;align-self:stretch}',
    '.tr-seg-switch .tr-seg-btn{flex:1 1 0;min-width:0;border:0;border-left:1px solid var(--line2);border-radius:0;font-size:11px;font-weight:600;letter-spacing:.13em;text-transform:uppercase}',
    '.tr-seg-switch .tr-seg-btn:first-child{border-left:0}',
    '.tr-seg-switch .led{width:7px;height:7px;flex:none;border:1px solid var(--dim);background:transparent}',
    '.tr-seg-switch .tr-seg-btn[aria-pressed="true"]{outline:1px solid ' + ACC_E + ';outline-offset:-1px}',
    '.tr-seg-switch .tr-seg-btn[aria-pressed="true"] .led{background:' + ACC + ';border-color:' + ACC + '}',
    /* A multi-select reads as chips: a visible outline on every chip, the on ones filled. */
    '.tr-seg-chips{gap:5px;padding:0}',
    '.tr-seg-chips .tr-seg-btn{border-color:var(--line2);border-radius:2px;padding:5px 10px;background:var(--panel)}',
    '.tr-seg-chips .tr-seg-btn[aria-pressed="true"]{border-color:' + ACC_E + '}',
    /* A number past four values is a slider: a thin track, an accent thumb, a tick
       per value and the range ends, so the span is legible at a glance. */
    '.tr-range-wrap{display:flex;flex-direction:column;gap:2px;width:100%;min-width:0}',
    '.tr-range{-webkit-appearance:none;appearance:none;width:100%;height:13px;margin:0;background:transparent;cursor:pointer}',
    '.tr-range::-webkit-slider-runnable-track{height:2px;background:var(--line2)}',
    '.tr-range::-webkit-slider-thumb{-webkit-appearance:none;width:10px;height:13px;margin-top:-6px;background:' + ACC + ';border:0;border-radius:1px}',
    '.tr-range::-moz-range-track{height:2px;background:var(--line2)}',
    '.tr-range::-moz-range-thumb{width:10px;height:13px;background:' + ACC + ';border:0;border-radius:1px}',
    '.tr-scale{display:flex;align-items:flex-end;justify-content:space-between;padding:0 5px}',
    '.tr-scale i{display:block;width:1px;height:4px;background:var(--line2)}',
    '.tr-scale i.on{background:' + ACC + ';height:6px}',
    '.tr-scale-ends{display:flex;justify-content:space-between;font-family:var(--mono);font-size:10px;line-height:1.2;color:var(--dim)}',
    /* The variant control: a two-column bank of chips, each its own hairline box
       with a lamp, the live one filled. Its label and value sit on the row head
       exactly like every other setting. */
    '.tr-mode-block{display:flex;flex-direction:column;gap:4px;padding:6px 0;border-bottom:1px solid var(--line)}',
    '.tr-mode-head{display:flex;align-items:baseline;justify-content:space-between;gap:var(--gap-3);line-height:1.1}',
    '.tr-field{font-family:var(--sans);font-size:10px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}',
    '.tr-modeset{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;min-width:0}',
    '.tr-mode{display:flex;align-items:center;gap:7px;min-width:0;background:var(--panel);border:1px solid var(--line2);padding:4px 9px;min-height:26px;border-radius:2px;color:var(--muted);font-family:var(--sans);font-size:12.5px;font-weight:500;line-height:1.25;transition:color .15s ease,background-color .15s ease,border-color .15s ease}',
    '.tr-mode .m{width:7px;height:7px;flex:none;border:1px solid var(--dim)}',
    '.tr-mode-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.tr-mode:not(:disabled):hover{border-color:var(--dim);color:var(--ink)}',
    '.tr-mode[aria-pressed="true"]{color:' + ACC + ';background:' + ACC_S + ';border-color:' + ACC_E + ';font-weight:600}',
    '.tr-mode[aria-pressed="true"] .m{background:' + ACC + ';border-color:' + ACC + '}',
    '.tr-mode:disabled{opacity:.45;cursor:not-allowed}',
    '.tr-mode[aria-pressed="true"]:disabled{opacity:.7}',
    '.tr-blurb{font-size:11.5px;color:var(--dim);margin:0;line-height:1.35}',
    /* Every control carries a visible focus ring. */
    '.tr-seg-btn:focus-visible,.tr-mode:focus-visible,.tr-range:focus-visible,.tr-start:focus-visible,.nb-focus-btn:focus-visible,.nb-exit-btn:focus-visible{outline:2px solid ' + ACC + ';outline-offset:2px}',
    /* A pressed segment carries its own 1px outline, which out-specifies the
       focus rule above. Keep the full focus ring visible on the active value. */
    '.tr-seg-bar .tr-seg-btn[aria-pressed="true"]:focus-visible,.tr-seg-switch .tr-seg-btn[aria-pressed="true"]:focus-visible{outline:2px solid ' + ACC + ';outline-offset:2px}',
    /* Start: the one primary action, full width at the foot of the rail, with the
       machined corner radius so it belongs to the controls above it. Its own height
       is fixed, so the foot holds the same baseline whatever the drill's settings. */
    '.tr-start{width:100%;padding:9px 16px;font-size:14px;border-radius:2px;min-width:0;letter-spacing:.01em}',
    /* On phones the drill screen stacks hero first, then the settings rail, then
       the filmstrip along the bottom. The rail gets the larger row so its own
       scrolling pane has real height, and its foot still pins Start just above the
       filmstrip. The rail head is dropped on a phone: the hero above already names
       the drill, and the height it frees is the settings' to use. Scoped to
       .tr-view so the shared shell keeps its own order for the other screen. */
    '@media (max-width:720px){.tr-view .p2-shell{grid-template-rows:minmax(0,0.85fr) minmax(0,1.15fr) auto}.tr-view .p2-stage{grid-row:1}.tr-view .p2-rail{grid-row:2;border-right:0;border-bottom:0;border-top:1px solid var(--line)}.tr-view .p2-rail-head{display:none}.tr-view .p2-filmstrip{grid-row:3}}',
    /* The focus stage. focus.css sizes the stage; these rules lift its width cap
       and trim its gutter so a running drill is edge to edge. Later in the
       document than focus.css, so an equal-specificity rule here wins. */
    '.nb-focus-stage{padding:max(12px,2vh) max(12px,2vw)}',
    '.nb-focus-stage .drill-mount{max-width:none}',
    '.nb-focus-stage .drill{max-width:none}',
    /* The exit confirmation is a native modal dialog, so it needs the shared card
       rhythm by hand. Styled from here rather than focus.css, which is frozen. */
    '.nb-focus-stage dialog{border:1px solid var(--line2);border-radius:14px;background:var(--panel);color:var(--ink);padding:22px;width:min(420px,calc(100vw - 40px))}',
    '.nb-focus-stage dialog::backdrop{background:var(--scrim)}',
    '.nb-focus-stage dialog h2{margin:0 0 8px;font-size:20px;font-weight:600;letter-spacing:-.015em}',
    '.nb-focus-stage dialog button{font-family:var(--sans);font-size:13px;font-weight:600;padding:8px 14px;border-radius:8px;cursor:pointer;transition:transform .12s ease,border-color .15s ease,color .15s ease,opacity .15s ease}',
    '.nb-focus-stage dialog button+button{margin-left:10px}',
    /* Keeping is the default and the safe path, so it carries the accent. Ending is
       outlined, and only warns on hover. */
    '.nb-focus-stage dialog .nb-dialog-keep{background:var(--lime);color:var(--bg);border:1px solid var(--lime)}',
    '.nb-focus-stage dialog .nb-dialog-keep:hover{opacity:.9}',
    '.nb-focus-stage dialog .nb-dialog-end{background:transparent;border:1px solid var(--line2);color:var(--ink)}',
    '.nb-focus-stage dialog .nb-dialog-end:hover{border-color:var(--warn);color:var(--warn)}',
    /* Reduced motion: no transitions on any of the chrome. */
    '@media (prefers-reduced-motion:reduce){.tr-seg-btn,.tr-mode,.nb-focus-stage dialog button{transition:none}}'
  ].join('');
  document.head.appendChild(s);
}

/* The nine drills, grouped so the filmstrip reads as families instead of one flat
   wall of chips. Presentation only: the registry still owns the list, and any
   drill the groups do not name lands in a trailing group so none is unreachable. */
var DRILL_GROUPS = [
  { label: 'Memory', ids: ['nback', 'palace', 'spaced'] },
  { label: 'Attention', ids: ['sart', 'switching'] },
  { label: 'Speed', ids: ['ufov', 'crt'] },
  { label: 'Reasoning', ids: ['reasoning', 'math'] }
];

/* Which family a drill belongs to, for the stage's meta strip. */
function groupLabelFor(id) {
  for (var i = 0; i < DRILL_GROUPS.length; i++) {
    if (DRILL_GROUPS[i].ids.indexOf(id) >= 0) return DRILL_GROUPS[i].label;
  }
  return '';
}

/* The filmstrip: every drill as a chip along the bottom of the stage, grouped by
   family and scrollable sideways. Same keyboard model as any single-select: the
   selected chip is the group's one tab stop and the arrow keys move focus and
   selection together. */
function buildFilmstrip(D) {
  var strip = h('div', 'p2-filmstrip');
  strip.setAttribute('role', 'group');
  strip.setAttribute('aria-label', 'Choose a drill');
  var pickBtns = {};
  var order = [];
  var byId = {};
  D.forEach(function (p) { byId[p.id] = p; });
  var seen = {};
  var groups = [];
  for (var i = 0; i < DRILL_GROUPS.length; i++) {
    var ids = DRILL_GROUPS[i].ids.filter(function (id) { return byId[id] && !seen[id]; });
    for (var j = 0; j < ids.length; j++) seen[ids[j]] = 1;
    if (ids.length) groups.push({ label: DRILL_GROUPS[i].label, ids: ids });
  }
  var rest = D.map(function (p) { return p.id; }).filter(function (id) { return !seen[id]; });
  if (rest.length) groups.push({ label: 'More', ids: rest });

  groups.forEach(function (g, gi) {
    if (gi) {
      var sep = h('span', 'p2-strip-sep');
      sep.setAttribute('aria-hidden', 'true');
      strip.appendChild(sep);
    }
    g.ids.forEach(function (id) {
      var d = byId[id];
      var b = h('button', 'p2-chip');
      b.type = 'button';
      b.setAttribute('data-drill', d.id);
      b.setAttribute('aria-pressed', 'false');
      b.title = d.name;
      var art = h('span', 'p2-chip-art');
      art.setAttribute('aria-hidden', 'true');
      /* The registry icon is a trusted, static SVG string from content.js, not
         user text, so it is the one place innerHTML is used. */
      if (d.icon) art.innerHTML = d.icon;
      b.appendChild(art);
      b.appendChild(h('span', 'p2-chip-name', d.name));
      b.addEventListener('click', function () { pickDrill(d.id); });
      pickBtns[d.id] = b;
      order.push(d.id);
      strip.appendChild(b);
    });
  });

  strip.addEventListener('keydown', function (e) {
    var i = order.indexOf(currentDrill);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); i = (i + 1) % order.length; }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); i = (i - 1 + order.length) % order.length; }
    else if (e.key === 'Home') { e.preventDefault(); i = 0; }
    else if (e.key === 'End') { e.preventDefault(); i = order.length - 1; }
    else return;
    var id = order[i];
    var next = pickBtns[id];
    if (next && next.focus) next.focus();
    pickDrill(id);
  });

  return { strip: strip, pickBtns: pickBtns };
}

function buildDOM(container) {
  container.innerHTML = '';
  injectStyles();

  var D = (globalThis.Content && globalThis.Content.DRILLS) || [];

  var built = buildFilmstrip(D);
  var strip = built.strip;
  var pickBtns = built.pickBtns;

  /* Left rail: the selected drill's settings, compact. The mount inside it holds
     the idle .drill node, which is the node the focus stage adopts when a set
     starts and moves back on exit. */
  var rail = h('aside', 'p2-rail');
  rail.setAttribute('aria-label', 'Drill settings');

  var railHead = h('div', 'p2-rail-head');
  railHead.appendChild(h('span', 'p2-eyebrow', 'Selected drill'));
  var railDrill = h('span', 'p2-rail-drill', '');
  railHead.appendChild(railDrill);
  var railSub = h('span', 'p2-rail-sub', '');
  railHead.appendChild(railSub);
  rail.appendChild(railHead);

  var setBlock = h('div', 'p2-set-block');
  var mount = h('div', 'drill-mount tr-idle');
  setBlock.appendChild(mount);
  rail.appendChild(setBlock);

  /* The foot is pinned below the scrolling settings, so Start keeps the same
     place and size no matter how many settings a drill carries. */
  var foot = h('div', 'p2-rail-foot');
  var start = h('button', 'btn-primary tr-start', 'Start');
  start.type = 'button';
  foot.appendChild(start);
  rail.appendChild(foot);

  /* The stage: the framed preview that holds the drill's identity. Its body is
     swapped for the result after a run. Start lives in the rail foot, so the
     stage is identity alone and its height never tracks the rail's content. */
  var stage = h('div', 'p2-stage');
  var meta = h('div', 'p2-stage-meta', '');
  stage.appendChild(meta);
  var body = h('div', 'p2-stage-body');
  stage.appendChild(body);

  var live = h('div', 'sr');
  live.setAttribute('aria-live', 'polite');

  var shell = h('div', 'p2-shell');
  shell.appendChild(rail);
  shell.appendChild(stage);
  shell.appendChild(strip);
  container.appendChild(shell);
  container.appendChild(live);

  ui = {
    railDrill: railDrill, railSub: railSub, mount: mount, stageBody: body, stageMeta: meta,
    live: live, startBtn: start, pickBtns: pickBtns,
    modesBlock: null, modeBtns: {}, modeBlurb: null, modeVal: null,
    container: container
  };
  start.addEventListener('click', function () {
    if (ctxRef.audio && ctxRef.audio.resume) { try { ctxRef.audio.resume(); } catch (e) { /* degrade */ } }
    startDrill();
  });
}

/* The idle placeholder is the only content that needs the reserved height.
   A running drill brings its own stage, so the flag comes off. */
function setIdle(on) {
  if (!ui.mount) return;
  if (on) ui.mount.classList.add('tr-idle');
  else ui.mount.classList.remove('tr-idle');
}

function say(msg) {
  var n = ui.live;
  if (!n) return;
  n.textContent = '';
  window.setTimeout(function () { n.textContent = msg; }, 30);
}

/* Mode selection. Every mode is open, so the only guard is a running set: the
   mode buttons lock while one is in progress. */
function pickMode(m) {
  /* A set already running drew its stream from the mode it started with, so a
     change now would only desync the run. The buttons are disabled during a set;
     this guard is the backstop. */
  if (running) return;
  mode = m.id;
  writeMode(mode);
  /* The panel depends on the mode: Cue length belongs to Dual n-back alone, so it
     has to be rebuilt, not just the buttons and the blurb. The clicked button goes
     with the old panel, so focus is handed to the new one for the same mode. */
  paintIdle();
  setIdle(true);
  paintAll();
  var b = ui.modeBtns && ui.modeBtns[m.id];
  if (b && b.focus) { try { b.focus(); } catch (e) { /* degrade */ } }
  say('Mode set to ' + m.name + '.');
}

export function pickDrill(id) {
  currentDrill = id;
  if (handle && handle.stop) handle.stop();
  handle = null;
  paintIdle();
  setIdle(true);
  paintAll();
  /* Selecting a program only selects it: the panel swaps to this drill's settings
     and Start is the one way to begin. It must never launch a drill on its own. */
  say(drillById(id).name + ' selected. Press Start when ready.');
}

function paintModes(d) {
  if (!ui.modesBlock) return;
  var isN = d.id === 'nback';
  ui.modesBlock.hidden = !isN;
  if (!isN) return;
  var MODES = (globalThis.Content && globalThis.Content.MODES) || [];
  MODES.forEach(function (m) {
    var b = ui.modeBtns && ui.modeBtns[m.id];
    if (!b) return;
    b.setAttribute('aria-pressed', m.id === mode ? 'true' : 'false');
    /* A running set already committed to one mode, so the picker is disabled for
       the life of the set. The blurb below says why. */
    b.disabled = running;
    b.setAttribute('aria-label', m.name);
  });
  var cur = null;
  MODES.forEach(function (m) { if (m.id === mode) cur = m; });
  /* The current variant beside the label, and the mode blurb below. While a set
     runs the picker is disabled, so it says why: a disabled control with no
     reason reads as broken. */
  if (ui.modeVal) ui.modeVal.textContent = cur ? cur.name : '';
  if (ui.modeBlurb) {
    ui.modeBlurb.textContent = running
      ? 'Locked while a set runs.'
      : (cur ? cur.blurb : '');
  }
}

/* The stage preview: what the drill is and where it happens, before it starts.
   Rebuilt whole, so a selection can never leave a stale name or description. */
function paintStage(d) {
  if (!ui.stageBody) return;
  if (ui.stageMeta) ui.stageMeta.textContent = groupLabelFor(d.id);
  var art = h('div', 'p2-stage-art');
  art.setAttribute('aria-hidden', 'true');
  /* Trusted registry icon string from content.js, not user text. */
  if (d.icon) art.innerHTML = d.icon;
  var idle = h('span', 'p2-stage-idle');
  idle.appendChild(h('span', 'p2-stage-dot'));
  idle.appendChild(h('span', null, 'Ready'));
  ui.stageBody.replaceChildren(
    art,
    h('h2', 'p2-stage-title', d.name),
    idle
  );
}

function paintAll() {
  var d = drillById(currentDrill);
  if (ui.railDrill) ui.railDrill.textContent = d.name;
  if (ui.railSub) ui.railSub.textContent = groupLabelFor(d.id);
  paintStage(d);

  /* Roving tabindex: the selected chip is the filmstrip's one tab stop, and its
     pressed state is what the eye reads. */
  if (ui.pickBtns) {
    Object.keys(ui.pickBtns).forEach(function (id) {
      var b = ui.pickBtns[id];
      var on = id === currentDrill;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
  }

  paintModes(d);
}

function runDrills(ids, interleave) {
  var Engine = globalThis.Engine;
  var allowed = (ids || []).slice();
  if (!allowed.length) return;
  pending = interleave ? Engine.interleave(allowed) : allowed.slice();
  sessionDrills = [];
  nextDrill();
}
function startDrill() { runDrills([currentDrill], false); }

function nextDrill() {
  if (handle && handle.stop) handle.stop();
  handle = null;
  if (!pending.length) return finishSession();
  currentDrill = pending.shift();
  sessionDrills.push(currentDrill);
  /* A fresh seed every run, so a repeated drill does not replay the last sequence.
     It is written to the store so the run's meta.seed records it, and it is never
     shown in the UI. */
  seed = newSeed();
  writeSeed(seed);
  /* The set is live. The mode locks here and stays locked until finishSession
     unlocks it, so the running drill keeps the stream it started with. */
  var firstOfSet = !running;
  if (firstOfSet) setStart = Date.now();
  running = true;
  setIdle(false);
  if (ui.startBtn) { ui.startBtn.disabled = false; ui.startBtn.textContent = 'Restart'; }
  paintAll();
  if (firstOfSet && currentDrill === 'nback') {
    say('Mode locked while a set runs.');
  }
  var Drills = globalThis.Drills;
  handle = Drills.start(currentDrill, ui.mount, {
    /* The stage is built after the drill mounts, because it moves the drill's own
       node into it rather than copying it. Anything the drill drew is preserved,
       so its timers and state are untouched by the move. */
    cards: state.cards,
    /* Mode and seed ride along so a run is reproducible: the same pair gives the
       same trial sequence. Spaced Retrieval reads cards, not a stream. */
    mode: currentDrill === 'nback' ? mode : undefined,
    seed: SEEDED[currentDrill] ? seed : undefined,
    /* The panel's starting settings for this drill, validated against the spec. */
    options: optionsFor(currentDrill),
    onCards: function (cards) {
      state.cards = cards;
      data.cards = cards;
      writeSeq++;
      writeCache(data);
      if (ctxRef.db && ctxRef.db.saveCards) ctxRef.db.saveCards(cards);
    },
    onComplete: function (rec) {
      if (rec) {
        rec.meta = rec.meta || {};
        rec.meta.seed = seed;
        if (currentDrill === 'nback') rec.meta.mode = mode;
      }
      recordRun(rec);
      /* The confirmation is up, so the queue must not advance behind it. A
         finish here would call finishSession, which tears the stage and the open
         dialog out of the DOM and leaves neither button clickable. The run is
         still recorded: the drill did complete. Keeping Training resumes it. */
      if (focus.on && focus.dialog && focus.dialog.open) {
        focus.deferred = true;
        return;
      }
      nextDrill();
    }
  });
  /* Entered after the drill is mounted so the stage can adopt its node. */
  enterFocus();
}

function recordRun(rec) {
  var Store = globalThis.Store;
  var d = rec ? drillById(rec.drillId) : null;
  /* Checked before the run goes into state, since isPersonalBest compares
     against everything else on record. */
  var isPR = false;
  if (rec && d && typeof Store.isPersonalBest === 'function') {
    isPR = Store.isPersonalBest(state, rec, dirMap());
  }
  var prevBest = null;
  if (rec && d) {
    var agg = Store.aggregate(state, d.id, d.direction);
    prevBest = agg.best;
  }
  Store.record(state, rec);
  /* Held for the end screen: the run's value, its unit, the accuracy it reported,
     and its own per-part breakdown. The parts are passed to Summary untouched, so
     the end screen reads the run's real labels, outcomes and times. prevBest is
     null on a first run, which is what lets the best-run announcement say none. */
  lastRun = {
    drillId: rec.drillId,
    value: rec.value,
    unit: rec.unit || (d && d.unit) || '',
    meta: rec.meta || {},
    parts: Array.isArray(rec.parts) ? rec.parts : [],
    isPR: isPR,
    prevBest: prevBest
  };
  if (isPR) {
    /* No banner any more: a run that beats the old best is announced to assistive
       tech instead of drawing a card over the screen. */
    var unit = rec.unit || d.unit || '';
    var now = rec.value + (unit ? ' ' + unit : '');
    var prev = prevBest + (unit ? ' ' + unit : '');
    say('New personal best on ' + d.name + '. ' + now + ', previous best ' + (prevBest == null ? 'none' : prev) + '.');
  }
  var row = {
    drillId: rec.drillId, value: rec.value, unit: rec.unit || '',
    meta: rec.meta || {}, t: rec.t || Date.now(), clientId: clientId()
  };
  data.runs = data.runs || [];
  data.runs.push({
    drill_id: row.drillId, value: row.value, unit: row.unit, meta: row.meta,
    created_at: new Date(row.t).toISOString(), client_id: row.clientId
  });
  writeSeq++;
  writeCache(data);
  if (ctxRef.db && ctxRef.db.saveRun) ctxRef.db.saveRun(row);
}

function finishSession() {
  if (handle && handle.stop) handle.stop();
  handle = null;
  /* The set is over, so the stage comes down and the page comes back. */
  leaveFocus();
  /* The set is over, so the mode picker comes back. */
  running = false;
  if (ui.startBtn) { ui.startBtn.disabled = false; ui.startBtn.textContent = 'Start'; }
  if (sessionDrills.length) {
    var Store = globalThis.Store;
    var t = Date.now();
    var s = { t: t, drills: sessionDrills.slice(), clientId: clientId() };
    state.sessions.push({ t: t, drills: s.drills });
    var k = Store.iso(new Date(t));
    if (state.days.indexOf(k) === -1) state.days.push(k);
    data.sessions = data.sessions || [];
    data.sessions.push({ drills: s.drills, created_at: new Date(t).toISOString(), client_id: s.clientId });
    writeSeq++;
    writeCache(data);
    if (ctxRef.db && ctxRef.db.saveSession) ctxRef.db.saveSession(s);
    if (ctxRef.audio && ctxRef.audio.playSfx) { try { ctxRef.audio.playSfx('complete'); } catch (e) { /* degrade */ } }
  }
  sessionDrills = [];
  /* The set is over, so the rail goes back to the settings panel. A finished
     drill leaves its last frame in the mount, and the rail must not sit beside a
     dead drill while the end screen loads. */
  paintIdle();
  setIdle(true);
  paintAll();
  /* The set is done. Hand the run to the Summary end screen and go there: this
     view keeps exactly one results surface, and it is not in this view. A set
     that recorded no run hands nothing off and stays put. */
  if (lastRun) {
    lastrun.put(buildPayload(lastRun));
    goSummary();
  }
}

/* ---------- the end screen handoff ---------- */

/* The variant a run actually used, when it has one: only n-back carries a mode,
   and its short name reads best ("dual" -> "Dual"), the same rule Circuit uses. */
function variantLabel(mode) {
  if (typeof mode !== 'string' || !mode) return '';
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

/* A plain line naming the settings the run actually ran with, in spec order, read
   off the same option spec the panel and the drill both use. A toggle that was
   off is left out: it shaped nothing. Every other setting shows its own label and
   its real value, so nothing here is invented. */
function settingsLine(drillId, mode) {
  var bits = [];
  var variant = variantLabel(mode);
  if (variant) bits.push(variant);
  var spec = optionSpecFor(drillId);
  var opts = optionsFor(drillId);
  for (var i = 0; i < spec.length; i++) {
    var e = spec[i];
    if (!optionVisible(drillId, e)) continue;
    var v = opts[e.key];
    if ((e.type || 'number') === 'toggle') {
      if (v === true) bits.push(e.label);
      continue;
    }
    bits.push(e.label + ' ' + optionReadout(e, v));
  }
  return bits.join(' \u00b7 ');
}

/* The median of the measured part times, so a run's middle response reads at a
   glance. Even counts average the two middles, the same rule Circuit uses. */
function medianMs(values) {
  var vs = values.slice().sort(function (a, b) { return a - b; });
  if (!vs.length) return null;
  var mid = Math.floor(vs.length / 2);
  if (vs.length % 2) return vs[mid];
  return Math.round((vs[mid - 1] + vs[mid]) / 2);
}

/* One payload for the Summary end screen, filled from the run the view already
   holds. The parts go through untouched, so the end screen reads the run's own
   per-part labels, outcomes and times. The totals are counted off those parts,
   never guessed: correct and wrong are the scored outcomes, and the median
   response is the middle of the measured times. accuracy is the run's own, or
   null when the drill reports none. durationMs is the set's real elapsed time,
   taken from the moment it started. history is this drill's recent runs, oldest
   first, which is how the end screen reads a trend. */
function buildPayload(run) {
  var d = drillById(run.drillId);
  var meta = run.meta || {};
  var parts = Array.isArray(run.parts) ? run.parts : [];
  var correct = 0, wrong = 0, times = [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    var ok = p ? p.ok : null;
    if (ok === true) correct++;
    else if (ok === false) wrong++;
    var ms = p ? p.ms : null;
    if (typeof ms === 'number' && isFinite(ms)) times.push(ms);
  }
  var Store = globalThis.Store;
  var history = [];
  if (Store && typeof Store.forDrill === 'function' && state) {
    history = Store.forDrill(state, run.drillId).slice(-8).map(function (r) {
      return { value: r.value, t: r.t };
    });
  }
  return {
    kind: 'drill',
    title: d.name,
    subtitle: settingsLine(run.drillId, meta.mode),
    value: run.value,
    unit: run.unit || d.unit || '',
    accuracy: (typeof meta.accuracy === 'number' && isFinite(meta.accuracy)) ? meta.accuracy : null,
    durationMs: setStart ? Math.max(0, Date.now() - setStart) : null,
    parts: parts,
    totals: {
      parts: parts.length,
      correct: correct,
      wrong: wrong,
      medianMs: medianMs(times)
    },
    history: history,
    back: { view: 'train', label: 'Back to Drills' }
  };
}

/* Leave for the end screen. The app injects its router as ctx.navigate; the direct
   import is the fallback so a caller that did not thread it still lands there. */
function goSummary() {
  if (ctxRef && typeof ctxRef.navigate === 'function') { ctxRef.navigate('summary'); return; }
  try { navigate('summary'); } catch (e) { /* degrade */ }
}

/* The router calls this when leaving Train. A drill owns timers, bound keys and
   the shared audio context, none of which stop when its markup is detached, so
   navigating away has to say so explicitly. Without it the previous drill keeps
   firing into a detached tree and you still hear it. */
export function teardown() {
  if (handle && handle.stop) handle.stop();
  handle = null;
  pending = [];
  sessionDrills = [];
  running = false;
  lastRun = null;
  leaveFocus();
  if (ctxRef && ctxRef.audio && ctxRef.audio.silence) {
    try { ctxRef.audio.silence(); } catch (e) { /* degrade */ }
  }
}

export function render(container, ctx) {
  if (handle && handle.stop) handle.stop();
  handle = null;
  pending = [];
  sessionDrills = [];
  running = false;
  lastRun = null;
  ctxRef = ctx;
  mode = readMode();
  /* The shared centered column. Train is now the drills and nothing else, so it
     takes the full width the frame gives and its own max-width:none rule lifts
     the wide-column ceiling. */
  container.classList.add('view', 'view-mid-wide', 'tr-view');
  container.setAttribute('aria-label', 'Train');
  buildDOM(container);

  var sel = takeSelect();
  if (sel && globalThis.Content && globalThis.Content.DRILLS) currentDrill = sel;
  /* The panel is per-drill, and buildDOM painted it for the default drill before
     the handoff was read, so it is rebuilt now that the selected drill is known. */
  paintIdle();
  data = readCache() || { runs: [], sessions: [], cards: [] };
  state = toState(data);
  paintAll();

  var seq = writeSeq;
  if (ctx.db && ctx.db.loadUserData) {
    ctx.db.loadUserData().then(function (res) {
      if (!container.isConnected || writeSeq !== seq) return;
      if (res && res.ok && res.data) {
        data = res.data;
        state = toState(data);
        writeCache(data);
        paintAll();
      }
    });
  }

  var q = takeQueue();
  if (q && q.ids) runDrills(q.ids, q.interleave);

  /* The topbar owns the view title now, so there is no .view-title for the router
     to focus. Focus the section, which already carries the aria-label, without
     scrolling: the section is tall, and a plain focus would drag the page down
     under the sticky topbar. */
  try { container.focus({ preventScroll: true }); } catch (e) { /* degrade */ }
}
