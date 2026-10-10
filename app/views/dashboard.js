/* Neuralbase v2 dashboard view.
   render(container, ctx) builds the habit page: a thin header strip holding the
   streak, the goal ring and the next drill, then the month calendar as the hero,
   a slim per-drill consistency row, and the friends row.

   ctx = { user, profile, db, api, audio, themes, motion, navigate }

   This module also exports the pure helpers the Progress and Profile views reuse,
   so the views share one normalizer instead of two copies. It never paints on
   import. All text is set with textContent, never innerHTML, apart from the drill
   mark SVG that Content ships (and the chevrons built with createElementNS here).
   Reduced motion is honored through ctx.motion.reduced(). */

import { buildFriendsPanel } from '../ui/friends.js';

var STORE_KEY = 'cortex.store';
var QUEUE_KEY = 'cortex.train.queue';
var DAY = 86400000;
var PLAN_SIZE = 3;
var WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var CAL_HEADS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
var DRILL_WINDOW = 30;

/* Compact labels for the nine drills in the consistency row. The full name rides
   in the title attribute, so the row stays one line wide without inventing names. */
var SHORT_NAME = {
  nback: 'N-Back', ufov: 'Processing', palace: 'Palace', reasoning: 'Reasoning',
  spaced: 'Retrieval', switching: 'Switching', sart: 'Signal', crt: 'Reaction', math: 'Arithmetic'
};

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

