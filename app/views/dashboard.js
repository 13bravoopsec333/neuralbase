/* Neuralbase v2 dashboard view.
   render(container, ctx) builds a command page: a left aligned head, a hero card
   that carries the goal ring and the one action, a column of readings beside it,
   the set of drills for today, the 14 day picture, and the daily board line.

   ctx = { user, profile, db, api, audio, themes, motion, navigate }

   This module also exports the pure helpers the Progress view reuses, so the two
   views share one normalizer instead of two copies. It never paints on import.
   All text is set with textContent, never innerHTML, apart from the drill mark SVG
   that Content ships. Reduced motion is honored through ctx.motion.reduced(). */

var STORE_KEY = 'cortex.store';
var QUEUE_KEY = 'cortex.train.queue';
var DAY = 86400000;
var PLAN_SIZE = 3;
var WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ---------------- tiny DOM helpers ---------------- */

export function h(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
}

export function drillRegistry() {
  var map = {};
  var list = (typeof globalThis !== 'undefined' && globalThis.Content && globalThis.Content.DRILLS) || null;
  if (list) {
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      map[d.id] = {
        id: d.id,
        name: d.name || d.id,
        unit: d.unit || '',
        direction: d.direction === 'lower' ? 'lower' : 'higher',
        icon: d.icon || '',
        trains: d.trains || ''
      };
    }
  }
  return map;
}

export function metaFor(reg, id) {
  return reg[id] || { id: id, name: id || 'Run', unit: '', direction: 'higher', icon: '', trains: '' };
}

/* The direction table Store wants, taken from Content so both agree. */
export function dirMap(reg) {
  var src = reg || drillRegistry();
  var out = {};
  var ids = Object.keys(src);
  for (var i = 0; i < ids.length; i++) out[ids[i]] = src[ids[i]].direction;
  return out;
}

/* The drill's mark, drawn in currentColor. Markup is our own static SVG string. */
export function iconEl(markup) {
  var s = h("span", "drill-ic");
  s.setAttribute('aria-hidden', 'true');
  if (markup) s.innerHTML = markup;
  return s;
}

/* ---------------- date helpers (local days, not UTC) ---------------- */

export function localDate(ms) {
  var d = ms == null ? new Date() : new Date(ms);
  if (isNaN(d.getTime())) d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function dayKeyOf(item) {
  if (!item) return localDate(Date.now());
  if (item.local_date) return item.local_date;
  var ms = item.created_at != null ? item.created_at : item.t;
  return localDate(ms == null ? Date.now() : ms);
}

export function msOf(item) {
  if (!item) return Date.now();
  var x = item.created_at != null ? item.created_at : item.t;
  if (x == null) return Date.now();
  if (typeof x === 'number') return x;
  var p = Date.parse(x);
  return isNaN(p) ? Date.now() : p;
}

export function relative(ms, now) {
  var s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return "just now";
  var m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  var hh = Math.floor(m / 60);
  if (hh < 24) return hh + "h ago";
  var dd = Math.floor(hh / 24);
  return dd + "d ago";
}

export function dateLabel(ms) {
  var d = new Date(ms);
  if (isNaN(d.getTime())) return "";
  return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
}

/* Relative while the moment is fresh, a plain date once it is history. */
export function whenLabel(ms, now) {
  var diff = Math.max(0, now - ms);
  if (diff < DAY) return relative(ms, now);
  if (diff < 7 * DAY) return Math.max(1, Math.floor(diff / DAY)) + "d ago";
  return dateLabel(ms);
}

/* Days since the epoch, anchored to local midnight so a plan is stable all day. */
export function dayIndexOf(now) {
  var d = new Date(now == null ? Date.now() : now);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - Date.UTC(1970, 0, 1)) / DAY);
}

/* ---------------- persisted store bits ---------------- */

/* Onboarding owns writing the Store state. The dashboard only reads the fields it
   needs, so an absent or partial blob degrades to blank instead of throwing. */
