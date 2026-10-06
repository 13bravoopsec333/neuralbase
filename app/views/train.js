/* Neuralbase view: Train.
   Runs one drill at a time, records runs and sessions through ctx.db (idempotent client_id
   writes with demo fallback), and keeps a local cache for instant paint. Gating via Engine.
   Mounts its own DOM into the container. Reads cloud data; never touches index.html ids. */

var CACHE_KEY = 'cortex.cache.data';
var SELECT_KEY = 'cortex.train.select';
var QUEUE_KEY = 'cortex.train.queue';
var MODE_KEY = 'cortex.train.mode';
var SEED_KEY = 'cortex.train.seed';
var DAY = 86400000;
var WLABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/* Drills whose trials come from a seedable stream, so a seed means something
   for them. Spaced Retrieval is a due-card queue, Signal Alert and Simple
   Reaction draw their own targets, and Mental Arithmetic steps its own level,
   so the seed control stays out of the way there. */
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
function planOf(ctx) { return ctx && ctx.profile && ctx.profile.plan === 'pro' ? 'pro' : 'free'; }
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
  var ok = !Engine || typeof Engine.canAccessMode !== 'function'
    ? true
    : Engine.canAccessMode('nback', v, plan);
  return ok ? v : want;
}
function writeMode(id) {
  try { localStorage.setItem(MODE_KEY, id); } catch (e) { /* degrade */ }
}

/* A seed is an 8 digit hex label. Short enough to read out loud, wide enough
   that a collision is not worth worrying about, and it doubles as the label
   under the run so a result can be matched to the sequence that produced it. */
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
var prShown = false;
/* True from the moment a set starts until it ends. The mode picker and the seed
   control both change the trial stream a running drill already committed to, so
   they are locked for the life of the set and unlocked at the finish. */