/* A chevron built node by node, so the rule about innerHTML stays true. */
function chevron(dir) {
  var NS = "http://www.w3.org/2000/svg";
  var svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  var p = document.createElementNS(NS, "path");
  p.setAttribute("d", dir === "prev" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6");
  svg.appendChild(p);
  return svg;
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
    /* One column, one gap. The calendar stretches to take the room the shell
       leaves, so a wide screen is a filled page and not a short stack. */
    ".dash{display:flex;flex-direction:column;gap:var(--gap-2);max-width:1080px;margin-inline:auto;flex:1 1 auto;min-width:0}",

    /* ---- header strip: streak, goal, next ---- */
    ".dash-strip{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1.5fr);gap:var(--gap-3);min-width:0}",
    ".hs{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:11px 14px;display:flex;align-items:center;gap:14px;min-width:0}",
    ".hs-label{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim)}",
    ".hs-streak{flex-direction:column;align-items:stretch;gap:8px}",
    ".hs-row{display:flex;align-items:flex-end;gap:14px;min-width:0}",
    ".hs-stat{display:flex;flex-direction:column;gap:2px;flex:none}",
    ".streak-n{font-family:var(--mono);font-size:34px;font-weight:500;letter-spacing:-.03em;line-height:.95;font-variant-numeric:tabular-nums}",
    ".streak-unit{font-size:12px;color:var(--muted)}",
    ".spark{display:flex;align-items:flex-end;gap:2px;height:30px;flex:1;min-width:0}",
    ".spark i{flex:1;min-height:3px;background:var(--bar);border-radius:2px}",
    ".spark i.on{background:var(--lime)}",
    ".spark i.now{background:var(--warn)}",

    /* The ring block the goal builder draws. The ring is the loud element; the
       plain sentence under it says in words what the ring counts. */
    ".dash-panel-goal{display:flex;flex-direction:column;align-items:center;gap:11px}",
    ".dash-ring{position:relative;width:150px;height:150px;flex:none}",
    ".dash-ring svg{width:100%;height:100%;display:block}",
    ".dash-ring-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}",
    ".dash-ring-num{--nb-readout:46px}",
    ".dash-over{position:absolute;top:-2px;right:-2px;font-family:var(--mono);font-size:10px;color:var(--accent);background:var(--panel);border:1px solid var(--accent-edge);border-radius:999px;padding:1px 6px}",
    ".dash-goal-say{margin:0;font-size:16px;font-weight:600;line-height:1.4;color:var(--ink);text-align:center;max-width:32ch}",
    ".dash-goal-cap{margin:0;font-size:12px;line-height:1.45;color:var(--dim);text-align:center;max-width:40ch}",

    /* The same block, compacted for the strip: ring left, sentence right. */
    ".hs-goal{justify-content:center}",
    ".dash-panel-goal-sm{flex-direction:row;align-items:center;gap:12px;width:100%}",
    ".dash-panel-goal-sm .dash-ring{width:54px;height:54px}",
    ".dash-panel-goal-sm .dash-ring-num{--nb-readout:15px}",
    ".dash-panel-goal-sm .dash-goal-say{font-size:13px;text-align:left;max-width:none}",
    ".dash-panel-goal-sm .dash-goal-cap{display:none}",

    ".hs-next{gap:12px}",
    ".hs-copy{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}",
    ".hs-next-name{font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".hs-next-trains{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".dash-start{flex:none}",

    /* Freeze control rides under the streak, only when a run is at stake. */
    ".hs-freeze{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:8px}",
    ".dash-freeze-num{--nb-readout:20px;color:var(--accent)}",
    ".dash-freeze-btn{background:none;border:1px solid var(--line2);color:var(--ink);padding:7px 13px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;transition:border-color .15s ease,color .15s ease}",
    ".dash-freeze-btn:hover{border-color:var(--accent-edge);color:var(--accent)}",
    ".dash-note{margin:0;font-size:12px;color:var(--muted);line-height:1.45}",
    ".dash-note b{font-weight:600;color:var(--ink)}",

    /* ---- calendar hero ---- */
    ".dash-cal{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:14px var(--gap-4) var(--gap-3);display:flex;flex-direction:column;gap:10px;flex:1 1 auto;min-height:300px;min-width:0}",
    ".cal-top{display:flex;align-items:center;gap:12px;flex-wrap:wrap}",
    ".cal-month{margin:0;font-size:21px;font-weight:600;letter-spacing:-.015em}",
    ".cal-sub{font-family:var(--mono);font-size:12px;color:var(--muted);letter-spacing:.02em}",
    ".cal-tools{margin-left:auto;display:flex;align-items:center;gap:8px}",
    ".cal-icon{width:32px;height:32px;flex:none;border-radius:8px;border:1px solid var(--line2);background:transparent;color:var(--muted);display:grid;place-items:center;transition:border-color .15s ease,color .15s ease}",
    ".cal-icon:hover{border-color:var(--lime-edge);color:var(--lime)}",
    ".cal-icon svg{width:15px;height:15px;display:block}",
    ".cal-today{padding:6px 11px;font-size:12px}",

    ".cal-wd{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:var(--gap-2)}",
    ".cal-wd span{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);padding-left:3px}",
    ".cal-wd span.we{color:var(--line2)}",

    ".cal-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));grid-auto-rows:1fr;gap:var(--gap-2);flex:1 1 auto;min-height:0}",
    ".cal-cell{position:relative;border:1px solid var(--line);border-radius:8px;background:var(--panel2);padding:5px 9px;display:flex;flex-direction:column;gap:5px;min-width:0;overflow:hidden;transition:border-color .15s ease,background .15s ease}",
    ".cal-cell-top{display:flex;align-items:baseline;justify-content:space-between;gap:6px}",
    ".cal-d{font-family:var(--mono);font-size:12px;color:var(--muted);line-height:1}",
    ".cal-n{font-family:var(--mono);font-size:13px;font-weight:500;color:var(--ink);line-height:1;font-variant-numeric:tabular-nums}",
    ".cal-pips{display:flex;gap:3px;margin-top:auto}",
    ".cal-pips i{flex:1;height:6px;border-radius:2px;background:var(--line2)}",
    ".cal-pips i.on{background:var(--lime)}",
    ".cal-cell-wd,.cal-cell-st{display:none}",
    ".cal-cell.met{background:var(--lime-soft);border-color:var(--lime-edge)}",
    ".cal-cell.met .cal-d{color:var(--ink)}",
    ".cal-cell.adj{opacity:.45}",
    ".cal-cell.today{border-color:var(--lime);background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--warn) 14%,transparent) 0 6px,transparent 6px 12px),var(--panel2);box-shadow:inset 0 0 0 1px var(--lime-edge)}",
    ".cal-cell.today .cal-d,.cal-cell.today .cal-n{color:var(--ink)}",
    ".cal-flag{display:none}",
    ".cal-cell.today .cal-flag{display:block;position:absolute;right:7px;bottom:6px;font-family:var(--mono);font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--warn)}",

    ".cal-foot{display:flex;align-items:center;gap:var(--gap-4);flex-wrap:wrap;border-top:1px solid var(--line);padding-top:10px}",
    ".cal-legend{display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--muted)}",
    ".cal-k{display:inline-flex;align-items:center;gap:6px}",
    ".cal-sw{width:14px;height:14px;border-radius:4px;flex:none;border:1px solid var(--line)}",
    ".cal-sw.met{background:var(--lime-soft);border-color:var(--lime-edge)}",
    ".cal-sw.today{background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--warn) 30%,transparent) 0 4px,transparent 4px 8px);border-color:var(--lime)}",
    ".cal-sw.up{background:var(--panel2)}",
    ".cal-sum{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--muted);letter-spacing:.02em;text-align:right}",
    ".cal-sum b{color:var(--ink);font-weight:500}",

    /* ---- slim rows: per-drill consistency and friends ---- */
    ".dash-drills,.dash-friends{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:11px 14px;min-width:0}",
    ".dash-row-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:10px}",
    ".dash-row-head h3{margin:0;font-size:13px;font-weight:600}",
    ".dash-row-cap{font-size:11px;color:var(--dim)}",
    ".dash-drill-grid{display:grid;grid-template-columns:repeat(9,minmax(0,1fr));gap:12px}",
    ".dc{display:flex;flex-direction:column;gap:5px;min-width:0}",
    ".dc-top{display:flex;align-items:baseline;justify-content:space-between;gap:6px}",
    ".dc-name{font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".dc-pct{font-family:var(--mono);font-size:11px;color:var(--ink);font-variant-numeric:tabular-nums;flex:none}",
    ".dc-track{height:6px;border-radius:3px;background:var(--panel2);border:1px solid var(--line);overflow:hidden}",
    ".dc-fill{height:100%;background:var(--lime);border-radius:3px}",
    ".dash-friends-slot{min-width:0}",
    ".dash-friends-fallback{margin:0 0 8px;font-size:13px;font-weight:600}",

    /* ---- v3 information sections ---- */
    /* A dense grid under the calendar. The min() keeps the track from overflowing a
       360px screen, so the grid is one column there and two or three on a wide page.
       align-items:start stops a short card being stretched to a tall neighbour. */
    /* The sections are uneven heights, so a row-based grid left a dead region
       beside whichever column ended first. Multi-column flows them into balanced
       columns instead, and break-inside keeps a section whole. */
    ".dash-sections{columns:2;column-gap:var(--gap-2);min-width:0}",
    ".dash-sections>*{break-inside:avoid;margin:0 0 var(--gap-2);min-width:0}",

    /* Entrance: one orchestrated rise, staggered. Nothing under reduced motion. */
    "@media(prefers-reduced-motion:no-preference){.dash-strip,.dash-cal,.dash-drills,.dash-friends{animation:rise .42s cubic-bezier(.3,.9,.3,1) both}.dash-cal{animation-delay:.05s}.dash-drills{animation-delay:.1s}.dash-friends{animation-delay:.15s}@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}}",

    "@media(max-width:900px){.dash-sections{columns:1}.dash-strip{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.hs-next{grid-column:1 / -1}.dash-drill-grid{grid-template-columns:repeat(5,minmax(0,1fr))}}",
    "@media(max-width:560px){.dash{gap:var(--gap-2)}.dash-strip{grid-template-columns:1fr;gap:var(--gap-2)}.hs-next{grid-column:auto}.hs{padding:10px 12px}.dash-cal{min-height:0;padding:12px}.cal-tools{margin-left:0}.cal-month{font-size:19px}.cal-grid{display:flex;flex-direction:column;gap:6px}.cal-cell{flex-direction:row;align-items:center;gap:10px;padding:9px 11px}.cal-cell-wd{display:block;width:34px;flex:none;font-family:var(--mono);font-size:11px;color:var(--dim)}.cal-cell-top{flex:none;gap:0}.cal-cell-top .cal-n{display:none}.cal-pips{width:70px;flex:none;margin:0}.cal-cell-st{display:block;margin-left:auto;font-size:11px;color:var(--muted)}.cal-cell.today .cal-flag{display:none}.cal-wd{display:none}.cal-sum{margin-left:0;text-align:left}.dash-drill-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}"
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

/* ---------------- header strip ---------------- */

/* Sessions per day, oldest to newest, over the last `days` local days. */
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

/* A thin 14 day bar run beside the streak. Real counts, today in the warn tone. */
function buildSpark14(state, now) {
  var days = sessionsPerDay(state.sessions || [], 14);
  var max = 0, i;
  for (i = 0; i < days.length; i++) if (days[i].n > max) max = days[i].n;
  var todayN = days.length ? days[days.length - 1].n : 0;
  var spark = h("div", "spark");
  spark.setAttribute("role", "img");
  spark.setAttribute("aria-label",
    "Sessions per day over the last 14 days. Today: " + todayN + ". Best day: " + max + ".");
  for (i = 0; i < days.length; i++) {
    var d = days[i];
    var isToday = i === days.length - 1;
    var bar = h("i", (d.n > 0 ? "on" : "") + (isToday ? " now" : ""));
    bar.style.height = (d.n > 0 ? Math.max(20, Math.round((d.n / max) * 100)) : 6) + "%";
    spark.appendChild(bar);
  }
  return spark;
}

/* Live region for a spent freeze. */
var freezeLive = null;

function announceFreeze(text) {
  if (freezeLive) freezeLive.textContent = text;
}

/* The streak card: the number, the 14 day run, and the freeze control when a run
   is at stake. Spending a freeze mutates state and asks paint() to rebuild. */
function buildStreakCard(ctx, state, now, onSpend) {
  var S = globalThis.Store;
  var card = h("div", "hs hs-streak");
  var row = h("div", "hs-row");

  var stat = h("div", "hs-stat");
  stat.appendChild(h("span", "hs-label", "Streak"));
  var n = S ? S.streak(state, now) : 0;
  var num = h("span", "streak-n");
  num.setAttribute("aria-live", "polite");
  if (ctx.motion && typeof ctx.motion.countUp === "function") {
    ctx.motion.countUp(num, n, { duration: 400 });
  } else {
    num.textContent = String(n);
  }
  stat.appendChild(num);
  stat.appendChild(h("span", "streak-unit", n === 1 ? "day in a row" : "days in a row"));
  row.appendChild(stat);
  row.appendChild(buildSpark14(state, now));
  card.appendChild(row);

  var atRisk = S ? S.streakAtRisk(state, now) : false;
  var freezes = Math.max(0, state.streakFreezes || 0);
  var gap = S && typeof S.streakGapDay === "function" ? S.streakGapDay(state, now) : null;
  if (atRisk && freezes > 0 && gap && S && typeof S.applyFreeze === "function") {
    var fr = h("div", "hs-freeze");
    var live = h("span", "nb-readout dash-freeze-num", String(freezes));
    live.setAttribute("aria-live", "polite");
    freezeLive = live;
    fr.appendChild(live);
    fr.appendChild(h("span", "dash-note", freezes === 1
      ? "freeze held. It bridges the missed day on " + gap +
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
    fr.appendChild(b);
    card.appendChild(fr);
  }
  return card;
}

/* The goal ring, reused as-is and compacted for the strip. */
function buildGoalCard(ctx, sessionsToday, goal, reduced, isNew) {
  var card = h("div", "hs hs-goal");
  var block = buildGoalBlock(ctx, sessionsToday.length, goal, reduced, isNew);
  block.classList.add("dash-panel-goal-sm");
  card.appendChild(block);
  return card;
}

/* The next unrun drill today, with the one action: start today's plan. The queue
   key is the same one Circuit writes, so the plan runs end to end in order. */
function buildNextCard(ctx, reg, ids, left) {
  var card = h("div", "hs hs-next");
  var nLeft = left.length;
  var nextId = nLeft ? left[0] : (ids.length ? ids[0] : null);
  var allDone = nLeft === 0 && ids.length > 0;
  var m = nextId ? metaFor(reg, nextId) : null;

  card.appendChild(iconEl(m ? m.icon : ""));
  var copy = h("div", "hs-copy");
  copy.appendChild(h("span", "hs-label", allDone ? "Done today" : "Next up"));
  copy.appendChild(h("b", "hs-next-name", m ? m.name : "Today's set"));
  copy.appendChild(h("span", "hs-next-trains",
    allDone ? "Run it again if you like." : (m && m.trains ? m.trains : "")));
  card.appendChild(copy);

  var start = h("button", "btn-primary dash-start",
    nLeft === 1 ? "Start today's last drill"
      : nLeft ? "Start today's " + nLeft + " drills"
              : "Run today's plan again");
  start.type = "button";
  start.addEventListener("click", function () {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify({ ids: nLeft ? left : ids, interleave: false }));
    } catch (e) { /* degrade to Train's own picker */ }
    go(ctx, "train");
  });
  card.appendChild(start);
  return card;
}

function fillStrip(target, ctx, reg, state, ids, left, sessionsToday, goal, reduced, isNew, onSpend) {
  target.textContent = "";
  target.appendChild(buildStreakCard(ctx, state, Date.now(), onSpend));
  target.appendChild(buildGoalCard(ctx, sessionsToday, goal, reduced, isNew));
  target.appendChild(buildNextCard(ctx, reg, ids, left));
}

/* ---------------- calendar hero ---------------- */

/* The month being shown. Kept across repaints, so a data refresh does not throw
   the reader back to the current month. */
var calMonth = null;

function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }

function buildCalendar(ctx, state, goal, now) {
  var S = globalThis.Store;
  var section = h("section", "dash-cal");
  var counts = (S && typeof S.dayCounts === "function") ? S.dayCounts(state) : {};
  var todayKey = localDate(now);
  var current = calMonth ? calMonth : new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1);
  calMonth = current;

  function draw() {
    section.textContent = "";
    var y = current.getFullYear(), mo = current.getMonth();
    var monthName = MONTHS_FULL[mo] + " " + y;
    section.setAttribute("aria-label", "Habit calendar for " + monthName);

    var daysInMonth = new Date(y, mo + 1, 0).getDate();
    var lead = (new Date(y, mo, 1).getDay() + 6) % 7;
    var prevDays = new Date(y, mo, 0).getDate();
    var totalCells = Math.ceil((lead + daysInMonth) / 7) * 7;

    var monthSessions = 0, goalDays = 0, bestDay = 0, maxN = 0, day;
    for (day = 1; day <= daysInMonth; day++) {
      var kn = counts[localDate(new Date(y, mo, day, 12))] || 0;
      monthSessions += kn;
      if (kn >= goal) goalDays++;
      if (kn > bestDay) bestDay = kn;
      if (kn > maxN) maxN = kn;
    }

    var top = h("div", "cal-top");
    top.appendChild(h("h2", "cal-month", monthName));
    top.appendChild(h("span", "cal-sub",
      monthSessions + (monthSessions === 1 ? " session" : " sessions") + " \u00b7 " +
      goalDays + (goalDays === 1 ? " goal day" : " goal days")));
    var tools = h("div", "cal-tools");
    var prev = h("button", "cal-icon");
    prev.type = "button";
    prev.setAttribute("aria-label", "Previous month");
    prev.appendChild(chevron("prev"));
    prev.addEventListener("click", function () { current = addMonths(current, -1); calMonth = current; draw(); });
    var todayBtn = h("button", "btn-ghost cal-today", "Today");
    todayBtn.type = "button";
    todayBtn.addEventListener("click", function () {
      var d = new Date();
      current = new Date(d.getFullYear(), d.getMonth(), 1);
      calMonth = current;
      draw();
    });
    var next = h("button", "cal-icon");
    next.type = "button";
    next.setAttribute("aria-label", "Next month");
    next.appendChild(chevron("next"));
    next.addEventListener("click", function () { current = addMonths(current, 1); calMonth = current; draw(); });
    tools.appendChild(prev); tools.appendChild(todayBtn); tools.appendChild(next);
    top.appendChild(tools);
    section.appendChild(top);

    var wd = h("div", "cal-wd");
    wd.setAttribute("aria-hidden", "true");
    for (var wi = 0; wi < CAL_HEADS.length; wi++) {
      wd.appendChild(h("span", wi >= 5 ? "we" : null, CAL_HEADS[wi]));
    }
    section.appendChild(wd);

    var grid = h("div", "cal-grid");
    grid.setAttribute("role", "list");
    grid.setAttribute("aria-label", monthName + ", sessions per day");

    for (var i = 0; i < totalCells; i++) {
      var dayNum, cellDate, inMonth;
      if (i < lead) {
        dayNum = prevDays - lead + 1 + i;
        cellDate = new Date(y, mo - 1, dayNum, 12);
        inMonth = false;
      } else if (i >= lead + daysInMonth) {
        dayNum = i - (lead + daysInMonth) + 1;
        cellDate = new Date(y, mo + 1, dayNum, 12);
        inMonth = false;
      } else {
        dayNum = i - lead + 1;
        cellDate = new Date(y, mo, dayNum, 12);
        inMonth = true;
      }
      var k = localDate(cellDate);
      var n = counts[k] || 0;
      var level = (S && typeof S.heatmapBuckets === "function") ? S.heatmapBuckets(n, maxN) : 0;
      var isToday = k === todayKey;
      var met = n >= goal;

      var cell = h("div", "cal-cell" + (inMonth ? "" : " adj") + (met ? " met" : "") + (isToday ? " today" : ""));
      cell.setAttribute("role", "listitem");
      var label = WEEKDAYS[(cellDate.getDay() + 6) % 7] + " " + dayNum + " " + MONTHS_FULL[cellDate.getMonth()] +
        ", " + (n === 0 ? "no sessions" : n + (n === 1 ? " session" : " sessions")) +
        (met ? ", goal met" : "") + (isToday ? ", today" : "");
      cell.setAttribute("aria-label", label);
      if (isToday) cell.setAttribute("aria-current", "date");

      cell.appendChild(h("span", "cal-cell-wd", WD_SHORT[cellDate.getDay()]));
      var cellTop = h("div", "cal-cell-top");
      cellTop.appendChild(h("span", "cal-d", String(dayNum)));
      if (n > 0) cellTop.appendChild(h("span", "cal-n", String(n)));
      cell.appendChild(cellTop);

      var pips = h("div", "cal-pips");
      pips.setAttribute("aria-hidden", "true");
      for (var p = 0; p < 4; p++) pips.appendChild(h("i", p < level ? "on" : null));
      cell.appendChild(pips);

      var st = isToday
        ? (n >= goal ? "goal met" : n + " of " + goal)
        : (met ? "goal met" : n > 0 ? n + (n === 1 ? " session" : " sessions") : "upcoming");
      cell.appendChild(h("span", "cal-cell-st", st));
      if (isToday) cell.appendChild(h("span", "cal-flag", "today"));
      grid.appendChild(cell);
    }
    section.appendChild(grid);

    var foot = h("div", "cal-foot");
    var legend = h("div", "cal-legend");
    legend.appendChild(legendKey("met", "goal met, " + goal + " or more"));
    legend.appendChild(legendKey("today", "today, in progress"));
    legend.appendChild(legendKey("up", "upcoming"));
    foot.appendChild(legend);

    var streak = S ? S.streak(state, now) : 0;
    var sum = h("div", "cal-sum");
    sum.appendChild(document.createTextNode("Streak " + streak + (streak === 1 ? " day" : " days") + " \u00b7 best day "));
    sum.appendChild(h("b", null, String(bestDay)));
    sum.appendChild(document.createTextNode(" sessions"));
    foot.appendChild(sum);
    section.appendChild(foot);
  }

  draw();
  return section;
}

function legendKey(cls, text) {
  var k = h("span", "cal-k");
  k.appendChild(h("span", "cal-sw " + cls));
  k.appendChild(document.createTextNode(text));
  return k;
}

/* ---------------- per-drill consistency ---------------- */

/* Distinct days each drill was trained in the last `windowDays` local days, from
   both the run rows and the drill lists on each session. Real counts only. */
function drillDayCounts(state, windowDays) {
  var cutoff = dayIndexOf(Date.now()) - windowDays + 1;
  var sets = {};
  function add(id, k) {
    if (!id) return;
    if (!sets[id]) sets[id] = {};
    sets[id][k] = 1;
  }
  var rs = state.records || [], i;
  for (i = 0; i < rs.length; i++) {
    var r = rs[i];
    var rt = msOf(r);
    if (dayIndexOf(rt) < cutoff) continue;
    add(r.drillId, localDate(rt));
  }
  var ss = state.sessions || [];
  for (i = 0; i < ss.length; i++) {
    var s = ss[i];
    var st = msOf(s);
    if (dayIndexOf(st) < cutoff) continue;
    var k = localDate(st);
    var ds = s.drills || [];
    for (var j = 0; j < ds.length; j++) add(ds[j], k);
  }
  var out = {};
  var ids = Object.keys(sets);
  for (i = 0; i < ids.length; i++) out[ids[i]] = Object.keys(sets[ids[i]]).length;
  return out;
}

function buildDrillRow(reg, state) {
  var section = h("section", "dash-drills");
  section.setAttribute("aria-label", "Consistency by drill over the last " + DRILL_WINDOW + " days");
  var head = h("div", "dash-row-head");
  head.appendChild(h("h3", null, "Consistency by drill"));
  head.appendChild(h("span", "dash-row-cap", "days trained, last " + DRILL_WINDOW));
  section.appendChild(head);

  var days = drillDayCounts(state, DRILL_WINDOW);
  var grid = h("div", "dash-drill-grid");
  var ids = Object.keys(reg);
  for (var i = 0; i < ids.length; i++) {
    var m = reg[ids[i]];
    var n = days[ids[i]] || 0;
    var dc = h("div", "dc");
    var top = h("div", "dc-top");
    var name = h("span", "dc-name", SHORT_NAME[ids[i]] || m.name);
    name.title = m.name;
    top.appendChild(name);
    top.appendChild(h("span", "dc-pct", n + "d"));
    dc.appendChild(top);
    var track = h("div", "dc-track");
    var fill = h("div", "dc-fill");
    fill.style.width = Math.round((n / DRILL_WINDOW) * 100) + "%";
    track.appendChild(fill);
    dc.appendChild(track);
    grid.appendChild(dc);
  }
  section.appendChild(grid);
  return section;
}

/* ---------------- friends row ---------------- */

/* The friends row hosts the panel app/ui/friends.js builds. That panel carries its
   own "Friends" heading, so this section adds none; the fallback shows only if the
   builder ever throws, so the dashboard still paints. The panel is built once and
   reused across repaints, so a cache-then-network paint does not fetch twice. It is
   built compact: the habit calendar is the hero, so the friends row is a short
   summary (top 3 friends plus any request), not a second full page. */
var friendsNode = null;

function buildFriendsSection(ctx) {
  var section = h("section", "dash-friends");
  section.setAttribute("aria-label", "Friends");
  var slot = h("div", "dash-friends-slot");

  if (!friendsNode) {
    try { friendsNode = buildFriendsPanel(ctx, { compact: true }); } catch (e) { friendsNode = null; }
  }
  if (friendsNode) {
    slot.appendChild(friendsNode);
  } else {
    slot.appendChild(h("h3", "dash-friends-fallback", "Friends"));
    slot.appendChild(h("p", "dash-note", "No friends yet. Follow someone to compare streaks."));
  }
  section.appendChild(slot);
  return section;
}

/* ---------------- v3 information sections ---------------- */

/* The five v3 sections live in app/views/dash/, one file each, all exporting
   build(ctx, data). They are written in parallel with this shell, so a missing or
   broken module must never blank the page: each is pulled through a dynamic import
   wrapped in a catch, and the real specifier strings are the real paths. Nothing is
   stubbed and no section is faked here. A module that fails to load simply does not
   render, and the calendar and the rest of the dashboard stand. */
var SECTION_FILES = [
  ['records', './dash/records.js'],
  ['load', './dash/load.js'],
  ['rank', './dash/rank.js'],
  ['upcoming', './dash/upcoming.js'],
  ['patterns', './dash/patterns.js']
];
var SECTION_ORDER = ['records', 'load', 'rank', 'upcoming', 'patterns'];

async function loadSections() {
  var mods = {};
  await Promise.all(SECTION_FILES.map(function (pair) {
    return import(pair[1]).then(function (m) {
      mods[pair[0]] = (m && typeof m.build === 'function') ? m.build : null;
    }).catch(function () { mods[pair[0]] = null; });
  }));
  return mods;
}

/* One normalized object, built once, handed to every section builder. The shape is
   the one the design brief fixes: profile, runs (newest last), sessions, cards,
   records (the personal-best moments), now. Nothing here is invented; each field
   comes from the same state the calendar already reads. */
function buildData(profile, state, raw, now, reg) {
  var stored = readStore();
  var cards = (raw && Array.isArray(raw.cards)) ? raw.cards
    : (Array.isArray(state.cards) ? state.cards : ((stored && Array.isArray(stored.cards)) ? stored.cards : []));
  var records = [];
  try {
    if (globalThis.Store && typeof globalThis.Store.personalRecords === 'function') {
      records = globalThis.Store.personalRecords(state, dirMap(reg));
    }
  } catch (e) { records = []; }
  return {
    profile: profile || {},
    runs: state.records || [],
    sessions: state.sessions || [],
    cards: cards,
    records: records,
    now: now
  };
}

/* Build the sections that are available and place them in one grid below the
   calendar. A builder that throws is dropped, not allowed to take the page down. */
function buildSections(ctx, data, mods) {
  var wrap = h('div', 'dash-sections');
  if (!mods) return wrap;
  for (var i = 0; i < SECTION_ORDER.length; i++) {
    var fn = mods[SECTION_ORDER[i]];
    if (typeof fn !== 'function') continue;
    try {
      var node = fn(ctx, data);
      if (node) wrap.appendChild(node);
    } catch (e) { /* one broken section must not blank the dashboard */ }
  }
  return wrap;
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

function paint(container, ctx, raw, mods) {
  var runs = Array.isArray(raw && raw.runs) ? raw.runs : [];
  /* raw is null on a cold first paint, before anything has been cached, so the
     profile has to come through the same guard as the runs. Reading data.profile
     unguarded threw on exactly that first visit. */
  var profile = ctx.profile || (raw && raw.profile) || {};
  var reg = drillRegistry();
  var now = Date.now();
  var today = localDate(now);
  var goal = Number(profile.daily_goal != null ? profile.daily_goal : profile.dailyGoal);
  if (!isFinite(goal) || goal < 1) goal = 3;

  var S = globalThis.Store;
  var state = toState(raw, profile, readStore());
  /* The one normalized object every section builder reads. Built once per paint,
     from the same state the calendar uses, so no section invents a number. */
  var data = buildData(profile, state, raw, now, reg);
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

  var root = h("div", "dash");
  /* The router focuses .view-title after a nav change, so the heading stays in the
     tree even though the topbar already names the view. */
  var title = h("h2", "view-title sr", "Dashboard");
  title.tabIndex = -1;
  root.appendChild(title);

  var strip = h("section", "dash-strip");
  strip.setAttribute("aria-label", "Streak, goal, and next drill");
  function repaintStrip() {
    fillStrip(strip, ctx, reg, state, ids, left, sessionsToday, goal, reduced, isNew, repaintStrip);
  }
  repaintStrip();
  root.appendChild(strip);

  root.appendChild(buildCalendar(ctx, state, goal, now));
  root.appendChild(buildSections(ctx, data, mods));
  root.appendChild(buildDrillRow(reg, state));
  root.appendChild(buildFriendsSection(ctx));

  container.textContent = "";
  container.appendChild(root);
}

export async function render(container, ctx) {
  ctx = ctx || {};
  if (!container) return;
  injectStyles();

  /* Start the section modules loading, then paint from the cache straight away.
     The sections appear on the second paint once the modules and the network data
     have both settled, so a slow import never delays the calendar. */
  var modsPromise = loadSections();
  paint(container, ctx, readCache(), null);

  var next = readCache();
  if (ctx.db && typeof ctx.db.loadUserData === "function") {
    try {
      var res = await ctx.db.loadUserData();
      if (res && res.ok && res.data) next = res.data;
    } catch (e) { /* keep the cached paint */ }
  }
  var mods = await modsPromise;
  if (container.isConnected) paint(container, ctx, next, mods);
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
   uses this same order, so the strip shows what will actually run. */
var MIDDLE_DRILL = "ufov";
export function orderPlan(ids) {
  var list = (ids || []).slice();
  var i = list.indexOf(MIDDLE_DRILL);
  if (i === -1) return list;
  list.splice(i, 1);
  list.splice(Math.floor(list.length / 2), 0, MIDDLE_DRILL);
  return list;
}