export function readStore() {
  try {
    var raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

/* Read, patch, write in one synchronous pass so a concurrent writer's keys survive. */
export function patchStore(patch) {
  try {
    var cur = readStore();
    var base = (cur && typeof cur === "object") ? cur : {};
    var keys = Object.keys(patch);
    for (var i = 0; i < keys.length; i++) base[keys[i]] = patch[keys[i]];
    localStorage.setItem(STORE_KEY, JSON.stringify(base));
    return base;
  } catch (e) { return null; }
}

/* ---------------- normalizers ---------------- */

export function normRun(r) {
  return {
    drillId: r.drill_id || r.drillId,
    value: Number(r.value),
    unit: r.unit || "",
    t: typeof r.t === "number" ? r.t : (Date.parse(r.created_at || "") || 0),
    meta: r.meta || null
  };
}

export function normSession(s) {
  return {
    t: typeof s.t === "number" ? s.t : (Date.parse(s.created_at || "") || 0),
    drills: (s.drills || []).slice()
  };
}

/* Cloud rows to a Store-shaped state. The persisted store blob supplies goal,
   rest days, freezes and the given tally; everything measured comes from the runs
   and sessions themselves, so the view never trusts a cached counter. */
export function toState(data, profile, stored) {
  var S = globalThis.Store;
  var s = (S && typeof S.blank === "function") ? S.blank() : {
    records: [], sessions: [], days: [], restDays: [], freezeDays: [],
    streakFreezes: 0, freezeMilestone: 0, kudosGiven: [], plan: "free", goal: "fresh"
  };
  var src = (stored && typeof stored === "object") ? stored : {};

  var records = ((data && data.runs) || []).map(normRun).filter(function (r) {
    return r.drillId && isFinite(r.value) && r.t > 0;
  });
  records.sort(function (a, b) { return a.t - b.t; });
  var sessions = ((data && data.sessions) || []).map(normSession)
    .filter(function (x) { return x.t > 0; })
    .sort(function (a, b) { return a.t - b.t; });

  var days = [], seen = {};
  for (var i = 0; i < sessions.length; i++) {
    var k = localDate(sessions[i].t);
    if (!seen[k]) { seen[k] = 1; days.push(k); }
  }

  s.records = records;
  s.sessions = sessions;
  s.days = days;
  s.plan = (profile && profile.plan === "pro") ? "pro" : "free";

  if (Array.isArray(src.restDays)) s.restDays = src.restDays;
  if (Array.isArray(src.freezeDays)) s.freezeDays = src.freezeDays;
  if (typeof src.streakFreezes === "number") s.streakFreezes = src.streakFreezes;
  if (typeof src.freezeMilestone === "number") s.freezeMilestone = src.freezeMilestone;
  if (Array.isArray(src.kudosGiven)) s.kudosGiven = src.kudosGiven;
  /* The profile is where the goal picker writes it, so it wins. The stored blob
     is only a fallback for a profile that predates the goal column: nothing
     writes goal there, so reading it first would let a stale copy shadow the
     value the user just picked and the plan would never move. */
  var goal = (profile && (profile.goal || profile.training_goal)) || src.goal;
  if (goal && goal !== s.goal) s.goal = goal;

  return s;
}

export function mostPlayed(runs) {
  var counts = {}, last = {}, best = null;
  for (var i = 0; i < runs.length; i++) {
    var id = runs[i].drill_id || runs[i].drillId;
    if (!id) continue;
    counts[id] = (counts[id] || 0) + 1;
    var t = msOf(runs[i]);
    if (!last[id] || t > last[id]) last[id] = t;
    if (best === null || counts[id] > counts[best] || (counts[id] === counts[best] && last[id] > last[best])) best = id;
  }
  return best;
}

/* ---------------- scoped styles (theme tokens only) ---------------- */

function injectStyles() {
  if (typeof document === "undefined" || document.getElementById("cortex-dash-styles")) return;
  var s = document.createElement("style");
  s.id = "cortex-dash-styles";
  s.textContent = [
    /* The page is a left aligned column with a fixed measure, so the head has a
       spine and the bands below share one width instead of drifting center. */
    ".dash{display:flex;flex-direction:column;gap:var(--gap-4);max-width:980px;margin-inline:auto}",
    ".dash-head{display:flex;flex-direction:column;gap:3px}",
    ".dash-eyebrow{font-family:var(--mono);font-size:10px;letter-spacing:.11em;text-transform:uppercase;color:var(--dim)}",
    ".dash-title{margin:0;font-size:24px;font-weight:600;letter-spacing:-.02em}",
    /* Two bands: the command on the left, the readings on the right. */
    ".dash-main{display:grid;grid-template-columns:minmax(0,1.12fr) minmax(0,1fr);gap:var(--gap-4);align-items:stretch}",
    ".dash-hero{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px 22px}",
    ".dash-panel-goal{display:flex;flex-direction:column;align-items:center;gap:11px}",
    ".dash-ring{position:relative;width:150px;height:150px;flex:none}",
    ".dash-ring svg{width:100%;height:100%;display:block}",
    ".dash-ring-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}",
    ".dash-ring-num{--nb-readout:46px}",
    
    ".dash-over{position:absolute;top:-2px;right:-2px;font-family:var(--mono);font-size:10px;color:var(--accent);background:var(--panel);border:1px solid var(--accent-edge);border-radius:999px;padding:1px 6px}",
    ".dash-goal-say{margin:0;font-size:16px;font-weight:600;line-height:1.4;color:var(--ink);text-align:center;max-width:32ch}",
    ".dash-goal-cap{margin:0;font-size:12px;line-height:1.45;color:var(--dim);text-align:center;max-width:40ch}",
    ".dash-start{display:inline-flex;align-items:center;justify-content:center;min-width:230px;padding:12px 20px;font-size:14px}",
    /* Record moment: one precise line, no celebration furniture. */
    ".dash-pr2{display:flex;gap:8px;align-items:baseline;justify-content:center;flex-wrap:wrap;width:100%;padding-top:12px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}",
    ".dash-pr2 b{font-weight:600;color:var(--ink)}",
    ".dash-pr2-v{font-family:var(--mono);font-size:16px;color:var(--ink);font-variant-numeric:tabular-nums}",
    ".dash-pr2-when{font-family:var(--mono);font-size:10px;color:var(--dim);letter-spacing:.05em}",
    /* Readings: three rows, the value right aligned, a rule between them. */
    /* The readings column stretches to the hero's height and spreads its rows over
       it, so the two cards share one block instead of leaving a hole under the
       shorter one. The rows carry their own rules, so spreading them reads as a
       list with room in it, not as gaps. The wrapper and the card both have to
       be flex for that: the grid stretches .dash-readings, and the card has to
       fill what it is given. */
    ".dash-readings{display:flex;flex-direction:column}",
    ".dash-stats{display:flex;flex-direction:column;flex:1 1 auto}",
    ".dash-stats-list{flex:1 1 auto;justify-content:space-evenly}",
    ".dash-stats-list{display:flex;flex-direction:column}",
    ".dash-stat{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 0;border-bottom:1px solid var(--line)}",
    ".dash-stats-list .dash-stat:last-child{border-bottom:0}",
    ".dash-stat-txt{display:flex;flex-direction:column;gap:2px;min-width:0}",
    ".dash-stat-l{display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim)}",
    ".dash-stat-c{font-size:12px;color:var(--dim)}",
    ".dash-stat-v{font-family:var(--mono);font-size:28px;font-weight:500;line-height:1;letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--ink);flex:none}",
    ".dash-notes{margin:12px 0 0;display:flex;flex-direction:column;gap:8px;padding-top:12px;border-top:1px solid var(--line)}",
    ".dash-note{margin:0;font-size:13px;color:var(--muted);line-height:1.5}",
    ".dash-note b{font-weight:600;color:var(--ink)}",
    ".dash-freeze{display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
    ".dash-freeze-num{--nb-readout:22px;color:var(--accent)}",
    ".dash-freeze-btn{background:none;border:1px solid var(--line2);color:var(--ink);padding:7px 13px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;transition:border-color .15s ease,color .15s ease}",
    ".dash-freeze-btn:hover{border-color:var(--accent-edge);color:var(--accent)}",
    /* The set. Three tiles in a row, so the middle drill sits in the middle. */
    ".dash-plan-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--gap-3)}",
    ".dash-tile{display:flex;align-items:center;gap:11px;min-width:0;background:var(--panel2);border:1px solid var(--line);border-radius:var(--r);padding:12px}",
    ".dash-tile.done{opacity:.62}",
    ".dash-tile-txt{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}",
    ".dash-tile-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".dash-tile-trains{font-size:12px;color:var(--muted);line-height:1.35}",
    ".dash-tile-done{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);border:1px solid var(--accent-edge);background:var(--accent-soft);border-radius:999px;padding:2px 7px;flex:none}",
    /* The 14 day picture: thin bars, not blocks. */
    ".dash-spark .chart-col{height:72px}",
    ".dash-spark .chart-barwrap{justify-content:center}",
    ".dash-spark .chart-bar{max-width:22px;border-radius:5px}",
    ".dash-spark .chart-col.today .chart-bar{box-shadow:inset 0 0 0 1px var(--accent-edge)}",
    /* An empty card is a strip, not a box: heading and one line share a row. */
    ".dash-strip{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;padding:12px 14px}",
    ".dash-strip .card-head{margin:0;flex:none}",
    /* Daily board: one quiet row under the chart. */
    ".dash-board{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;font-size:13px;color:var(--muted)}",
    ".dash-board-link{background:none;border:0;padding:7px 0;color:var(--accent);font-size:13px;font-weight:600;cursor:pointer}",
    ".dash-board-link:hover{text-decoration:underline}",
    ".dash-board-rank{font-family:var(--mono);font-size:13px;color:var(--ink);font-variant-numeric:tabular-nums}",
    ".dash-board-rank.top{color:var(--accent)}",
    ".dash-board-rank.none{font-family:var(--sans);color:var(--dim)}",
    ".dash-board-note{color:var(--dim)}",
    "@media(max-width:820px){.dash-main{grid-template-columns:minmax(0,1fr)}.dash-plan-grid{grid-template-columns:minmax(0,1fr)}.dash-ring{width:132px;height:132px}.dash-ring-num{--nb-readout:40px}}",
    "@media(max-width:560px){.dash-hero{padding:18px 14px}.dash-stat-v{font-size:24px}.dash-start{min-width:0;width:100%}}"
  ].join("");
  document.head.appendChild(s);
}

/* ---------------- the goal ring ---------------- */

function animateRing(circle, circumference, frac, reduced) {
  var target = circumference * (1 - frac);
  circle.style.strokeDasharray = String(circumference);
  circle.style.strokeDashoffset = String(target);
  if (reduced || !circle.animate) return;
  try {
    circle.animate(
      [{ strokeDashoffset: circumference }, { strokeDashoffset: target }],
      { duration: 700, easing: "cubic-bezier(.3,.9,.3,1)", fill: "backwards" }
    );
  } catch (e) { /* final state already set */ }
}

/* The ring block. The ring is the one loud element; the plain sentence under it
   says in words what the ring counts, so nobody has to decode a ratio. The ring
   is the live region: the count-up is decorative, so the announced text is
   settled once in that same plain sentence rather than on every animation frame. */
function buildGoalBlock(ctx, n, goal, reduced, isNew) {
  var block = h("div", "dash-panel-goal");
  var R = 60, C = 2 * Math.PI * R;
  var wrap = h("div", "dash-ring");
  var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 132 132");
  svg.setAttribute("aria-hidden", "true");

  function ring(className) {
    var c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", "66"); c.setAttribute("cy", "66"); c.setAttribute("r", String(R));
    c.setAttribute("fill", "none"); c.setAttribute("stroke-width", "6");
    c.setAttribute("stroke-linecap", "round");
    c.setAttribute("transform", "rotate(-90 66 66)");
    c.setAttribute("class", className);
    return c;
  }

  var track = ring("dash-track");
  track.style.stroke = "var(--panel2)";
  var arc = ring("dash-arc");
  arc.style.stroke = "var(--accent)";
  svg.appendChild(track); svg.appendChild(arc);
  wrap.appendChild(svg);

  var center = h("div", "dash-ring-center");
  var num = h("span", "nb-readout dash-ring-num");
  num.setAttribute("aria-hidden", "true");
  center.appendChild(num);
  /* Nothing else goes inside the ring. A label here ("of 3 sessions today") measured
     129px wide inside a 130px hole, so its text touched the stroke at both sides. It
     was also saying nothing the sentence below the ring does not already say in
     better words, so it is gone rather than shrunk. */

  /* The plain sentence. It names what is done and what is left, in the words a
     person would use, so the state of today needs no decoding. */
  var left = Math.max(0, goal - n);
  var sentence;
  if (isNew) {
    sentence = "Nothing done yet. Start your first session below.";
  } else if (n >= goal) {
    sentence = "Goal met. " + n + (n === 1 ? " session" : " sessions") + " done today" +
      (n > goal ? ", " + (n - goal) + " past your goal." : ".");
  } else {
    sentence = n + (n === 1 ? " session" : " sessions") + " done, " + left + " to go today.";
  }
  var say = h("span", "sr", sentence);
  say.setAttribute("aria-live", "polite");
  say.setAttribute("role", "status");
  center.appendChild(say);
  wrap.appendChild(center);
  if (n > goal) {
    var over = h("span", "dash-over", "+" + (n - goal));
    over.setAttribute("aria-hidden", "true");
    over.title = (n - goal) + (n - goal === 1 ? " session" : " sessions") + " past today's goal";
    wrap.appendChild(over);
  }
  block.appendChild(wrap);

  var frac = n <= 0 ? 0.04 : Math.min(1, n / goal);
  if (n <= 0) arc.style.opacity = "0.5";
  animateRing(arc, C, frac, reduced);

  if (ctx.motion && typeof ctx.motion.countUp === "function") {
    ctx.motion.countUp(num, n, { duration: 400 });
  } else {
    num.textContent = String(n);
  }

  block.appendChild(h("p", "dash-goal-say", sentence));
  /* One short line, once, so "session" is never a word the owner has to guess. */
  block.appendChild(h("p", "dash-goal-cap", "A session is one run through your daily drills."));
  return block;
}

/* The hero card: the ring, one line, the record moment when there is one, and one
   button. Nothing else competes for the first look. */
function buildHero(ctx, reg, state, ids, left, sessionsToday, goal, reduced, isNew) {
  var card = h("div", "card dash-hero");
  card.appendChild(buildGoalBlock(ctx, sessionsToday.length, goal, reduced, isNew));

  var recLine = buildRecord(reg, state, Date.now());
  if (recLine) card.appendChild(recLine);

  var nLeft = left.length;
  var start = h("button", "btn-primary dash-start",
    nLeft === 1 ? "Start today's last drill"
      : nLeft ? "Start today's " + nLeft + " drills"
              : "Run today's plan again");
  start.type = "button";
  /* The whole plan goes to Train as one queue, the same key Circuit writes, so
     the plan runs end to end in order instead of landing on a single drill.
     Work already done today is dropped, so a restart finishes rather than
     repeats. A plan with nothing left still queues, which is what the label
     says it does. */
  start.addEventListener("click", function () {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify({ ids: nLeft ? left : ids, interleave: false }));
    } catch (e) { /* degrade to Train's own picker */ }
    go(ctx, "train");
  });
  card.appendChild(start);
  return card;
}