var running = false;

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
    /* The root is the shared centered column. The width is restated here so the view
       still centers on its own while .view-mid-wide lands in styles.css. */
    '.tr-view{display:block;max-width:1080px;margin-inline:auto}',
    /* The topbar owns the view title now, so the panel head carries the drill's own
       name and one description line under it, not a second title block. */
    '.tr-desc{font-size:13px;color:var(--muted);line-height:1.45;margin:0 0 10px;max-width:62ch}',
    /* Right rail. The session card sizes to its own content; a stretched card would
       trail a quiet void below the week strip whenever the drill panel is taller. */
    '.tr-side{align-self:start}',
    /* One rhythm inside the card. The shared rules give these blocks their own
       margins, which stacked into five uneven gaps; scoped here they all fall back
       to the card's single gap so the panel reads as one object. */
    '.tr-session{display:flex;flex-direction:column;gap:14px}',
    '.tr-session .card-head{margin-bottom:0}',
    '.tr-session .pips{margin-bottom:0}',
    '.tr-session .tr-today{margin-top:0}',
    '.tr-session .tr-left{margin-top:0}',
    '.tr-session .week-mini{margin-top:0;padding-top:0;border-top:0}',
    /* The programs band is a size container so the grid below it responds to the
       width it actually has. Viewport breakpoints cannot see that the rail eats
       208px between 821 and 900px and not below it. */
    '.tr-band{margin-top:14px;container-type:inline-size}',
    '.tr-modes{margin-top:2px}',
    '.tr-field{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);margin-bottom:7px}',
    '.tr-modeset{display:flex;gap:6px;flex-wrap:wrap}',
    '.tr-mode{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;padding:6px 9px;border-radius:8px;background:transparent;border:1px solid var(--line2);color:var(--muted);display:inline-flex;align-items:center;gap:6px;transition:border-color .15s ease,color .15s ease}',
    '.tr-mode:not(:disabled):hover{border-color:var(--lime-edge);color:var(--ink)}',
    '.tr-mode[aria-pressed="true"]{color:var(--lime);border-color:var(--lime-edge);background:var(--lime-soft)}',
    '.tr-mode:disabled{opacity:.5;cursor:not-allowed}',
    '.tr-mode[aria-pressed="true"]:disabled{opacity:.7}',
    '.tr-mode .tr-pro{font-size:10px;letter-spacing:.06em;color:var(--lime);border:1px solid var(--lime-edge);border-radius:8px;padding:1px 4px}',
    '.tr-blurb{font-size:13px;color:var(--muted);margin:7px 0 0;max-width:52ch}',
    '.tr-seed{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:12px;padding-bottom:12px;border-bottom:1px solid var(--line)}',
    '.tr-seed-label{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);flex:none}',
    '.tr-seed-val{font-family:var(--mono);font-size:13px;font-variant-numeric:tabular-nums;letter-spacing:.06em;color:var(--ink);border:1px solid var(--line2);border-radius:8px;padding:3px 8px;background:var(--panel2);flex:none}',
    '.tr-seed-btn{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;padding:5px 9px;border-radius:8px;background:transparent;border:1px solid var(--line2);color:var(--muted);transition:border-color .15s ease,color .15s ease;flex:none}',
    '.tr-seed-btn:not(:disabled):hover{border-color:var(--lime-edge);color:var(--ink)}',
    '.tr-seed-btn:disabled{opacity:.5;cursor:not-allowed}',
    '.tr-seed-note{font-size:12px;color:var(--dim);margin:0 0 0 auto;text-align:right;flex:1 1 auto}',
    /* The shared .drill-mount reserves 238px for a running drill. That reserve is a
       void when nothing is running, so the idle mount is only as tall as its
       placeholder. A running drill sizes its own stage. */
    '.tr-view .drill-mount{min-height:0}',
    '.tr-view .drill-mount.tr-idle{min-height:52px;justify-content:center;align-items:center;text-align:center;border:1px dashed var(--line2);border-radius:8px}',
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
    '.tr-prog-tag{margin-left:auto;font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);border:1px solid var(--line2);border-radius:8px;padding:2px 5px;flex:none;white-space:nowrap}',
    '.tr-prog-tag.locked{color:var(--lime);border-color:var(--lime-edge);background:var(--lime-soft)}',
    /* margin-top:auto lands the skill line on the same baseline in every card. */
    '.tr-prog-trains{font-size:12px;color:var(--muted);line-height:1.4;margin-top:auto;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    '.tr-empty{color:var(--dim);font-size:13px;margin:10px 0 0}',
    /* Today's read: what ran, what it covered, what is still owed. */
    '.tr-today{font-size:13px;color:var(--muted);margin:12px 0 0;line-height:1.5}',
    '.tr-left{font-size:13px;color:var(--dim);margin:6px 0 0;line-height:1.5}'
  ].join('');
  document.head.appendChild(s);
}

