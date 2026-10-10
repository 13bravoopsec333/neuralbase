/* Neuralbase view: Train.
   Runs one drill at a time, records runs and sessions through ctx.db (idempotent client_id
   writes with demo fallback), and keeps a local cache for instant paint. Gating via Engine.
   Mounts its own DOM into the container. Reads cloud data; never touches index.html ids. */

var CACHE_KEY = 'cortex.cache.data';
var SELECT_KEY = 'cortex.train.select';
var QUEUE_KEY = 'cortex.train.queue';
var MODE_KEY = 'cortex.train.mode';
var SEED_KEY = 'cortex.train.seed';

/* Drills whose trials come from a seedable stream, so a seed means something
   for them. Spaced Retrieval is a due-card queue, Signal Alert and Simple
   Reaction draw their own targets, and Mental Arithmetic steps its own level,
   so the seed is not passed to those. */
var SEEDED = { nback: 1, ufov: 1, palace: 1, reasoning: 1, switching: 1 };

function h(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
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
   that a collision is not worth worrying about. It is not on screen: the same
   seed is replayed on a repeat visit, so a run can be compared against the one
   before it. */
function newSeed() {
  var n = Math.floor(Math.random() * 0xffffffff) >>> 0;
  var s = ('00000000' + n.toString(16)).slice(-8);
  return s.toUpperCase();
}
function readSeed() {
  var v = null;
  try { v = localStorage.getItem(SEED_KEY); } catch (e) { /* fall through */ }
  if (v && /^[0-9a-f]{1,8}$/i.test(v)) return v.toUpperCase();
  return newSeed();
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
/* The run that was just recorded, kept so the results view can show it and the
   delta against the best that stood before it. Cleared when a set is abandoned. */
var lastRun = null;

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
  dialog.setAttribute('aria-describedby', 'nb-exit-copy');
  var dialogTitle = h('h2', null, 'End this training session?');
  dialogTitle.id = 'nb-exit-title';
  var dialogCopy = h('p', null, 'Completed drill results are saved as you go. The unfinished drill will be discarded. The daily session record is saved only after the full queue finishes.');
  dialogCopy.id = 'nb-exit-copy';
  var keep = h('button', 'nb-dialog-keep', 'Keep Training');
  keep.type = 'button';
  keep.autofocus = true;
  var end = h('button', 'nb-dialog-end', 'End Session');
  end.type = 'button';
  dialog.appendChild(dialogTitle);
  dialog.appendChild(dialogCopy);
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
  });
  keep.addEventListener('click', function () {
    dialog.close();
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
  if (d.id === 'nback') panel.appendChild(buildModeBlock());
  var spec = optionSpecFor(d.id);
  var opts = optionsFor(d.id);
  var rows = h('div', 'tr-set-rows');
  for (var i = 0; i < spec.length; i++) {
    rows.appendChild(buildOptionRow(d.id, spec[i], opts[spec[i].key]));
  }
  panel.appendChild(rows);
  return panel;
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

/* Store one value and repaint the panel. Changing a value never starts a drill. */
function commitOption(id, entry, value) {
  if (running) return;
  var bag = setOption(id, entry.key, value);
  paintIdle();
  setIdle(true);
  paintAll();
  say(entry.label + ' set to ' + optionReadout(entry, bag[entry.key]) + '.');
}

function buildOptionRow(id, entry, current) {
  var row = h('div', 'tr-set-row');
  var head = h('div', 'tr-set-head');
  head.appendChild(h('span', 'tr-set-label', entry.label));
  head.appendChild(h('span', 'tr-set-val mono', optionReadout(entry, current)));
  row.appendChild(head);

  var type = entry.type || 'number';
  if (type === 'toggle') row.appendChild(buildToggleRow(id, entry, current));
  else if (type === 'choice') row.appendChild(entry.multi ? buildMultiRow(id, entry, current) : buildChoiceRow(id, entry, current));
  else row.appendChild(buildNumberRow(id, entry, current));
  return row;
}

/* One group of option buttons, named by the setting, so a screen reader hears
   "Starting level, 2, pressed" rather than a bare number. */
function segGroup(entry) {
  var seg = h('div', 'tr-seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', entry.label);
  return seg;
}

function buildNumberRow(id, entry, current) {
  var seg = segGroup(entry);
  /* Built from an index count rather than an accumulating loop, so a fractional
     step still lands on every value without float drift. */
  var count = Math.round((entry.max - entry.min) / entry.step) + 1;
  for (var k = 0; k < count; k++) {
    (function (value) {
      var b = h('button', 'tr-seg-btn', String(value));
      b.type = 'button';
      b.setAttribute('aria-pressed', value === current ? 'true' : 'false');
      b.addEventListener('click', function () { commitOption(id, entry, value); });
      seg.appendChild(b);
    })(Math.round((entry.min + k * entry.step) * 1e10) / 1e10);
  }
  return seg;
}

function buildToggleRow(id, entry, current) {
  var seg = segGroup(entry);
  [[false, 'Off'], [true, 'On']].forEach(function (pair) {
    var b = h('button', 'tr-seg-btn', pair[1]);
    b.type = 'button';
    b.setAttribute('aria-pressed', current === pair[0] ? 'true' : 'false');
    b.addEventListener('click', function () { commitOption(id, entry, pair[0]); });
    seg.appendChild(b);
  });
  return seg;
}

function buildChoiceRow(id, entry, current) {
  var seg = segGroup(entry);
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
  var seg = segGroup(entry);
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
  var block = h('div', 'tr-modes');
  block.appendChild(h('span', 'tr-field', 'Mode'));
  var set = h('div', 'tr-modeset');
  set.setAttribute('role', 'group');
  set.setAttribute('aria-label', 'N-back mode');
  var btns = {};
  for (var i = 0; i < MODES.length; i++) {
    (function (m) {
      var b = h('button', 'tr-mode');
      b.type = 'button';
      b.setAttribute('data-mode', m.id);
      b.setAttribute('aria-pressed', 'false');
      b.appendChild(h('span', null, m.name));
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
  s.textContent = [
    /* The root is one column that keeps the frame .view gives every page: a flex
       column taking the height the shell has left. max-width:none cancels the
       view-mid-wide ceiling the container carries, because that is a measure width
       for running text, not a limit on the drill area. */
    '.tr-view{display:flex;flex-direction:column;gap:var(--gap-3);width:100%;max-width:none;margin-inline:0;flex:1 1 auto;min-height:0}',
    /* The drill selector: one plain text row. Nine names, no boxes, no marks. The
       selected drill is the accent and a heavier weight, nothing more. */
    '.tr-picker{display:flex;flex-wrap:wrap;gap:2px 12px;justify-content:center;width:100%;max-width:100%}',
    '.tr-drill{display:inline-flex;align-items:center;background:none;border:0;padding:3px 0;color:var(--muted);font-family:var(--sans);font-size:13px;font-weight:500;line-height:1.5;max-width:100%;transition:color .15s ease}',
    '.tr-drill:hover{color:var(--ink)}',
    '.tr-drill[aria-pressed="true"]{color:' + ACC + ';font-weight:700}',
    '.tr-drill-name{white-space:nowrap}',
    /* One short line: the selected drill's description, quiet under the picker. */
    '.tr-line{margin:0;text-align:center;color:var(--dim);font-size:13px;line-height:1.4;max-width:70ch;align-self:center}',
    /* The drill area takes the rest of the viewport and is the largest thing on the
       page. Idle it holds the settings panel; a run adopts its .drill node into the
       focus stage. */
    '.tr-view .drill-mount{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center}',
    '.tr-view .drill{width:100%}',
    /* Settings: plain text controls, matching the picker. One labelled row per
       setting: the label, then the values as small text buttons with the current
       one in the accent. The current value is also in the row for assistive tech,
       but not shown twice. */
    '.tr-setup{display:flex;flex-direction:column;gap:var(--gap-5);width:fit-content;max-width:100%;margin-inline:auto}',
    '.tr-set-rows{display:grid;grid-template-columns:1fr;gap:14px}',
    '.tr-set-row{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 12px;min-width:0}',
    '.tr-set-head{display:flex;align-items:baseline;gap:8px;min-width:0}',
    '.tr-set-label{font-family:var(--sans);font-size:13px;font-weight:500;color:var(--muted);white-space:nowrap;min-width:104px}',
    /* The value readout stays in the tree, but the pressed value button already
       shows it, so it is not drawn twice. */
    '.tr-set-val{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
    '.tr-seg{display:flex;flex-wrap:wrap;gap:2px}',
    '.tr-seg-btn{background:none;border:0;padding:3px 6px;border-radius:6px;min-height:26px;color:var(--muted);font-family:var(--sans);font-size:13px;font-weight:500;font-variant-numeric:tabular-nums;line-height:1.4;transition:color .15s ease}',
    '.tr-seg-btn:not(:disabled):hover{color:var(--ink)}',
    '.tr-seg-btn[aria-pressed="true"]{color:' + ACC + ';font-weight:700}',
    '.tr-mode{background:none;border:0;padding:3px 6px;border-radius:6px;min-height:26px;color:var(--muted);font-family:var(--sans);font-size:13px;font-weight:500;line-height:1.4;display:inline-flex;align-items:center;transition:color .15s ease}',
    '.tr-mode:not(:disabled):hover{color:var(--ink)}',
    '.tr-mode[aria-pressed="true"]{color:' + ACC + ';font-weight:700}',
    '.tr-mode:disabled{opacity:.5;cursor:not-allowed}',
    '.tr-mode[aria-pressed="true"]:disabled{opacity:.7}',
    '.tr-modes{margin-top:0}',
    '.tr-field{display:block;font-family:var(--sans);font-size:13px;font-weight:500;color:var(--muted);margin-bottom:2px}',
    '.tr-modeset{display:flex;gap:2px;flex-wrap:wrap}',
    '.tr-blurb{font-size:12px;color:var(--dim);margin:6px 0 0;max-width:52ch}',
    /* Every control is a real button, so every one carries a visible focus ring. */
    '.tr-drill:focus-visible,.tr-seg-btn:focus-visible,.tr-mode:focus-visible,.tr-start:focus-visible,.rs-act:focus-visible,.nb-focus-btn:focus-visible,.nb-exit-btn:focus-visible{outline:2px solid ' + ACC + ';outline-offset:2px}',
    /* Start: centered under the panel, the one primary action on the page. */
    '.tr-actions{justify-content:center}',
    '.tr-start{padding:12px 26px;font-size:15px;border-radius:10px;min-width:180px}',
    /* Results. The score leads, set large in the mono face; everything under it is
       quiet. Plain text actions, no boxes, same language as the picker. */
    '.rs-view{display:flex;flex-direction:column;align-items:center;gap:var(--gap-4);width:100%;max-width:min(680px,100%);margin-inline:auto;text-align:center;padding:var(--gap-2) 0}',
    '.rs-name{margin:0;font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim)}',
    '.rs-score{display:flex;align-items:baseline;justify-content:center;gap:12px;line-height:1}',
    '.rs-value{font-size:clamp(56px,15vw,120px);font-weight:600;letter-spacing:-.04em;color:var(--ink);font-variant-numeric:tabular-nums}',
    '.rs-unit{font-size:clamp(18px,3vw,26px);color:var(--muted)}',
    '.rs-acc{margin:0;font-size:14px;color:var(--muted)}',
    '.rs-acc .mono{color:var(--ink)}',
    '.rs-delta{margin:0;font-size:14px;color:var(--muted)}',
    '.rs-delta-v{color:var(--ink)}',
    '.rs-pr .rs-delta-v{color:' + ACC + '}',
    '.rs-delta-tag{color:var(--dim)}',
    '.rs-first{color:var(--muted)}',
    '.rs-chart-wrap{width:100%;display:flex;flex-direction:column;align-items:center;gap:6px}',
    '.rs-chart{display:flex;align-items:flex-end;justify-content:center;gap:6px;width:100%;max-width:360px;height:64px}',
    '.rs-bar{flex:1 1 0;max-width:26px;min-width:6px;border-radius:3px 3px 0 0;background:var(--line2)}',
    '.rs-bar-last{background:' + ACC + '}',
    '.rs-chart-cap{margin:0;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim)}',
    '.rs-actions{display:flex;gap:var(--gap-5);align-items:center;justify-content:center;flex-wrap:wrap;margin-top:var(--gap-2)}',
    '.rs-act{background:none;border:0;padding:6px 2px;font-family:var(--sans);font-size:15px;font-weight:600;color:var(--muted);cursor:pointer;transition:color .15s ease,opacity .15s ease}',
    '.rs-act:hover{color:var(--ink)}',
    '.rs-again{color:' + ACC + '}',
    '.rs-again:hover{color:' + ACC + ';opacity:.85}',
    /* The focus stage. focus.css sizes the stage; these rules lift its width cap
       and trim its gutter so a running drill is edge to edge. Later in the
       document than focus.css, so an equal-specificity rule here wins. */
    '.nb-focus-stage{padding:max(12px,2vh) max(12px,2vw)}',
    '.nb-focus-stage .drill-mount{max-width:none}',
    '.nb-focus-stage .drill{max-width:none}',
    /* The exit confirmation is a native modal dialog, so it needs the shared card
       rhythm by hand. Styled from here rather than focus.css, which is frozen. */
    '.nb-focus-stage dialog{border:1px solid var(--line2);border-radius:14px;background:var(--panel);color:var(--ink);padding:22px;width:min(420px,calc(100vw - 40px));box-shadow:0 30px 70px rgba(0,0,0,.55)}',
    '.nb-focus-stage dialog::backdrop{background:var(--scrim)}',
    '.nb-focus-stage dialog h2{margin:0 0 8px;font-size:20px;font-weight:600;letter-spacing:-.015em}',
    '.nb-focus-stage dialog p{margin:0 0 18px;font-size:13px;line-height:1.55;color:var(--muted)}',
    '.nb-focus-stage dialog button{font-family:var(--sans);font-size:13px;font-weight:600;padding:8px 14px;border-radius:8px;cursor:pointer;transition:transform .12s ease,border-color .15s ease,color .15s ease,opacity .15s ease}',
    '.nb-focus-stage dialog button+button{margin-left:10px}',
    /* Keeping is the default and the safe path, so it carries the accent. Ending is
       outlined, and only warns on hover. */
    '.nb-focus-stage dialog .nb-dialog-keep{background:var(--lime);color:var(--bg);border:1px solid var(--lime)}',
    '.nb-focus-stage dialog .nb-dialog-keep:hover{opacity:.9}',
    '.nb-focus-stage dialog .nb-dialog-end{background:transparent;border:1px solid var(--line2);color:var(--ink)}',
    '.nb-focus-stage dialog .nb-dialog-end:hover{border-color:var(--warn);color:var(--warn)}',
    /* Reduced motion: no transitions on any of the chrome. */
    '@media (prefers-reduced-motion:reduce){.tr-drill,.tr-seg-btn,.tr-mode,.rs-act,.nb-focus-stage dialog button{transition:none}}'
  ].join('');
  document.head.appendChild(s);
}

function buildDOM(container) {
  container.innerHTML = '';
  injectStyles();

  var D = (globalThis.Content && globalThis.Content.DRILLS) || [];

  /* The drill selector. Real buttons in a labelled group, so every drill is one
     click or one keypress away. Arrow keys move focus and selection together, and
     only the selected button is a tab stop, so the group is one stop, not nine. */
  var picker = h('div', 'tr-picker');
  picker.setAttribute('role', 'group');
  picker.setAttribute('aria-label', 'Choose a drill');
  var pickBtns = {};
  var order = D.map(function (p) { return p.id; });
  D.forEach(function (p) {
    (function (p) {
      var b = h('button', 'tr-drill');
      b.type = 'button';
      b.setAttribute('data-drill', p.id);
      b.setAttribute('aria-pressed', 'false');
      b.title = p.name;
      b.appendChild(h('span', 'tr-drill-name', p.name));
      b.addEventListener('click', function () { pickDrill(p.id); });
      pickBtns[p.id] = b;
      picker.appendChild(b);
    })(p);
  });
  picker.addEventListener('keydown', function (e) {
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

  /* One short line: the selected drill's name and its one description line. */
  var line = h('p', 'tr-line', '');

  /* The drill area. It takes the rest of the viewport; idle it holds the settings
     panel, and a run adopts its .drill node into the focus stage. */
  var mount = h('div', 'drill-mount tr-idle');

  /* Start sits under the mount and is the one primary action on the page. */
  var actions = h('div', 'row-actions tr-actions');
  var start = h('button', 'btn-primary tr-start', 'Start');
  start.type = 'button';
  actions.appendChild(start);

  var live = h('div', 'sr');
  live.setAttribute('aria-live', 'polite');

  container.appendChild(picker);
  container.appendChild(line);
  container.appendChild(mount);
  container.appendChild(actions);
  container.appendChild(live);

  ui = {
    line: line, mount: mount, live: live, startBtn: start,
    pickBtns: pickBtns,
    modesBlock: null, modeBtns: {}, modeBlurb: null,
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
  paintAll();
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
  /* The mode blurb carries the current mode's description, which a bare row of
     six buttons does not. While a set runs the picker is disabled, so it says
     why: a disabled control with no reason reads as broken. */
  if (ui.modeBlurb) {
    ui.modeBlurb.textContent = running
      ? 'Locked while a set runs.'
      : (cur ? cur.blurb : '');
  }
}

function paintAll() {
  var d = drillById(currentDrill);
  if (ui.line) ui.line.textContent = d.name + '. ' + (d.desc || '');

  /* Roving tabindex: the selected drill is the group's one tab stop, and its
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
  /* The set is live. The mode locks here and stays locked until finishSession
     unlocks it, so the running drill keeps the stream it started with. */
  var firstOfSet = !running;
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
  /* Held for the results view: the value, its unit, the accuracy the drill
     reported, and the best that stood before this run. prevBest is null on a
     first run, which is what makes the results say so instead of showing zero. */
  lastRun = {
    drillId: rec.drillId,
    value: rec.value,
    unit: rec.unit || (d && d.unit) || '',
    meta: rec.meta || {},
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
  paintAll();
  /* The set is done. Show the result in the drill area, so the numbers get the
     screen before the picker comes back. A set that recorded no run shows
     nothing. */
  if (lastRun) showResults(lastRun);
}

/* One decimal at most, so a mono readout stays short. */
function fmtNum(v) {
  if (typeof v !== 'number' || !isFinite(v)) return '';
  return String(Math.round(v * 100) / 100);
}

/* A small bar chart of this drill's last few runs, drawn from the stored records
   (the run just finished is already in state). The latest bar carries the accent.
   No axis, no labels on the bars: the caption and the score carry the meaning. */
function buildChart(drillId) {
  var wrap = h('div', 'rs-chart-wrap');
  var chart = h('div', 'rs-chart');
  var runs = (state && state.records ? state.records : []).filter(function (r) {
    return r && r.drillId === drillId;
  });
  var vals = runs.slice(-8).map(function (r) { return Number(r.value); }).filter(function (v) { return isFinite(v); });
  if (vals.length) {
    var max = 0;
    for (var i = 0; i < vals.length; i++) if (Math.abs(vals[i]) > max) max = Math.abs(vals[i]);
    if (!max) max = 1;
    for (var j = 0; j < vals.length; j++) {
      var bar = h('div', 'rs-bar' + (j === vals.length - 1 ? ' rs-bar-last' : ''));
      bar.style.height = Math.max(6, Math.round((Math.abs(vals[j]) / max) * 100)) + '%';
      chart.appendChild(bar);
    }
    chart.setAttribute('role', 'img');
    chart.setAttribute('aria-label', 'Last ' + vals.length + ' runs: ' + vals.map(fmtNum).join(', '));
  } else {
    chart.setAttribute('role', 'img');
    chart.setAttribute('aria-label', 'No runs recorded yet.');
  }
  wrap.appendChild(chart);
  wrap.appendChild(h('p', 'rs-chart-cap', vals.length > 1 ? 'Last ' + vals.length + ' runs' : 'Your runs'));
  return wrap;
}

/* The results view, in the drill area. The score leads, set large in the mono
   face with its unit; accuracy appears only where the drill reports one; the
   delta is against the best that stood before this run, and a first run says so.
   Two plain text actions: run the same drill again, or pick another. */
function showResults(run) {
  if (!ui.mount || !run) return;
  var d = drillById(run.drillId);
  var unit = run.unit || d.unit || '';
  var meta = run.meta || {};

  var view = h('div', 'rs-view');
  view.setAttribute('aria-label', d.name + ' result');
  view.appendChild(h('p', 'rs-name', d.name));

  var score = h('div', 'rs-score');
  score.appendChild(h('span', 'rs-value mono', fmtNum(run.value)));
  if (unit) score.appendChild(h('span', 'rs-unit mono', unit));
  view.appendChild(score);

  if (typeof meta.accuracy === 'number' && isFinite(meta.accuracy)) {
    var acc = h('p', 'rs-acc');
    acc.appendChild(document.createTextNode('Accuracy '));
    acc.appendChild(h('span', 'mono', Math.round(meta.accuracy * 100) + '%'));
    view.appendChild(acc);
  }

  var delta = h('p', 'rs-delta');
  if (run.prevBest == null) {
    delta.className = 'rs-delta rs-first';
    delta.textContent = 'First run. This sets your baseline.';
  } else {
    var diff = run.value - run.prevBest;
    delta.appendChild(document.createTextNode('vs your best '));
    delta.appendChild(h('span', 'rs-delta-v mono', (diff > 0 ? '+' : '') + fmtNum(diff) + (unit ? ' ' + unit : '')));
    delta.appendChild(h('span', 'rs-delta-tag', ' ' + (run.isPR ? 'new best' : (diff === 0 ? 'matched your best' : 'off your best'))));
    if (run.isPR) delta.classList.add('rs-pr');
  }
  view.appendChild(delta);

  view.appendChild(buildChart(run.drillId));

  var actions = h('div', 'rs-actions');
  var again = h('button', 'rs-act rs-again', 'Run again');
  again.type = 'button';
  var another = h('button', 'rs-act rs-another', 'Pick another');
  another.type = 'button';
  actions.appendChild(again);
  actions.appendChild(another);
  view.appendChild(actions);

  again.addEventListener('click', function () {
    if (ctxRef && ctxRef.audio && ctxRef.audio.resume) { try { ctxRef.audio.resume(); } catch (e) { /* degrade */ } }
    lastRun = null;
    startDrill();
  });
  another.addEventListener('click', returnToPicker);

  ui.mount.replaceChildren(view);
  setIdle(false);
  try { again.focus(); } catch (e) { /* degrade */ }
  say(d.name + ' finished. ' + fmtNum(run.value) + (unit ? ' ' + unit : '') + '.');
}

/* Back to the setup panel for the current drill. */
function returnToPicker() {
  lastRun = null;
  paintIdle();
  setIdle(true);
  paintAll();
  var b = ui.pickBtns && ui.pickBtns[currentDrill];
  if (b && b.focus) { try { b.focus(); } catch (e) { /* degrade */ } }
  say(drillById(currentDrill).name + ' selected. Press Start when ready.');
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
  seed = readSeed();
  writeSeed(seed);
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