/* ---------------- today's plan ---------------- */

function accessibleIds(plan) {
  var list = (typeof globalThis !== 'undefined' && globalThis.Content && globalThis.Content.DRILLS) || [];
  var ids = [];
  for (var i = 0; i < list.length; i++) ids.push(list[i].id);
  return ids;
}

/* One line on why these three. It names the rule, not a promise. */
function planIds(state, reg) {
  var S = globalThis.Store;
  var pool = accessibleIds(state.plan);
  if (!S || typeof S.dailyPlan !== "function") return pool.slice(0, PLAN_SIZE);
  try {
    var ids = S.dailyPlan(state, dayIndexOf(Date.now()), pool, PLAN_SIZE);
    if (ids && ids.length) return ids;
  } catch (e) { /* fall through to the registry order */ }
  var fallback = [];
  for (var i = 0; i < pool.length && fallback.length < PLAN_SIZE; i++) fallback.push(pool[i]);
  return fallback;
}

/* The owner wants Speed of Processing to sit in the middle of the set, so when it
   is in the plan it takes the center slot and the others move around it. The queue
   uses this same order, so the tiles show what will actually run. */
var MIDDLE_DRILL = "ufov";
export function orderPlan(ids) {
  var list = (ids || []).slice();
  var i = list.indexOf(MIDDLE_DRILL);
  if (i === -1) return list;
  list.splice(i, 1);
  list.splice(Math.floor(list.length / 2), 0, MIDDLE_DRILL);
  return list;
}