function buildDOM(container) {
  container.innerHTML = '';
  injectStyles();

  var D = (globalThis.Content && globalThis.Content.DRILLS) || [];

  var grid = h('div', 'train-grid');
  var panel = h('div', 'card panel-card');
  var ch = h('div', 'card-head');
  var chTitle = h('span', 'card-title');
  var dicon = h('span', 'drill-ic');
  dicon.setAttribute('aria-hidden', 'true');
  var dn = h('h3', null, 'Executive N-Back');
  chTitle.appendChild(dicon); chTitle.appendChild(dn);
  var tag = h('span', 'mono cap', 'Free');
  ch.appendChild(chTitle); ch.appendChild(tag);
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
  var proOnly = Engine.PRO_ONLY_MODES || [];
  MODES.forEach(function (m) {
    (function (m) {
      var b = h('button', 'tr-mode');
      b.type = 'button';
      b.setAttribute('data-mode', m.id);
      b.setAttribute('aria-pressed', 'false');
      b.appendChild(h('span', null, m.name));
      if (proOnly.indexOf(m.id) !== -1) b.appendChild(h('span', 'tr-pro', 'Pro'));
      b.addEventListener('click', function () { pickMode(m); });
      modeBtns[m.id] = b;
      modeSet.appendChild(b);
    })(m);
  });
  modesBlock.appendChild(modeSet);
  var modeBlurb = h('p', 'tr-blurb', '');
  modesBlock.appendChild(modeBlurb);

  /* Seed readout. Reads as an instrument control, because that is what it is:
     the same seed replays the identical trial sequence. */
  var seedRow = h('div', 'tr-seed');
  seedRow.appendChild(h('span', 'tr-seed-label', 'Seed'));
  var seedVal = h('span', 'tr-seed-val', '--------');
  seedRow.appendChild(seedVal);
  var seedBtn = h('button', 'tr-seed-btn', 'New seed');
  seedBtn.type = 'button';
  seedBtn.setAttribute('aria-label', 'New seed');
  seedRow.appendChild(seedBtn);
  var seedNote = h('span', 'tr-seed-note', '');
  seedRow.appendChild(seedNote);

  var mount = h('div', 'drill-mount tr-idle');
  mount.innerHTML = '<div class="drill"><div class="drill-note">Press start to begin.</div></div>';
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
  panel.appendChild(seedRow);
  panel.appendChild(mount);
  panel.appendChild(stats);
  panel.appendChild(pr);
  panel.appendChild(actions);

  var col = h('div', 'col tr-side');
  var sc = h('div', 'card session-card tr-session');
  var sch = h('div', 'card-head');
  sch.appendChild(h('h3', null, "Today's session"));
  var sessionVal = h('span', 'mono cap', '0 of 3 today');
  sch.appendChild(sessionVal);
  /* The pips are the daily goal, filled by sessions run today, so the row is a
     real target meter instead of three fixed marks that meant nothing. */
  var pips = h('div', 'pips');
  var todayLine = h('p', 'tr-today', '');
  var leftLine = h('p', 'tr-left', '');
  var mini = h('div', 'mini-stats');
  var streak = statCell('Streak'), level = statCell('Level');
  mini.appendChild(streak.wrap); mini.appendChild(level.wrap);
  var weekMini = h('div', 'week-mini');
  sc.appendChild(sch); sc.appendChild(pips); sc.appendChild(todayLine); sc.appendChild(leftLine);
  sc.appendChild(mini); sc.appendChild(weekMini);
  col.appendChild(sc);

  /* Programs band. A full width card under the panel, so the nine drills get the
     room a uniform grid needs instead of sharing a rail with the session card.
     Real buttons, so every drill is reachable by keyboard, with the Pro gate
     doing the same thing here as it does in Programs. */
  var pc = h('div', 'card programs-card tr-band');
  var pch = h('div', 'card-head');
  pch.appendChild(h('h3', null, 'Training programs'));
  pch.appendChild(h('span', 'mono cap', D.length + ' drills'));
  pc.appendChild(pch);
  var plist = h('ul', 'tr-progs');
  var progBtns = {};
  D.forEach(function (p) {
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
      var ptag = h('span', 'tr-prog-tag', p.pro ? 'Pro' : 'Free');
      top.appendChild(ptag);
      b.appendChild(top);
      b.appendChild(h('span', 'tr-prog-trains', p.trains));
      b.addEventListener('click', function () { pickDrill(p.id); });
      progBtns[p.id] = b;
      li.appendChild(b);
      plist.appendChild(li);
    })(p);
  });
  pc.appendChild(plist);

  grid.appendChild(panel); grid.appendChild(col);
  container.appendChild(grid);
  container.appendChild(pc);

  var live = h('div', 'sr');
  live.setAttribute('aria-live', 'polite');
  container.appendChild(live);

  ui = {
    drillName: dn, drillIcon: dicon, drillTag: tag, drillDesc: ddesc, mount: mount,
    sLast: last.v, sBest: best.v, sAvg: avg.v,
    statLAvg: avg.l, statLBest: best.l, live: live,
    startBtn: start, sessionVal: sessionVal, pips: pips,
    todayLine: todayLine, leftLine: leftLine,
    sStreak: streak.v, sLevel: level.v, weekMini: weekMini,
    modesBlock: modesBlock, modeBtns: modeBtns, modeBlurb: modeBlurb,
    seedRow: seedRow, seedVal: seedVal, seedBtn: seedBtn, seedNote: seedNote,
    pr: pr, prCopy: prCopy, progBtns: progBtns
  };
  start.addEventListener('click', function () {
    if (ctxRef.audio && ctxRef.audio.resume) { try { ctxRef.audio.resume(); } catch (e) { /* degrade */ } }
    startDrill();
  });
  seedBtn.addEventListener('click', function () {
    /* Locked for the life of a set: a new seed would hand a running drill a stream
       it never drew. The button is disabled too; this is the belt to that. */
    if (running) return;
    seed = newSeed();
    writeSeed(seed);
    paintAll();
    say(seed + ' set. The next run replays that sequence.');
  });
}

