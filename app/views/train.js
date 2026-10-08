/* Neuralbase view: Train.
   Runs one drill at a time, records runs and sessions through ctx.db (idempotent client_id
   writes with demo fallback), and keeps a local cache for instant paint. Gating via Engine.
   Mounts its own DOM into the container. Reads cloud data; never touches index.html ids. */

var CACHE_KEY = 'cortex.cache.data';
var SELECT_KEY = 'cortex.train.select';
var QUEUE_KEY = 'cortex.train.queue';
var MODE_KEY = 'cortex.train.mode';
var SEED_KEY = 'cortex.train.seed';

/* The idle copy. Painted in three places, so it lives in one string. */
var IDLE_NOTE = 'Pick a program below, then start when you are ready.';

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
function statCell(label) {
  var w = h('div', 'stat');
  var l = h('span', 'stat-l', label);
  w.appendChild(l);
  var v = h('span', 'stat-v mono', '--');
  w.appendChild(v);
  return { wrap: w, v: v, l: l };
}
function drillById(id) {
  var D = (globalThis.Content && globalThis.Content.DRILLS) || [];
  for (var i = 0; i < D.length; i++) if (D[i].id === id) return D[i];
  return { id: id, name: 'Legacy run', icon: '', desc: '', trains: '', works: '', evidence: '', pro: false, direction: 'lower', unit: '' };
}
/* The drill's mark, drawn in currentColor. Markup is our own static SVG string. */
function iconEl(d) {
  var s = h('span', 'drill-ic');
  s.setAttribute('aria-hidden', 'true');
  if (d && d.icon) s.innerHTML = d.icon;
  return s;
}
function clientId() {
  try { if (globalThis.crypto && globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID(); } catch (e) { /* fall through */ }
  return 'run-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}
/* Mode picker state. The remembered mode is validated against the current plan
   on every read, so downgrading from Pro falls back to the default instead of
   silently handing Drills a mode the user cannot open. */
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

/* ---------- focus mode ----------
   A running drill gets the whole screen. app/focus.css was written for this and
   loaded, but nothing switched it on, so a set ran in a 320px box in the middle
   of the Train page with the programs band and the topbar all still competing
   for attention. The stage is a real node here, not a CSS class on body: the
   drill has to be moved into it, and moved back on exit, so the running drill
   keeps its DOM and its timers. */
var focus = { stage: null, scrim: null, on: false, drill: null, from: null };

function enterFocus() {
  if (focus.on) return;
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
  var named = ui && ui.drillName ? (ui.drillName.textContent || '') : '';
  title.textContent = named.trim();
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
  document.body.appendChild(scrim);
  document.body.appendChild(stage);
  document.body.classList.add('focus');

  focus.stage = stage;
  focus.scrim = scrim;
  focus.drill = drill;
  focus.from = mount;
  focus.on = true;

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
    /* Stage down first: leaveFocus puts the drill node back in the mount, and
       stopSet then clears the mount and writes the idle placeholder, so the two
       run in that order or a stale drill node ends up sitting beside the
       placeholder. */
    leaveFocus();
    stopSet();
    if (ctxRef && ctxRef.audio && ctxRef.audio.silence) {
      try { ctxRef.audio.silence(); } catch (e) { /* degrade */ }
    }
  }
  exit.addEventListener('click', out);

  /* Escape leaves. It only applies while the stage is up, and the listener goes
     away with it so it cannot fire on a normal page afterwards. */
  focus.onKey = function (e) {
    if (e.key === 'Escape') { e.preventDefault(); out(); }
  };
  document.addEventListener('keydown', focus.onKey, true);

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
  if (ui.startBtn) { ui.startBtn.disabled = false; ui.startBtn.textContent = 'Start'; }
  hidePR();
  paintIdle();
  setIdle(true);
  paintAll();
}

/* The idle mount. One drill wrapper with one line in it, so every paint of it
   looks the same. */
function paintIdle() {
  if (!ui.mount) return;
  ui.mount.replaceChildren();
  var ph = h('div', 'drill');
  ph.appendChild(h('div', 'drill-note tr-idle-note', IDLE_NOTE));
  ui.mount.appendChild(ph);
}

function leaveFocus() {
  if (!focus.on) return;
  if (focus.onKey) {
    document.removeEventListener('keydown', focus.onKey, true);
    focus.onKey = null;
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

/* A millisecond value reads as slow or fast, so the unit rides along with the
   number. A count of correct answers does not need one. */
function unitSuffix(d) {
  var u = (d && d.unit) || '';
  return u && u !== 'correct' && u !== 'items' && u !== 'cards' ? ' ' + u : '';
}

/* Scoped styles. Theme tokens only, so every theme picks them up. */
function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById('nb-train-styles')) return;
  var s = document.createElement('style');
  s.id = 'nb-train-styles';
  s.textContent = [
    /* The root is one centered column that keeps the frame .view gives every page:
       a flex column taking the height the shell has left. display:block here would
       opt this one view out and leave it clinging to the top.

       Two changes from the first version. The 1080px ceiling is gone, because it
       was sized for the old two column grid and left the drill boxed in a narrow
       lane with dead space on both sides at any wide viewport. The panel now takes
       the full width of the frame, and the mount below it takes the leftover
       height, so the drill area is where the eye lands rather than a band of empty
       panel under a narrow lane. max-width:none cancels the view-mid-wide ceiling
       the container carries: that is a measure width, and a measure is a limit on
       running text, not on the card the text sits in. */
    '.tr-view{display:flex;flex-direction:column;gap:var(--gap-4);width:100%;max-width:none;margin-inline:0;flex:1 1 auto;min-height:0}',
    '.tr-panel{align-self:stretch;width:100%;max-width:none;display:flex;flex-direction:column;flex:1 1 auto;min-height:0}',
    /* The topbar owns the view title now, so the panel head carries the drill's own
       name and one description line under it, not a second title block. */
    '.tr-desc{font-size:13px;color:var(--muted);line-height:1.45;margin:0 0 10px;max-width:62ch}',
    /* The programs band stays a size container so the grid below it responds to the
       width it actually has. Viewport breakpoints cannot see how much the frame
       left over. The gap on .tr-view is the space above this band, so it carries
       no margin of its own. It is full width, same as the panel, so the two cards
       read as one column rather than a wide panel over a narrower strip. */
    '.tr-band{align-self:stretch;container-type:inline-size;width:100%}',
    '.tr-band-meta{display:flex;align-items:baseline;gap:12px}',
    '.tr-modes{margin-top:2px}',
    '.tr-field{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);margin-bottom:7px}',
    '.tr-modeset{display:flex;gap:6px;flex-wrap:wrap}',
    '.tr-mode{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;padding:6px 9px;border-radius:8px;background:transparent;border:1px solid var(--line2);color:var(--muted);display:inline-flex;align-items:center;gap:6px;transition:border-color .15s ease,color .15s ease}',
    '.tr-mode:not(:disabled):hover{border-color:var(--lime-edge);color:var(--ink)}',
    '.tr-mode[aria-pressed="true"]{color:var(--lime);border-color:var(--lime-edge);background:var(--lime-soft)}',
    '.tr-mode:disabled{opacity:.5;cursor:not-allowed}',
    '.tr-mode[aria-pressed="true"]:disabled{opacity:.7}',
    '.tr-blurb{font-size:13px;color:var(--muted);margin:7px 0 0;max-width:52ch}',
    /* The mount takes what is left of the panel, so the drill area grows with the
       window instead of sitting at the shared 238px reserve. flex:1 has nothing to
       absorb on a page that already scrolls, so the idle box also carries a floor
       set against the viewport height. It is the area the drill will occupy, so it
       is drawn as one, dashed and centred, with the one idle line in the middle.
       The clamp caps it: past about a third of the screen the idle box is more
       empty than useful, and an oversized empty box reads as something missing. */
    '.tr-view .drill-mount{flex:1 1 auto;min-height:clamp(220px,30vh,420px)}',
    '.tr-view .drill-mount.tr-idle{justify-content:safe center;align-items:center;text-align:center;border:1px dashed var(--line2);border-radius:8px;padding:20px}',
    '.tr-view .drill-mount.tr-idle .drill{max-width:46ch}',
    '.tr-idle-note{font-size:14px;line-height:1.5}',
    '.tr-pr{display:flex;align-items:baseline;gap:8px;margin-top:11px;padding:9px 10px;border:1px solid var(--lime-edge);background:var(--lime-soft);border-radius:8px}',
    '.tr-pr-label{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--lime);flex:none}',
    '.tr-pr-copy{font-size:13px;color:var(--ink);margin:0;line-height:1.45}',
    '.tr-pr-copy .mono{font-variant-numeric:tabular-nums}',
    /* One uniform grid. grid-auto-rows:1fr sizes every row to the tallest card in
       the band, so all nine land on identical heights no matter how their text
       wraps, and each card fills its row. */
    '.tr-progs{padding:0;list-style:none;margin:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:1fr;gap:10px}',
    '@container (max-width:660px){.tr-progs{grid-template-columns:repeat(2,minmax(0,1fr))}}',
    '@container (max-width:440px){.tr-progs{grid-template-columns:minmax(0,1fr)}}',
    '.tr-progs>li{display:flex;min-width:0}',
    /* Hover moves the border only. A transform here would slide a card out of its
       column, which is the raggedness this grid exists to remove. */
    '.tr-prog{width:100%;flex:1 1 auto;min-width:0;text-align:left;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:5px;transition:border-color .15s ease,background .15s ease}',
    '.tr-prog:hover{border-color:var(--lime-edge)}',
    '.tr-prog[aria-current="true"]{border-color:var(--lime-edge);background:var(--lime-soft)}',
    '.tr-prog-top{display:flex;align-items:center;gap:9px;min-width:0;width:100%}',
    '.tr-prog .prog-name{flex:1 1 auto;min-width:0;overflow:hidden}',
    /* One line, ellipsis past that. A name that wraps would push its card taller
       than the one beside it, which is the raggedness the grid cannot fix alone. */
    '.tr-prog-name{font-size:13px;font-weight:600;flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    /* margin-top:auto lands the skill line on the same baseline in every card. */
    '.tr-prog-trains{font-size:12px;color:var(--muted);line-height:1.4;margin-top:auto;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    /* The panel is the only card in the column, so it can take a little of the
       panel padding off its sides on a phone to give the drill more width. */
    '@media (max-width:420px){.tr-panel{padding:10px}.tr-band{padding:12px}}'
  ].join('');
  document.head.appendChild(s);
}

function buildDOM(container) {
  container.innerHTML = '';
  injectStyles();

  var D = (globalThis.Content && globalThis.Content.DRILLS) || [];

  var panel = h('div', 'card panel-card tr-panel');
  var ch = h('div', 'card-head');
  var chTitle = h('span', 'card-title');
  var dicon = h('span', 'drill-ic');
  dicon.setAttribute('aria-hidden', 'true');
  var dn = h('h3', null, 'Executive N-Back');
  chTitle.appendChild(dicon); chTitle.appendChild(dn);
  ch.appendChild(chTitle);
  /* The drill's own description. The topbar owns the view title, so the panel head
     carries the name and this one line under it, nothing that repeats the topbar. */
  var ddesc = h('p', 'tr-desc', '');

  /* N-back mode picker. Only meaningful for n-back, so it stays hidden for the
     other eight drills rather than showing a control that does nothing. */
  var modesBlock = h('div', 'tr-modes');
  modesBlock.appendChild(h('span', 'tr-field', 'Mode'));
  var modeSet = h('div', 'tr-modeset');
  modeSet.setAttribute('role', 'group');
  modeSet.setAttribute('aria-label', 'N-back mode');
  var modeBtns = {};
  var MODES = (globalThis.Content && globalThis.Content.MODES) || [];
  var Engine = globalThis.Engine || {};
  MODES.forEach(function (m) {
    (function (m) {
      var b = h('button', 'tr-mode');
      b.type = 'button';
      b.setAttribute('data-mode', m.id);
      b.setAttribute('aria-pressed', 'false');
      b.appendChild(h('span', null, m.name));
      b.addEventListener('click', function () { pickMode(m); });
      modeBtns[m.id] = b;
      modeSet.appendChild(b);
    })(m);
  });
  modesBlock.appendChild(modeSet);
  var modeBlurb = h('p', 'tr-blurb', '');
  modesBlock.appendChild(modeBlurb);

  var mount = h('div', 'drill-mount tr-idle');
  var stats = h('div', 'stats');
  var last = statCell('Last'), best = statCell('Best'), avg = statCell('Average');
  stats.appendChild(last.wrap); stats.appendChild(best.wrap); stats.appendChild(avg.wrap);

  var pr = h('div', 'tr-pr');
  pr.hidden = true;
  pr.setAttribute('aria-live', 'polite');
  pr.appendChild(h('span', 'tr-pr-label', 'Best'));
  var prCopy = h('p', 'tr-pr-copy', '');
  pr.appendChild(prCopy);

  var actions = h('div', 'row-actions');
  var start = h('button', 'btn-primary', 'Start');
  start.type = 'button';
  actions.appendChild(start);

  panel.appendChild(ch);
  panel.appendChild(ddesc);
  panel.appendChild(modesBlock);
  panel.appendChild(mount);
  panel.appendChild(stats);
  panel.appendChild(pr);
  panel.appendChild(actions);

  /* Programs band. A full width card under the panel, so the nine drills get the
     room a uniform grid needs. Real buttons, so every drill is reachable by
     keyboard, with the Pro gate doing the same thing here as it does in
     Programs. */
  var pc = h('div', 'card programs-card tr-band');
  var pch = h('div', 'card-head');
  pch.appendChild(h('h3', null, 'Training programs'));
  var bandMeta = h('span', 'tr-band-meta');
  var bandLevel = h('span', 'mono cap', 'Level 1');
  bandMeta.appendChild(bandLevel);
  bandMeta.appendChild(h('span', 'mono cap', D.length + ' drills'));
  pch.appendChild(bandMeta);
  pc.appendChild(pch);
  var plist = h('ul', 'tr-progs');
  var progBtns = {};
  /* Registry order, which is the order the drills are meant to be tried in. */
  var ordered = D.slice();
  ordered.forEach(function (p) {
    (function (p) {
      var li = h('li');
      var b = h('button', 'tr-prog');
      b.type = 'button';
      b.setAttribute('data-drill', p.id);
      var top = h('span', 'tr-prog-top');
      var nameWrap = h('span', 'prog-name');
      nameWrap.appendChild(iconEl(p));
      var pname = h('span', 'tr-prog-name', p.name);
      /* The name is one line with an ellipsis, so the full text rides on title
         for anyone who cannot see the whole string. */
      pname.title = p.name;
      nameWrap.appendChild(pname);
      top.appendChild(nameWrap);
      b.appendChild(top);
      b.appendChild(h('span', 'tr-prog-trains', p.trains));
      b.addEventListener('click', function () { pickDrill(p.id); });
      progBtns[p.id] = b;
      li.appendChild(b);
      plist.appendChild(li);
    })(p);
  });
  pc.appendChild(plist);

  container.appendChild(panel);
  container.appendChild(pc);

  var live = h('div', 'sr');
  live.setAttribute('aria-live', 'polite');
  container.appendChild(live);

  ui = {
    drillName: dn, drillIcon: dicon, drillDesc: ddesc, mount: mount,
    sLast: last.v, sBest: best.v, sAvg: avg.v,
    statLAvg: avg.l, statLBest: best.l, live: live,
    startBtn: start, bandLevel: bandLevel,
    modesBlock: modesBlock, modeBtns: modeBtns, modeBlurb: modeBlurb,
    pr: pr, prCopy: prCopy, progBtns: progBtns
  };
  paintIdle();
  start.addEventListener('click', function () {
    if (ctxRef.audio && ctxRef.audio.resume) { try { ctxRef.audio.resume(); } catch (e) { /* degrade */ } }
    startDrill();
  });
}

function setNum(node, val, suffix) {
  if (!node) return;
  if (val == null) { node.textContent = '--'; return; }
  var M = ctxRef && ctxRef.motion;
  if (M && M.countUp) M.countUp(node, val, { suffix: suffix || '', duration: 400 });
  else node.textContent = val + (suffix || '');
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

/* Mode selection, including the Pro gate. A Free user tapping an Arithmetic or
   Spatial button lands on pricing and keeps the mode they had, the same rule
   the drill list follows. */
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

function pickDrill(id) {
  currentDrill = id;
  if (handle && handle.stop) handle.stop();
  handle = null;
  paintIdle();
  setIdle(true);
  hidePR();
  paintAll();
  if (ctxRef.audio && ctxRef.audio.resume) { try { ctxRef.audio.resume(); } catch (e) { /* degrade */ } }
  /* Selecting a drill from the list starts it, so one tap does what the label
     says. Start and Restart stay available below. */
  runDrills([id], false);
}

function showPR(rec, d) {
  if (!ui.pr || !ui.prCopy) return;
  var dir = d.direction === 'lower' ? 'lower' : 'higher';
  var unit = rec.unit || d.unit || '';
  var now = rec.value + (unit ? ' ' + unit : '');
  var prev = rec.prev + (unit ? ' ' + unit : '');
  var word = dir === 'lower' ? 'under' : 'over';
  ui.prCopy.textContent = d.name + ' ' + now + ', ' + word + ' the previous best of ' + prev + '.';
  ui.pr.hidden = false;
  say('New personal best on ' + d.name + '. ' + now + ', previous best ' + (prev || 'none') + '.');
}

function hidePR() {
  if (ui.pr) ui.pr.hidden = true;
  if (ui.prCopy) ui.prCopy.textContent = '';
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
  var Store = globalThis.Store;
  var d = drillById(currentDrill);
  if (ui.drillName) ui.drillName.textContent = d.name;
  if (ui.drillIcon) ui.drillIcon.innerHTML = d.icon || '';
  if (ui.drillDesc) ui.drillDesc.textContent = d.desc || '';

  /* Best is the lowest number for ufov and crt and the highest for the rest, so
     the stat label carries the direction instead of leaving the reader to guess
     from the unit. */
  var lower = d.direction === 'lower';
  if (ui.statLBest) ui.statLBest.textContent = lower ? 'Best (low)' : 'Best (high)';
  if (ui.statLAvg) ui.statLAvg.textContent = lower ? 'Average (low)' : 'Average (high)';
  var suffix = unitSuffix(d);

  var a = Store.aggregate(state, d.id, d.direction);
  setNum(ui.sLast, a.recent.length ? a.recent[a.recent.length - 1] : null, suffix);
  setNum(ui.sBest, a.best, suffix);
  setNum(ui.sAvg, a.avg, suffix);
  if (ui.bandLevel) ui.bandLevel.textContent = 'Level ' + Store.level(state);

  if (ui.progBtns) {
    Object.keys(ui.progBtns).forEach(function (id) {
      var b = ui.progBtns[id];
      b.setAttribute('aria-current', id === currentDrill ? 'true' : 'false');
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
  hidePR();
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
      recordRun(rec); nextDrill();
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
  if (isPR) {
    var withPrev = { drillId: rec.drillId, value: rec.value, unit: rec.unit || '', prev: prevBest };
    showPR(withPrev, d);
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
  hidePR();
  ctxRef = ctx;
  mode = readMode();
  seed = readSeed();
  writeSeed(seed);
  /* The shared centered column. Train carries a drill panel and the nine program
     cards, so it takes the wide one rather than the 780 column. */
  container.classList.add('view', 'view-mid-wide', 'tr-view');
  container.setAttribute('aria-label', 'Train');
  buildDOM(container);

  var sel = takeSelect();
  if (sel && globalThis.Content && globalThis.Content.DRILLS) currentDrill = sel;
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