/* The set the button will run, shown as tiles. Each tile names the drill and what
   it trains, and the one already done today is dimmed. */
function buildPlanCard(reg, ids, done) {
  var card = h("div", "card dash-plan");
  var head = h("div", "card-head");
  head.appendChild(h("h3", null, "Today's set"));
  var n = ids.length;
  head.appendChild(h("span", "cap", n + (n === 1 ? " drill" : " drills") + ", in order"));
  card.appendChild(head);

  var grid = h("div", "dash-plan-grid");
  for (var i = 0; i < ids.length; i++) {
    var m = metaFor(reg, ids[i]);
    var isDone = !!done[ids[i]];
    var tile = h("div", "dash-tile" + (isDone ? " done" : ""));
    tile.appendChild(iconEl(m.icon));
    var txt = h("div", "dash-tile-txt");
    txt.appendChild(h("span", "dash-tile-name", m.name));
    txt.appendChild(h("span", "dash-tile-trains", m.trains));
    tile.appendChild(txt);
    if (isDone) tile.appendChild(h("span", "dash-tile-done", "Done"));
    grid.appendChild(tile);
  }
  card.appendChild(grid);
  return card;
}

/* ---------------- readings ---------------- */

function statRow(label, cap, ctx, opts) {
  opts = opts || {};
  var row = h("div", "dash-stat");
  var txt = h("div", "dash-stat-txt");
  var l = h("span", "dash-stat-l");
  /* The hollow tick means the run is still open. It never warns, never counts
     down, and it is the only thing that changes when today is still untouched. */
  if (opts.tick) l.appendChild(h("span", "nb-tick dot"));
  l.appendChild(document.createTextNode(label));
  txt.appendChild(l);
  if (cap) txt.appendChild(h("span", "dash-stat-c", cap));
  row.appendChild(txt);
  var v = h("span", "dash-stat-v");
  if (opts.live) v.setAttribute("aria-live", "polite");
  row.appendChild(v);
  var suffix = opts.suffix || "";
  if (ctx.motion && typeof ctx.motion.countUp === "function") {
    ctx.motion.countUp(v, opts.value, { duration: 420, suffix: suffix });
  } else {
    v.textContent = String(opts.value) + suffix;
  }
  return row;
}