function setNum(node, val, suffix) {
  if (!node) return;
  if (val == null) { node.textContent = '--'; return; }
  var M = ctxRef && ctxRef.motion;
  if (M && M.countUp) M.countUp(node, val, { suffix: suffix || '', duration: 400 });
  else node.textContent = val + (suffix || '');
}

/* The idle placeholder is the only content that needs the small reserved height.
   A running drill brings its own stage, so the flag comes off. */
function setIdle(on) {
  if (!ui.mount) return;
  if (on) ui.mount.classList.add('tr-idle');
  else ui.mount.classList.remove('tr-idle');
}

/* The daily target, read from the profile the way the dashboard reads it, so the
   same number drives the ring there and the meter here. Three when nothing is set. */
function dailyGoal() {
  var p = ctxRef && ctxRef.profile;
  var g = p ? Number(p.daily_goal != null ? p.daily_goal : p.dailyGoal) : NaN;
  if (!isFinite(g) || g < 1) g = 3;
  return Math.round(g);
}
/* The card answers three questions about today, from the runs and sessions already
   in state: how many sessions ran, which drills they covered, and how many are
   still owed to the target. Nothing here is invented; an empty day says so. */
function paintToday() {
  var Store = globalThis.Store;
  if (!ui.sessionVal) return;
  var todayKey = Store.iso(new Date());
  var goal = dailyGoal();
  var today = 0, done = {}, order = [];
  for (var i = 0; i < state.sessions.length; i++) {
    if (Store.iso(new Date(state.sessions[i].t)) !== todayKey) continue;
    today++;
    var drills = state.sessions[i].drills || [];
    for (var j = 0; j < drills.length; j++) {
      if (drills[j] && !done[drills[j]]) { done[drills[j]] = 1; order.push(drills[j]); }
    }
  }
  /* A run logged today counts even before its session write lands, so the meter
     never lags the drill the user just finished. */
  for (var r = 0; r < state.records.length; r++) {
    var rec = state.records[r];
    if (!rec.drillId || Store.iso(new Date(rec.t)) !== todayKey) continue;
    if (!done[rec.drillId]) { done[rec.drillId] = 1; order.push(rec.drillId); }
  }
  /* Past the target the count is not a fraction of anything, so the chip stops
     reading like one. "9 of 3" is nonsense; the goal is met, and the day's total
     is what is worth saying. */
  ui.sessionVal.textContent = today >= goal
    ? 'Goal met \u00b7 ' + today + ' today'
    : today + ' of ' + goal + ' today';

  if (ui.pips) {
    while (ui.pips.firstChild) ui.pips.removeChild(ui.pips.firstChild);
    /* Capped so a large target cannot push the row past the card edge. */
    var shown = Math.min(goal, 8);
    var lit = Math.min(today, shown);
    for (var p = 0; p < shown; p++) ui.pips.appendChild(h('span', 'pip' + (p < lit ? ' on' : '')));
  }
  if (ui.todayLine) {
    if (order.length) {
      var names = order.slice(0, 4).map(function (id) { return drillById(id).name; });
      var extra = order.length - names.length;
      ui.todayLine.textContent = 'Trained today: ' + names.join(', ') +
        (extra > 0 ? ' and ' + extra + ' more' : '') + '.';
    } else {
      ui.todayLine.textContent = 'Nothing trained yet today.';
    }
  }
  if (ui.leftLine) {
    var left = goal - today;
    if (today <= 0) ui.leftLine.textContent = 'Run ' + goal + ' to close out today\u2019s target.';
    else if (left > 0) ui.leftLine.textContent = left + (left === 1 ? ' more session' : ' more sessions') + ' to close out today\u2019s target.';
    else ui.leftLine.textContent = 'Today\u2019s target is met. Anything past this is a bonus.';
  }
}