/* Spent or refused, said in words. The freeze reading carries aria-live, so the
   outcome lands there rather than in a second live region competing with it. */
var freezeLive = null;

function announceFreeze(text) {
  if (freezeLive) freezeLive.textContent = text;
}

/* The card beside the hero answers one question: am I keeping it up. Three
   readings, a plain note when today is still open, and the freeze control when a
   run is at stake. */
function buildReadings(ctx, state, hasHistory, now, onSpend) {
  var S = globalThis.Store;
  var card = h("div", "card dash-stats");
  var head = h("div", "card-head");
  head.appendChild(h("h3", null, "Your habit"));
  head.appendChild(h("span", "cap", "The last 30 days"));
  card.appendChild(head);

  var cur = S ? S.streak(state, now) : 0;
  var longest = S ? S.longestStreak(state) : 0;
  var cons = S ? S.consistency(state, 30) : { trained: 0, total: 30, rate: 0 };
  var atRisk = S ? S.streakAtRisk(state, now) : false;
  var freezes = Math.max(0, state.streakFreezes || 0);

  var list = h("div", "dash-stats-list");
  list.appendChild(statRow("Streak", cur === 1 ? "day so far" : "days so far", ctx, {
    value: cur, tick: atRisk, live: true
  }));
  /* Three readings answer the question the dashboard asks. Longest and all-time
     runs live in Progress, where the detail belongs. */
  list.appendChild(statRow("Longest", "days, best run", ctx, { value: longest }));
  /* The label and caption read together: "Trained 50% of the last 30 days." */
  list.appendChild(statRow("Trained", "of the last 30 days", ctx, {
    value: Math.round(cons.rate * 100), suffix: "%"
  }));
  card.appendChild(list);

  var notes = h("div", "dash-notes");
  if (atRisk) {
    notes.appendChild(h("p", "dash-note",
      "Your " + cur + " day run is still open. One set today keeps it."));
  } else if (cur === 0 && hasHistory) {
    notes.appendChild(h("p", "dash-note",
      "The count starts again today. Your longest run was " + longest + " days."));
  }

  /* A freeze only means something if it can be spent, so the at-risk case carries
     the control. It bridges one missed day, never adds a trained day, and it is
     gone once used. Spent from here, which is the only place the state lives. */
  var gap = S && typeof S.streakGapDay === "function" ? S.streakGapDay(state, now) : null;
  if (atRisk && freezes > 0 && gap && S && typeof S.applyFreeze === "function") {
    var row = h("div", "dash-freeze");
    /* The count rides with the control rather than taking a row of its own, and it
       is the live region a spend is announced into. */
    var live = h("span", "nb-readout dash-freeze-num", String(freezes));
    live.setAttribute("aria-live", "polite");
    freezeLive = live;
    row.appendChild(live);
    row.appendChild(h("span", "dash-note",
      freezes === 1 ? "freeze held. It bridges the missed day on " + gap +
        ". It never counts as a day trained, and it is gone once used."
        : "freezes held. One bridges the missed day on " + gap +
        ". None of them count as a day trained, and they are gone once used."));
    var b = h("button", "dash-freeze-btn", "Use a freeze");
    b.type = "button";
    b.setAttribute("aria-label", "Use a freeze on " + gap + " to keep the streak");
    b.addEventListener("click", function () {
      var before = state.streakFreezes;
      S.applyFreeze(state, gap, new Date(now));
      if (state.streakFreezes === before) {
        announceFreeze("That day cannot take a freeze.");
        return;
      }
      patchStore({
        streakFreezes: state.streakFreezes,
        freezeDays: state.freezeDays,
        freezeMilestone: state.freezeMilestone
      });
      if (typeof onSpend === "function") onSpend();
    });
    row.appendChild(b);
    notes.appendChild(row);
  }

  if (notes.firstChild) card.appendChild(notes);
  return card;
}

/* ---------------- record moment, once and precisely ---------------- */

/* The newest record inside this sitting. It is derived from data, so a re-render
   cannot fire it twice and there is no flag to keep. */
function buildRecord(reg, state, now) {
  var S = globalThis.Store;
  if (!S || typeof S.latestRecord !== "function") return null;
  var rec;
  try { rec = S.latestRecord(state, dirMap(reg)); } catch (e) { return null; }
  if (!rec || !rec.at) return null;
  if (now - rec.at > 4 * 3600000) return null;

  var m = metaFor(reg, rec.drillId);
  var unit = m.unit || "";
  var line = h("div", "dash-pr2");
  line.appendChild(h("span", null, "New best in "));
  line.appendChild(h("b", null, m.name + " "));
  line.appendChild(h("span", "dash-pr2-v", rec.best + (unit ? " " + unit : "")));
  /* Flex items drop a leading space visually, but the gap keeps them apart on
     screen and the space keeps a screen reader from running the words together. */
  line.appendChild(h("span", null,
    " " + (m.direction === "lower" ? "faster than" : "higher than") + " the " +
    rec.prev + (unit ? " " + unit : "") + " before it."));
  line.appendChild(h("span", "dash-pr2-when", " " + whenLabel(rec.at, now)));
  return line;
}