function paintWeek(el) {
  if (!el) return;
  var Store = globalThis.Store;
  el.innerHTML = '';
  var counts = {};
  for (var s = 0; s < state.sessions.length; s++) {
    var k = Store.iso(new Date(state.sessions[s].t));
    counts[k] = (counts[k] || 0) + 1;
  }
  var now = new Date(); now.setHours(0, 0, 0, 0);
  var monday = new Date(now.getTime() - ((now.getDay() + 6) % 7) * DAY);
  var ti = (new Date().getDay() + 6) % 7;
  for (var i = 0; i < 7; i++) {
    var day = new Date(monday.getTime() + i * DAY);
    var n = counts[Store.iso(day)] || 0;
    var c = h('div', 'wcell' + (n > 0 ? ' on' : '') + (i === ti ? ' today' : ''));
    c.appendChild(h('span', 'wlab mono', WLABELS[i]));
    c.appendChild(h('span', 'wbar'));
    if (n > 0) c.title = n + (n > 1 ? ' sessions' : ' session');
    el.appendChild(c);
  }
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
  var Engine = globalThis.Engine;
  var plan = planOf(ctxRef);
  if (Engine && typeof Engine.canAccessMode === 'function' && !Engine.canAccessMode('nback', m.id, plan)) {
    if (ctxRef.navigate) ctxRef.navigate('pricing');
    return;
  }
  mode = m.id;
  writeMode(mode);
  paintAll();
  say('Mode set to ' + m.name + '.');
}

function pickDrill(id) {
  var Engine = globalThis.Engine;
  var plan = planOf(ctxRef);
  if (Engine && typeof Engine.canAccess === 'function' && !Engine.canAccess(id, plan)) {
    if (ctxRef.navigate) ctxRef.navigate('pricing');
    return;
  }
  currentDrill = id;
  if (handle && handle.stop) handle.stop();
  handle = null;
  ui.mount.innerHTML = '<div class="drill"><div class="drill-note">Press start to begin.</div></div>';
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
  prShown = false;
  if (ui.pr) ui.pr.hidden = true;
  if (ui.prCopy) ui.prCopy.textContent = '';
}

function paintModes(d) {
  if (!ui.modesBlock) return;
  var isN = d.id === 'nback';
  ui.modesBlock.hidden = !isN;
  if (!isN) return;
  var Engine = globalThis.Engine;
  var plan = planOf(ctxRef);
  var proOnly = (Engine && Engine.PRO_ONLY_MODES) || [];
  var MODES = (globalThis.Content && globalThis.Content.MODES) || [];
  MODES.forEach(function (m) {
    var b = ui.modeBtns && ui.modeBtns[m.id];
    if (!b) return;
    var locked = Engine && typeof Engine.canAccessMode === 'function' && !Engine.canAccessMode('nback', m.id, plan);
    /* A locked mode stays visible and pressable so the Pro tag can do its job.
       Hiding it would leave a Free user unable to tell it exists. */
    b.setAttribute('aria-pressed', m.id === mode ? 'true' : 'false');
    /* A running set already committed to one mode, so the picker is disabled for
       the life of the set. The blurb below says why. */
    b.disabled = running;
    var tagEl = b.querySelector('.tr-pro');
    if (tagEl) tagEl.hidden = proOnly.indexOf(m.id) === -1;
    b.setAttribute('aria-label', locked ? m.name + ', Pro mode' : m.name);
  });
  var cur = null;
  MODES.forEach(function (m) { if (m.id === mode) cur = m; });
  if (ui.modeBlurb) {
    ui.modeBlurb.textContent = running
      ? 'Mode is locked while a set runs. It unlocks when the set ends.'
      : (cur ? cur.blurb : '');
  }
}