/* ---------------- 14-day sparkline ---------------- */

function sessionsPerDay(sessions, days) {
  var counts = {};
  for (var i = 0; i < sessions.length; i++) counts[dayKeyOf(sessions[i])] = (counts[dayKeyOf(sessions[i])] || 0) + 1;
  var out = [], now = new Date(); now.setHours(0, 0, 0, 0);
  for (var j = days - 1; j >= 0; j--) {
    var d = new Date(now.getTime() - j * DAY);
    out.push({ key: localDate(d.getTime()), n: counts[localDate(d.getTime())] || 0 });
  }
  return out;
}

function buildSpark(sessions) {
  var card = h("div", "card");
  var head = h("div", "card-head");
  head.appendChild(h("h3", null, "Last 14 days"));
  head.appendChild(h("span", "cap", "Sessions per day"));
  card.appendChild(head);

  /* Nothing to plot yet, so the card becomes a one-line strip instead of a full
     panel holding a flat, empty chart. */
  if (!sessions.length) {
    card.classList.add("dash-strip");
    card.appendChild(h("p", "dash-note", "Your first session fills this in."));
    return card;
  }

  var days = sessionsPerDay(sessions, 14);
  var max = 0;
  for (var i = 0; i < days.length; i++) if (days[i].n > max) max = days[i].n;

  var chart = h("div", "chart dash-spark");
  var plot = h("div", "chart-plot");
  for (var j = 0; j < days.length; j++) {
    var d = days[j];
    var isToday = j === days.length - 1;
    var isBest = max > 0 && d.n === max && d.n > 0;
    var col = h("div", "chart-col" + (d.n > 0 ? " has" : "") + (isBest ? " best" : "") + (isToday ? " today" : ""));
    col.title = d.key + ": " + d.n + (d.n === 1 ? " session" : " sessions");
    var barwrap = h("div", "chart-barwrap");
    var bar = h("div", "chart-bar");
    bar.style.transform = "scaleY(" + (d.n > 0 ? Math.max(0.15, d.n / max) : 0.06).toFixed(3) + ")";
    barwrap.appendChild(bar);
    col.appendChild(barwrap);
    var x = h("span", "chart-x");
    if (j === 0 || isToday) x.textContent = String(new Date(d.key + "T00:00:00").getDate());
    col.appendChild(x);
    plot.appendChild(col);
  }
  chart.appendChild(plot);
  card.appendChild(chart);
  return card;
}

/* ---------------- daily board, one line ---------------- */

/* Leaderboards have their own view, so the dashboard keeps only the one reading
   a person might want while deciding to train: where they stand today. One row,
   one link, no card. The rank still comes from the same api.myRank call. */
function buildBoard(ctx, reg, runs) {
  var row = h("div", "dash-board");

  var drillId = mostPlayed(runs);
  var open = h("button", "dash-board-link", "Daily board");
  open.type = "button";
  open.addEventListener("click", function () { go(ctx, "leaderboards"); });
  row.appendChild(open);

  if (!drillId) {
    row.appendChild(h("span", "dash-board-note", "no ranked runs yet"));
    return row;
  }

  var rank = h("span", "dash-board-rank", "...");
  row.appendChild(rank);
  row.appendChild(h("span", "dash-board-note", "in " + metaFor(reg, drillId).name));

  var fill = function (rankRow) {
    if (!rankRow || rankRow.rank == null) {
      rank.textContent = "unranked";
      rank.classList.add("none");
      return;
    }
    rank.classList.remove("none");
    rank.classList.toggle("top", rankRow.rank <= 10);
    rank.textContent = "#" + rankRow.rank;
  };

  if (ctx.api && typeof ctx.api.myRank === "function") {
    Promise.resolve(ctx.api.myRank(drillId, "daily")).then(function (res) {
      if (res && res.ok === false) { fill(null); return; }
      if (Array.isArray(res)) { fill(res.find(function (r) { return r.isMe; }) || null); return; }
      fill(res || null);
    }).catch(function () { fill(null); });
  } else {
    fill(null);
  }

  return row;
}

/* ---------------- navigation ---------------- */

function go(ctx, view) {
  if (ctx && typeof ctx.navigate === "function") ctx.navigate(view);
}

/* ---------------- render ---------------- */

/* Same local cache as the other views, so the panel paints from the last known
   data instead of sitting empty while the request is in flight. */
function readCache() {
  try {
    var raw = localStorage.getItem("cortex.cache.data");
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function paint(container, ctx, data) {
  var runs = Array.isArray(data && data.runs) ? data.runs : [];
  /* data is null on a cold first paint, before anything has been cached, so the
     profile has to come through the same guard as the runs. Reading data.profile
     unguarded threw on exactly that first visit. */
  var profile = ctx.profile || (data && data.profile) || {};
  var reg = drillRegistry();
  var now = Date.now();
  var today = localDate(now);
  var goal = Number(profile.daily_goal != null ? profile.daily_goal : profile.dailyGoal);
  if (!isFinite(goal) || goal < 1) goal = 3;

  var S = globalThis.Store;
  var state = toState(data, profile, readStore());
  var sessionsToday = state.sessions.filter(function (s) { return dayKeyOf(s) === today; });
  var runsToday = runs.filter(function (r) { return dayKeyOf(r) === today; });

  /* A freeze is earned at each seven day milestone and never bought. Earning here
     keeps the count true without a trip to Settings. */
  if (S && typeof S.earnFreeze === "function") {
    var before = state.streakFreezes;
    S.earnFreeze(state, S.streak(state, now));
    if (state.streakFreezes !== before) {
      patchStore({ streakFreezes: state.streakFreezes, freezeMilestone: state.freezeMilestone });
    }
  }

  var reduced = !!(ctx.motion && typeof ctx.motion.reduced === "function" && ctx.motion.reduced());

  var isNew = !state.records.length && !state.sessions.length;

  /* What today still owes, in the order the set will run. Speed of Processing takes
     the middle slot when it is in the plan. */
  var ids = orderPlan(planIds(state, reg));
  var done = {}, i, j;
  for (i = 0; i < runsToday.length; i++) {
    var id = runsToday[i].drill_id || runsToday[i].drillId;
    if (id) done[id] = 1;
  }
  for (i = 0; i < sessionsToday.length; i++) {
    var drills = sessionsToday[i].drills || [];
    for (j = 0; j < drills.length; j++) done[drills[j]] = 1;
  }
  var left = [];
  for (i = 0; i < ids.length; i++) if (!done[ids[i]]) left.push(ids[i]);

  /* One left aligned column. The head names the day, the hero is the one action,
     the readings sit beside it, then the set, the picture, and the board line. */
  var root = h("div", "dash");

  var head = h("div", "dash-head");
  var d = new Date(now);
  head.appendChild(h("span", "dash-eyebrow",
    WEEKDAYS[(d.getDay() + 6) % 7] + " " + d.getDate() + " " + MONTHS[d.getMonth()]));
  var title = h("h1", "view-title dash-title", "Today");
  title.tabIndex = -1;
  head.appendChild(title);
  root.appendChild(head);

  var main = h("div", "dash-main");
  main.appendChild(buildHero(ctx, reg, state, ids, left, sessionsToday, goal, reduced, isNew));

  /* Spending a freeze writes the store and mutates state, so only the readings are
     swapped, from the same state object. A full repaint would need the run rows,
     which paint() takes from the store rather than from this closure. */
  var readings = h("div", "dash-readings");
  function repaintReadings() {
    var next = buildReadings(ctx, state, !isNew, now, repaintReadings);
    while (readings.firstChild) readings.removeChild(readings.firstChild);
    readings.appendChild(next);
  }
  repaintReadings();
  main.appendChild(readings);
  root.appendChild(main);

  root.appendChild(buildPlanCard(reg, ids, done));
  root.appendChild(buildSpark(state.sessions));
  root.appendChild(buildBoard(ctx, reg, runs));

  container.textContent = "";
  container.appendChild(root);
}

export async function render(container, ctx) {
  ctx = ctx || {};
  if (!container) return;
  injectStyles();

  paint(container, ctx, readCache());

  if (ctx.db && typeof ctx.db.loadUserData === "function") {
    try {
      var res = await ctx.db.loadUserData();
      if (container.isConnected && res && res.ok && res.data) paint(container, ctx, res.data);
    } catch (e) { /* keep the cached paint */ }
  }
}