function paintSeed(d) {
  if (!ui.seedRow) return;
  var seeded = !!SEEDED[d.id];
  ui.seedRow.hidden = !seeded;
  if (!seeded) return;
  ui.seedVal.textContent = seed || '--------';
  if (ui.seedBtn) ui.seedBtn.disabled = running;
  ui.seedNote.textContent = running
    ? 'Seed is locked while a set runs. It unlocks when the set ends.'
    : 'Same seed, same trial sequence. Change it to draw a new one.';
}

function paintAll() {
  var Store = globalThis.Store;
  var Engine = globalThis.Engine;
  var d = drillById(currentDrill);
  if (ui.drillName) ui.drillName.textContent = d.name;
  if (ui.drillIcon) ui.drillIcon.innerHTML = d.icon || '';
  if (ui.drillTag) {
    ui.drillTag.textContent = d.pro ? 'Pro' : 'Free';
    ui.drillTag.className = 'mono cap' + (d.pro ? ' tag-pro' : '');
  }
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
  var st = Store.streak(state);
  setNum(ui.sStreak, st, st === 1 ? ' day' : ' days');
  setNum(ui.sLevel, Store.level(state));

  if (ui.progBtns) {
    var plan = planOf(ctxRef);
    Object.keys(ui.progBtns).forEach(function (id) {
      var b = ui.progBtns[id];
      var locked = Engine && typeof Engine.canAccess === 'function' && !Engine.canAccess(id, plan);
      var tagEl = b.querySelector('.tr-prog-tag');
      if (tagEl) {
        tagEl.textContent = locked ? 'Pro' : 'Free';
        tagEl.className = 'tr-prog-tag' + (locked ? ' locked' : '');
      }
      b.setAttribute('aria-current', id === currentDrill ? 'true' : 'false');
    });
  }

  paintModes(d);
  paintSeed(d);
  paintToday();
  paintWeek(ui.weekMini);
}

function runDrills(ids, interleave) {
  var Engine = globalThis.Engine;
  var plan = planOf(ctxRef);
  var allowed = (ids || []).filter(function (id) { return Engine.canAccess(id, plan); });
  if (!allowed.length) { if (ctxRef.navigate) ctxRef.navigate('pricing'); return; }
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
  /* The set is live. Mode and seed lock here and stay locked until finishSession
     unlocks them, so the running drill keeps the stream it started with. */
  var firstOfSet = !running;
  running = true;
  setIdle(false);
  if (ui.startBtn) { ui.startBtn.disabled = false; ui.startBtn.textContent = 'Restart'; }
  hidePR();
  paintAll();
  if (firstOfSet && (currentDrill === 'nback' || SEEDED[currentDrill])) {
    say('Mode and seed lock while a set runs.');
  }
  var Drills = globalThis.Drills;
  handle = Drills.start(currentDrill, ui.mount, {
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
  /* The set is over, so the mode picker and seed control come back. */
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

export function render(container, ctx) {
  if (handle && handle.stop) handle.stop();
  handle = null;
  pending = [];
  sessionDrills = [];
  running = false;
  hidePR();
  ctxRef = ctx;
  mode = readMode(planOf(ctx));
  seed = readSeed();
  writeSeed(seed);
  /* The shared centered column. Train carries a drill panel, a session card and
     the nine program cards, so it takes the wide one rather than the 780 column. */
  container.classList.add('view', 'view-mid-wide', 'tr-view');
  container.setAttribute('aria-label', 'Train');
  buildDOM(container);

  var sel = takeSelect();
  if (sel && globalThis.Content && globalThis.Content.DRILLS) currentDrill = sel;
  data = readCache() || { runs: [], sessions: [], cards: [] };
  state = toState(data, planOf(ctx));
  paintAll();

  var seq = writeSeq;
  if (ctx.db && ctx.db.loadUserData) {
    ctx.db.loadUserData().then(function (res) {
      if (!container.isConnected || writeSeq !== seq) return;
      if (res && res.ok && res.data) {
        data = res.data;
        state = toState(data, planOf(ctx));
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
