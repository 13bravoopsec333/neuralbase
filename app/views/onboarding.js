/* Neuralbase view: first-run onboarding.
   Three steps in one advancing card: pick a goal, calibrate, read the starting point.
   Every step is skippable and a skip never writes a baseline that looks authoritative.

   render(container, ctx) mounts its own DOM into the container, reads only ctx plus the
   Store/Content/Engine/Drills globals, and never throws. All text is set with textContent,
   never innerHTML, apart from the drill marks, which are our own static SVG in currentColor.
   Motion is limited to the ruler mark and value count-ups, both skipped under
   ctx.motion.reduced(). */

var STYLE_ID = "nb-onboard-styles";

/* Wall-clock cost of one block in seconds, read off the trial counts in drills.js:
   nback 18 trials at 2.5 s each, sart and the two timed pro drills are long, and the
   tap-paced drills are short. The calibration budget keeps the whole step under about
   ninety seconds. */
var COST = { nback: 48, ufov: 28, sart: 55, crt: 40, math: 45, reasoning: 20, palace: 22, switching: 24 };
var DEFAULT_COST = 30;
var BUDGET_SECONDS = 85;

/* Spaced Retrieval needs cards the new account has none of, so it opens a form and never
   completes. It cannot calibrate anything on a first run. */
var NOT_CALIBRATABLE = { spaced: 1 };

var STEP_NAMES = ["Goal", "Calibration", "Starting point"];
var STEP_LABELS = ["goal", "calibrate", "start"];

/* One sentence per goal. The old lines ran to two, and the second half restated
   the first in different words, then the weights line under it named the same
   drills again. The first half said it once, so that is all that is here. */
var GOAL_META = [
  { id: "focus", word: "Focus", line: "Leans on the speed and switching drills." },
  { id: "memory", word: "Memory", line: "Leans on the recall drills and n-back." },
  { id: "study", word: "Study", line: "Leans on reasoning, arithmetic, and spaced review." },
  { id: "fresh", word: "Fresh", line: "Spreads evenly, so every drill gets its turn." }
];

/* ---------------- module state (reset on every render) ---------------- */

var step = 0;             /* 0 goal, 1 calibration, 2 starting point */
var maxStep = 0;          /* furthest step reached, so the ruler can walk back */
var selectedGoal = null;  /* the goal the user picked, null until they pick one */
var plannedIds = [];      /* the calibration block list */
var measured = {};        /* drillId -> { value, accuracy } */
var histRecords = [];     /* existing runs, so the index can be real for a returning user */
var handle = null;        /* the live drill handle */
var timers = [];          /* pending auto-advance timeouts */
var liveEl = null;        /* the aria-live node, kept across repaints */
var seq = 0;              /* guards async callbacks after a repaint */
var ctxRef = null;

/* ---------------- tiny DOM helpers ---------------- */

function h(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
}

/* Small uppercase mono field name, the label style used across the app. */
function field(text) {
  return h("span", "onb-field", text);
}

/* The drill's mark, drawn in currentColor. Markup is our own static SVG string. */
function iconEl(markup) {
  var s = h("span", "drill-ic");
  s.setAttribute("aria-hidden", "true");
  if (markup) s.innerHTML = markup;
  return s;
}

function drills() {
  return (globalThis.Content && globalThis.Content.DRILLS) || [];
}

function drillById(id) {
  var D = drills();
  for (var i = 0; i < D.length; i++) if (D[i].id === id) return D[i];
  return { id: id, name: "Drill", icon: "", desc: "", trains: "", works: "", evidence: "", pro: false, direction: "higher", unit: "" };
}

function dirMap() {
  var D = drills(), out = {};
  for (var i = 0; i < D.length; i++) out[D[i].id] = D[i].direction === "lower" ? "lower" : "higher";
  return out;
}

function planOf() {
  return ctxRef && ctxRef.profile && ctxRef.profile.plan === "pro" ? "pro" : "free";
}

function num2(n) {
  var s = String(n);
  return s.length < 2 ? "0" + s : s;
}

function go(view) {
  if (ctxRef && typeof ctxRef.navigate === "function") ctxRef.navigate(view);
}

/* ---------------- scoped styles (theme tokens only) ---------------- */

function injectStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  var s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = [
    ".onb{display:block;max-width:760px;margin:0 auto}",
    ".onb-field{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--dim)}",

    /* Signature: the ticked ruler, on the shared .nb-track primitive. Minor ticks
       every 2 percent, taller ticks every 16, and a mark that slides to the step. */
    ".onb-ruler{margin-bottom:16px}",
    ".onb-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:8px}",
    ".onb-step{display:flex;align-items:baseline;gap:6px;background:none;border:0;padding:0;font-family:var(--mono);font-size:10px;letter-spacing:.11em;text-transform:uppercase;color:var(--dim);text-align:left;transition:color .15s ease}",
    ".onb-step:nth-child(2){justify-content:center}",
    ".onb-step:nth-child(3){justify-content:flex-end}",
    ".onb-step-n{color:var(--dim);font-variant-numeric:tabular-nums}",
    ".onb-step.done{color:var(--muted)}",
    ".onb-step.on{color:var(--accent)}",
    ".onb-step.on .onb-step-n{color:var(--accent)}",
    ".onb-step[disabled]{opacity:.5;cursor:default}",

    ".onb-card{padding:16px}",
    ".onb-h{margin:5px 0 0;font-size:16px;font-weight:600;letter-spacing:-.015em}",
    ".onb-sub{margin:6px 0 0;color:var(--muted);font-size:13px;line-height:1.5;max-width:58ch}",

    ".onb-goals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:14px}",
    ".onb-goal{text-align:left;background:var(--panel2);border:1px solid var(--line);border-radius:var(--r);padding:11px 12px;display:flex;flex-direction:column;gap:5px;transition:border-color .15s ease,background .15s ease}",
    ".onb-goal:hover{border-color:var(--line2)}",
    ".onb-goal[aria-pressed=\"true\"]{border-color:var(--accent-edge);background:var(--accent-soft)}",
    ".onb-goal-word{font-size:16px;font-weight:600;letter-spacing:-.01em}",
    ".onb-goal-line{color:var(--muted);font-size:13px;line-height:1.45}",
    ".onb-goal-weights{font-family:var(--mono);font-size:10px;line-height:1.5;letter-spacing:.02em;color:var(--dim);overflow-wrap:anywhere}",
    ".onb-goal[aria-pressed=\"true\"] .onb-goal-weights{color:var(--muted)}",

    ".onb-preview{margin-top:14px;border:1px solid var(--line);border-radius:var(--r);background:var(--panel2);padding:11px 12px}",
    ".onb-preview-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding-bottom:8px;border-bottom:1px solid var(--line)}",
    ".onb-preview-title{font-size:13px;font-weight:600}",
    ".onb-preview-rows{display:flex;flex-direction:column}",
    ".onb-plan-row{display:flex;align-items:center;gap:9px;padding:8px 0;border-bottom:1px solid var(--line)}",
    ".onb-plan-row:last-child{border-bottom:0}",
    ".onb-plan-row.up{color:var(--ink)}",
    ".onb-plan-row.up .onb-plan-idx{color:var(--accent)}",
    ".onb-plan-tag{margin-left:auto;font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);white-space:nowrap}",
    ".onb-plan-idx{font-family:var(--mono);font-size:10px;color:var(--dim);font-variant-numeric:tabular-nums;flex:none}",
    ".onb-plan-name{font-size:13px;font-weight:600;min-width:0;overflow-wrap:break-word}",
    ".onb-plan-skill{color:var(--muted);font-size:12px;margin-left:auto;text-align:right;min-width:0;overflow-wrap:break-word}",
    ".onb-plan-row.up .onb-plan-name{color:var(--accent)}",
    ".onb-preview-empty{margin:9px 0 0;color:var(--dim);font-size:13px}",
    ".onb-preview-cap{margin:9px 0 0;color:var(--dim);font-size:12px;line-height:1.45}",

    ".onb-rows{display:flex;flex-direction:column;gap:7px;margin-top:14px}",
    ".onb-row{display:grid;grid-template-columns:16px 20px minmax(0,1fr) auto;align-items:center;gap:9px;padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:var(--panel2)}",
    ".onb-row.running{border-color:var(--accent-edge)}",
    ".onb-row-idx{font-family:var(--mono);font-size:10px;color:var(--dim);font-variant-numeric:tabular-nums}",
    ".onb-row.running .onb-row-idx{color:var(--accent)}",
    ".onb-row-name{font-size:13px;font-weight:600;min-width:0;overflow-wrap:break-word}",
    ".onb-row-cap{font-family:var(--mono);font-size:10px;letter-spacing:.04em;color:var(--dim);overflow-wrap:anywhere}",
    ".onb-right{display:flex;align-items:baseline;gap:9px;justify-content:flex-end}",
    ".onb-chip{font-family:var(--mono);font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--dim);white-space:nowrap}",
    ".onb-row.running .onb-chip{color:var(--accent)}",
    ".onb-hit{font-family:var(--mono);font-size:20px;font-weight:500;font-variant-numeric:tabular-nums;letter-spacing:-.01em;white-space:nowrap}",
    ".onb-hit-unit{font-size:12px;color:var(--muted)}",
    ".onb-mount{margin-top:12px}",
    ".onb-mount:empty{display:none}",

    ".onb-actions{display:flex;gap:10px;margin-top:16px;flex-wrap:wrap}",
    ".onb-note{margin:14px 0 0;padding:11px 12px;border:1px solid var(--line);border-radius:8px;color:var(--muted);font-size:12px;line-height:1.55;background:var(--panel2)}",
    ".onb-readout{display:flex;flex-direction:column;gap:9px;margin-top:14px;padding:13px 14px;border:1px solid var(--line);border-radius:var(--r);background:var(--panel2)}",
    ".onb-readout-line{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}",
    ".onb-readout-v{--nb-readout:42px;flex:none}",
    ".onb-readout-v.none{color:var(--dim);--nb-readout:26px;letter-spacing:.02em}",
    ".onb-readout-cap{margin:0;color:var(--muted);font-size:12px;line-height:1.45;max-width:46ch;min-width:0;flex:1}",
    ".onb-skills{display:flex;flex-direction:column;gap:7px;margin-top:14px}",
    ".onb-skill{display:grid;grid-template-columns:20px minmax(0,1fr) auto;align-items:baseline;gap:10px;padding:10px 2px;border-top:1px solid var(--line)}",
    ".onb-skill .drill-ic{align-self:center}",
    ".onb-skill-t{min-width:0}",
    ".onb-skill-name{font-size:13px;font-weight:600;overflow-wrap:break-word}",
    ".onb-skill-trains{color:var(--muted);font-size:12px;line-height:1.4;margin-top:2px}",
    ".onb-skill-num{text-align:right;white-space:nowrap}",
    ".onb-skill-val{--nb-readout:26px;line-height:1.1}",
    ".onb-skill-val.none{color:var(--dim);--nb-readout:20px}",
    ".onb-skill-unit{font-family:var(--mono);font-size:12px;color:var(--muted);margin-left:3px}",
    ".onb-skill-cap{font-family:var(--mono);font-size:10px;letter-spacing:.04em;color:var(--dim);margin-top:3px;overflow-wrap:anywhere}",

    "@media(max-width:640px){.onb-goals{grid-template-columns:1fr}}",
    "@media(max-width:420px){.onb-row{grid-template-columns:14px 18px minmax(0,1fr)}.onb-row .onb-right{grid-column:2 / -1;justify-content:flex-start}.onb-plan-skill{display:none}.onb-skill{grid-template-columns:18px minmax(0,1fr)}.onb-skill-num{grid-column:2;text-align:left;display:flex;flex-direction:column;align-items:flex-start;gap:2px}.onb-skill-cap{margin-top:0}.onb-readout-v{--nb-readout:34px}}"
  ].join("");
  document.head.appendChild(s);
}

/* ---------------- plan and calibration selection ---------------- */

/* The daily plan for a goal, exactly what the dashboard will show tomorrow. dailyPlan
   filters by entitlement on its own, so the accessible pool is passed in whole. */
function planIds(goal) {
  var Store = globalThis.Store;
  var Engine = globalThis.Engine;
  var pool = (Engine && Engine.ALL_DRILLS) || [];
  var day = (new Date().getDay() + 6) % 7;
  var state = { records: [], sessions: [], days: [], cards: [], plan: planOf(), goal: goal, sequences: [] };
  var out = [];
  if (Store && typeof Store.dailyPlan === "function") {
    try { out = Store.dailyPlan(state, day, pool, 3) || []; } catch (e) { out = []; }
  }
  if (!out.length && Engine && typeof Engine.dailyCircuit === "function") {
    try { out = Engine.dailyCircuit(day, planOf()) || []; } catch (e) { out = []; }
  }
  return out;
}

function seconds(ids) {
  var t = 0;
  for (var i = 0; i < ids.length; i++) t += COST[ids[i]] == null ? DEFAULT_COST : COST[ids[i]];
  return t;
}

function allowed(id) {
  if (NOT_CALIBRATABLE[id]) return false;
  var Engine = globalThis.Engine;
  if (Engine && typeof Engine.canAccess === "function") {
    try { return !!Engine.canAccess(id, planOf()); } catch (e) { return true; }
  }
  return true;
}

/* Up to three blocks inside the time budget. The goal's own plan goes first, cheapest
   block first so one slow drill cannot eat the budget, then the shortest remaining drills
   fill the rest. Every block comes from Store.calibrationBlock for its starting
   difficulty, and the drill itself adapts inside the block. */
function calibrationIds(goal) {
  var Engine = globalThis.Engine;
  var all = (Engine && Engine.ALL_DRILLS) || [];
  var ids = [], seen = {}, i;

  var take = function (id) {
    if (ids.length >= 3 || seen[id]) return false;
    if (!allowed(id)) return false;
    var cost = COST[id] == null ? DEFAULT_COST : COST[id];
    if (seconds(ids) + cost > BUDGET_SECONDS) return false;
    seen[id] = 1; ids.push(id);
    return true;
  };

  var plan = planIds(goal).slice().sort(function (a, b) {
    return (COST[a] == null ? DEFAULT_COST : COST[a]) - (COST[b] == null ? DEFAULT_COST : COST[b]);
  });
  for (i = 0; i < plan.length && ids.length < 2; i++) take(plan[i]);

  var rest = all.slice().sort(function (a, b) {
    return (COST[a] == null ? DEFAULT_COST : COST[a]) - (COST[b] == null ? DEFAULT_COST : COST[b]);
  });
  for (i = 0; i < rest.length && ids.length < 3; i++) take(rest[i]);

  return ids;
}

function startingLevel(id) {
  var Store = globalThis.Store;
  if (Store && typeof Store.calibrationBlock === "function") {
    try { return Store.calibrationBlock(id, histRecords, dirMap()); } catch (e) { /* fall through */ }
  }
  return null;
}

function accuracyOf(rec) {
  if (!rec) return null;
  var m = rec.meta || {};
  if (typeof m.accuracy === "number" && isFinite(m.accuracy)) return m.accuracy;
  if (typeof m.trials === "number" && m.trials > 0 && typeof rec.value === "number") return rec.value / m.trials;
  return null;
}

function pct(a) {
  return a == null ? null : Math.round(a * 100) + "%";
}

/* The composite index, or null. It needs two runs in three drills before it means
   anything, so a first run normally has none and the summary says so. */
function indexNow() {
  var Store = globalThis.Store;
  if (!Store || typeof Store.baselineIndex !== "function") return null;
  try {
    var state = { records: [], sessions: [], days: [], cards: [], plan: planOf(), goal: goalChosen(), sequences: [] };
    var i;
    for (i = 0; i < histRecords.length; i++) state.records.push(histRecords[i]);
    for (var id in measured) {
      if (!Object.prototype.hasOwnProperty.call(measured, id)) continue;
      state.records.push({ drillId: id, value: measured[id].value, unit: drillById(id).unit, t: Date.now(), meta: null });
    }
    return Store.baselineIndex(state, dirMap());
  } catch (e) { return null; }
}

function goalChosen() {
  if (selectedGoal) return selectedGoal;
  var p = ctxRef && ctxRef.profile;
  var g = p && p.goal;
  return validGoal(g) ? g : "fresh";
}

function validGoal(g) {
  var Store = globalThis.Store;
  var list = (Store && Store.GOALS) || ["focus", "memory", "study", "fresh"];
  return list.indexOf(g) !== -1;
}

/* ---------------- step 1: the goal and its plan ---------------- */

function weightsFor(goal) {
  var Store = globalThis.Store;
  if (!Store || typeof Store.goalWeights !== "function") return {};
  try { return Store.goalWeights(goal) || {}; } catch (e) { return {}; }
}

function weightOf(goal, id) {
  var w = weightsFor(goal);
  return typeof w[id] === "number" ? w[id] : 1;
}

function topWeight(goal) {
  var w = weightsFor(goal), top = 0, id;
  for (id in w) if (Object.prototype.hasOwnProperty.call(w, id) && w[id] > top) top = w[id];
  return top;
}

/* The drills this goal counts most. For an unweighted goal this returns nothing,
   because "Counts most:" with no names under it would be noise, and the even
   weighting is already stated on the goal's own line. */
function goalWeightLine(goal) {
  var w = weightsFor(goal);
  var top = 0, id;
  for (id in w) if (Object.prototype.hasOwnProperty.call(w, id) && w[id] > top) top = w[id];
  if (top <= 1) return "";
  var names = [], D = drills();
  for (var i = 0; i < D.length; i++) if (w[D[i].id] === top) names.push(D[i].name);
  return "Counts most: " + names.join(", ") + ".";
}

function buildGoalStep() {
  var box = h("div", "onb-stepbody");

  box.appendChild(field("Step 01 of 03"));
  box.appendChild(h("h2", "onb-h", "What do you want to train?"));
  /* Only what the choice does. The reassurance that every drill stays available
     and the goal can be changed later was a paragraph about a decision the reader
     has not made yet, and both facts are true in Settings. */
  box.appendChild(h("p", "onb-sub", "The goal sets which drills the daily plan reaches for first."));

  var group = h("div", "onb-goals");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Training goal");

  for (var i = 0; i < GOAL_META.length; i++) {
    (function (meta) {
      var b = h("button", "onb-goal");
      b.type = "button";
      b.setAttribute("aria-pressed", selectedGoal === meta.id ? "true" : "false");
      if (selectedGoal === meta.id) b.setAttribute("aria-current", "true");
      b.appendChild(field("goal." + meta.id));
      b.appendChild(h("span", "onb-goal-word", meta.word));
      b.appendChild(h("span", "onb-goal-line", meta.line));
      var wl = goalWeightLine(meta.id);
      if (wl) b.appendChild(h("span", "onb-goal-weights", wl));
      b.addEventListener("click", function () {
        selectedGoal = meta.id;
        plannedIds = calibrationIds(meta.id);
        refresh();
        try { if (ctxRef.audio && ctxRef.audio.playSfx) ctxRef.audio.playSfx("tap"); } catch (e) { /* audio optional */ }
      });
      group.appendChild(b);
    })(GOAL_META[i]);
  }
  box.appendChild(group);

  var preview = h("div", "onb-preview");
  box.appendChild(preview);
  ui.preview = preview;

  var actions = h("div", "onb-actions");
  var next = h("button", "btn-primary", "Continue");
  next.type = "button";
  next.disabled = !selectedGoal;
  next.addEventListener("click", function () {
    if (!selectedGoal) return;
    plannedIds = calibrationIds(selectedGoal);
    setStep(1);
    startBlock(0);
  });
  var skip = h("button", "btn-ghost", "Skip setup");
  skip.type = "button";
  skip.addEventListener("click", finish);
  actions.appendChild(next);
  actions.appendChild(skip);
  box.appendChild(actions);

  return box;
}

function paintPreview() {
  var node = ui.preview;
  if (!node) return;
  node.textContent = "";
  /* An empty box under a "Today's plan" label told the reader nothing they could
     do, so the panel waits for a goal. Picking one brings it in. */
  node.hidden = !selectedGoal;
  if (!selectedGoal) return;

  var head = h("div", "onb-preview-head");
  head.appendChild(h("span", "onb-preview-title", "Today's plan"));
  head.appendChild(field("plan"));
  node.appendChild(head);

  var ids = planIds(selectedGoal);
  var top = topWeight(selectedGoal);
  var rows = h("div", "onb-preview-rows");
  for (var i = 0; i < ids.length; i++) {
    var d = drillById(ids[i]);
    var row = h("div", "onb-plan-row" + (weightOf(selectedGoal, d.id) === top && top > 1 ? " up" : ""));
    row.appendChild(h("span", "onb-plan-idx", num2(i + 1)));
    row.appendChild(iconEl(d.icon));
    row.appendChild(h("span", "onb-plan-name", d.name));
    if (weightOf(selectedGoal, d.id) === top && top > 1) {
      row.appendChild(h("span", "onb-plan-tag", "most weight"));
    } else {
      row.appendChild(h("span", "onb-plan-skill", d.trains));
    }
    rows.appendChild(row);
  }
  node.appendChild(rows);
  node.appendChild(h("p", "onb-preview-cap", planCaption(selectedGoal, ids)));
}

/* One honest sentence under the plan. Some of a goal's highest-weight drills sit
   behind Pro, so the count is stated rather than implied. */
function planCaption(goal, ids) {
  var word = (GOAL_META.filter(function (m) { return m.id === goal; })[0] || { word: goal }).word.toLowerCase();
  var top = topWeight(goal);
  if (top <= 1) {
    return ids.length + " drills with no weighting, so the plan rotates through all of them.";
  }
  var wanted = [], counted = 0, i;
  for (i = 0; i < drills().length; i++) {
    if (weightOf(goal, drills()[i].id) === top) wanted.push(drills()[i].id);
  }
  for (i = 0; i < ids.length; i++) if (wanted.indexOf(ids[i]) !== -1) counted++;
  var out = ids.length + " drills, weighted for " + word + ". " + counted + " of the " + wanted.length
    + " drills that count most for this goal " + (counted === 1 ? "is" : "are") + " in today's mix";
  var outside = wanted.length - counted;
  if (outside > 0) out += outside === 1 ? ", one is Pro." : ", " + outside + " are Pro.";
  /* The Pro count stays, because a reader on Free needs to know that a drill the
     goal asks for is one they cannot open today. Only the closing sentence about
     the mix moving with history went: it described a future the reader cannot
     act on and the plan is on screen to show the same thing. */
  return out + ".";
}

/* ---------------- step 2: the calibration block ---------------- */

function buildCalStep() {
  var box = h("div", "onb-stepbody");

  box.appendChild(field("Step 02 of 03"));
  box.appendChild(h("h2", "onb-h", "Calibrate"));
  var est = seconds(plannedIds);
  /* The count and the seconds, which is what a reader deciding whether to sit down
     for this needs. The second sentence was a promise about how it will feel. */
  box.appendChild(h("p", "onb-sub", plannedIds.length + " short block" + (plannedIds.length === 1 ? "" : "s") + ", about " + est + " seconds."));

  var rows = h("div", "onb-rows");
  ui.blockRow = [];
  for (var i = 0; i < plannedIds.length; i++) {
    (function (id, idx) {
      var d = drillById(id);
      var row = h("div", "onb-row");
      row.appendChild(h("span", "onb-row-idx", num2(idx + 1)));
      row.appendChild(iconEl(d.icon));
      var mid = h("div", "onb-row-mid");
      mid.appendChild(h("div", "onb-row-name", d.name));
      var start = startingLevel(id);
      var cap = start == null ? "starts at the default level" : "starts at " + start + " " + (d.unit || "");
      mid.appendChild(h("div", "onb-row-cap", cap));
      row.appendChild(mid);
      var right = h("div", "onb-right");
      right.appendChild(h("span", "onb-chip", "waiting"));
      row.appendChild(right);
      rows.appendChild(row);
      ui.blockRow.push({ row: row, chip: right.firstChild, right: right });
    })(plannedIds[i], i);
  }
  box.appendChild(rows);

  var mount = h("div", "onb-mount");
  box.appendChild(mount);
  ui.mount = mount;

  var actions = h("div", "onb-actions");
  var skip = h("button", "btn-ghost", measuredCount() ? "Stop and show what I have" : "Skip calibration");
  skip.type = "button";
  /* Skipping here lands on the summary rather than leaving, so the user still sees
     what was and was not measured and still chooses where to go next. */
  skip.addEventListener("click", function () { setStep(2); });
  actions.appendChild(skip);
  box.appendChild(actions);

  return box;
}

function measuredCount() {
  var n = 0;
  for (var id in measured) if (Object.prototype.hasOwnProperty.call(measured, id)) n++;
  return n;
}

function paintBlockRow(idx) {
  var r = ui.blockRow && ui.blockRow[idx];
  if (!r) return;
  var id = plannedIds[idx];
  var d = drillById(id);
  var got = measured[id];
  r.row.classList.remove("running");
  r.right.textContent = "";

  if (!got) {
    r.chip.textContent = "skipped";
    return;
  }
  var hit = h("span", "onb-hit", String(got.value));
  hit.appendChild(h("span", "onb-hit-unit", " " + (d.unit || "")));
  r.right.appendChild(hit);

  var acc = pct(got.accuracy);
  r.chip.textContent = acc == null ? "done" : acc + " correct";
}

function startBlock(idx) {
  var id = plannedIds[idx];
  var r = ui.blockRow && ui.blockRow[idx];
  if (!id || !r) return;
  var D = globalThis.Drills;
  var known = D && typeof D.ids === "function" ? D.ids().indexOf(id) !== -1 : false;
  if (!D || typeof D.start !== "function" || !known) {
    /* No drill registered for this id, so it measures nothing. Mark it and move on. */
    r.chip.textContent = "unavailable";
    later(function () { afterBlock(idx); }, 400);
    return;
  }

  var stamp = seq;
  var opts = {
    onComplete: function (rec) {
      if (stamp !== seq) return;
      if (rec && typeof rec.value === "number" && isFinite(rec.value)) {
        measured[id] = { value: rec.value, accuracy: accuracyOf(rec) };
      }
      paintBlockRow(idx);
      later(function () { if (stamp === seq) afterBlock(idx); }, 1100);
    }
  };
  if (id === "nback") {
    var Engine = globalThis.Engine;
    var modes = Engine && typeof Engine.modesFor === "function" ? Engine.modesFor("nback", planOf()) : [];
    opts.mode = modes.length ? modes[0] : "dual";
  }

  r.row.classList.add("running");
  r.chip.textContent = "running";
  if (ui.mount) ui.mount.textContent = "";
  if (ctxRef && ctxRef.audio && ctxRef.audio.resume) {
    try { ctxRef.audio.resume(); } catch (e) { /* audio optional */ }
  }
  try { handle = D.start(id, ui.mount, opts); } catch (e) { handle = null; r.chip.textContent = "unavailable"; }
}

function afterBlock(idx) {
  if (handle && handle.stop) { try { handle.stop(); } catch (e) { /* ignore */ } }
  handle = null;
  if (idx + 1 < plannedIds.length) startBlock(idx + 1);
  else setStep(2);
}

/* ---------------- step 3: the starting point ---------------- */

function buildSummaryStep() {
  var box = h("div", "onb-stepbody");
  var done = measuredCount();

  box.appendChild(field("Step 03 of 03"));
  box.appendChild(h("h2", "onb-h", "Your starting point"));
  box.appendChild(h("p", "onb-sub", done
    ? "Each number is one short block from the calibration, in that drill's own unit."
    : "Nothing was measured, so every drill still starts at its default level."));

  var idx = indexNow();
  var readout = h("div", "onb-readout");
  readout.appendChild(field("baseline index"));
  var line = h("div", "onb-readout-line");
  var value = h("div", "nb-readout onb-readout-v" + (idx == null ? " none" : ""), idx == null ? "--" : "0");
  line.appendChild(value);
  line.appendChild(h("p", "onb-readout-cap", idx == null
    ? "Needs two runs in three drills before it means anything."
    : "How close each drill sits to its own best, averaged across " + (histRecords.length ? "your runs" : "these blocks") + "."));
  readout.appendChild(line);
  box.appendChild(readout);
  if (idx != null && ctxRef.motion && typeof ctxRef.motion.countUp === "function") {
    ctxRef.motion.countUp(value, idx, { duration: 400 });
  } else if (idx != null) {
    value.textContent = String(idx);
  }

  var skills = h("div", "onb-skills");
  for (var i = 0; i < plannedIds.length; i++) {
    (function (id) {
      var d = drillById(id);
      var got = measured[id];
      var row = h("div", "onb-skill");
      row.appendChild(iconEl(d.icon));
      var t = h("div", "onb-skill-t");
      t.appendChild(h("div", "onb-skill-name", d.name));
      t.appendChild(h("div", "onb-skill-trains", d.trains));
      row.appendChild(t);

      var num = h("div", "onb-skill-num");
      if (got) {
        var v = h("span", "nb-readout onb-skill-val", String(got.value));
        v.appendChild(h("span", "onb-skill-unit", d.unit || ""));
        num.appendChild(v);
        var acc = pct(got.accuracy);
        num.appendChild(h("div", "onb-skill-cap", (acc == null ? "" : acc + " correct") + (d.direction === "lower" ? " · lower is faster" : "")));
        if (ctxRef.motion && typeof ctxRef.motion.countUp === "function") {
          /* countUp writes into the node, so read the bare value into a child span. */
          var bare = h("span", null, "0");
          v.textContent = "";
          v.appendChild(bare);
          v.appendChild(h("span", "onb-skill-unit", d.unit || ""));
          ctxRef.motion.countUp(bare, got.value, { duration: 400 });
        }
      } else {
        num.appendChild(h("span", "nb-readout onb-skill-val none", "--"));
        var start = startingLevel(id);
        num.appendChild(h("div", "onb-skill-cap", start == null ? "not measured" : "not measured · starts at " + start + " " + (d.unit || "")));
      }
      row.appendChild(num);
      skills.appendChild(row);
    })(plannedIds[i]);
  }
  box.appendChild(skills);

  /* What these numbers are and are not. This stays: it is the same disclosure as
     the IQ claim on Method, told at the moment the reader first sees a score. Only
     the last sentence, describing how the plan uses them afterwards, went. */
  box.appendChild(h("p", "onb-note", "These are starting points for the drills themselves, measured once, each in its own unit. They are not an intelligence score and they say nothing about ability outside training."));

  var actions = h("div", "onb-actions");
  var dash = h("button", "btn-primary", "Go to dashboard");
  dash.type = "button";
  dash.addEventListener("click", function () { persist(dash, "dashboard"); });
  var train = h("button", "btn-ghost", "Start training");
  train.type = "button";
  train.addEventListener("click", function () { persist(train, "train"); });
  actions.appendChild(dash);
  actions.appendChild(train);
  box.appendChild(actions);

  return box;
}

/* ---------------- persistence and exit ---------------- */

function persist(button, next) {
  if (button) { button.disabled = true; button.textContent = "Saving"; }

  var drillsOut = {};
  for (var id in measured) {
    if (!Object.prototype.hasOwnProperty.call(measured, id)) continue;
    var d = drillById(id);
    drillsOut[id] = {
      value: measured[id].value,
      accuracy: measured[id].accuracy,
      unit: d.unit || "",
      trains: d.trains || ""
    };
  }

  var writes = [];
  if (ctxRef && ctxRef.db) {
    /* A baseline is written only when something was actually measured, and it carries
       how many blocks were planned, so a partial run never reads as a full one. */
    if (measuredCount() > 0) {
      writes.push(ctxRef.db.saveBaseline({
        at: Date.now(),
        goal: goalChosen(),
        complete: measuredCount() >= plannedIds.length,
        planned: plannedIds.length,
        measured: measuredCount(),
        drills: drillsOut
      }));
    }
    if (selectedGoal || validGoal(ctxRef.profile && ctxRef.profile.goal)) {
      var patch = { onboarded_at: new Date().toISOString() };
      if (selectedGoal) patch.goal = selectedGoal;
      writes.push(ctxRef.db.updateProfile(patch));
    }
  }

  Promise.all(writes.map(function (w) {
    return Promise.resolve(w).catch(function () { return null; });
  })).then(function () { go(next); }, function () { go(next); });
}

function finish() {
  if (handle && handle.stop) { try { handle.stop(); } catch (e) { /* ignore */ } }
  handle = null;
  clearTimers();
  persist(null, "dashboard");
}

/* ---------------- timers ---------------- */

function later(fn, ms) {
  var t = setTimeout(fn, ms);
  timers.push(t);
  return t;
}

function clearTimers() {
  for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
  timers = [];
}

/* ---------------- the ticked ruler ---------------- */

function buildRuler() {
  var wrap = h("div", "onb-ruler");
  var track = h("div", "nb-track ruler");
  if (!(ctxRef.motion && typeof ctxRef.motion.reduced === "function" && ctxRef.motion.reduced())) {
    track.classList.add("anim");
  }
  var fill = h("div", "nb-fill");
  track.appendChild(fill);
  wrap.appendChild(track);

  var steps = h("div", "onb-steps");
  for (var i = 0; i < STEP_NAMES.length; i++) {
    (function (n) {
      var on = n === step;
      var b = h("button", "onb-step" + (on ? " on" : (n < step ? " done" : "")));
      b.type = "button";
      if (on) b.setAttribute("aria-current", "step");
      if (n > maxStep) b.disabled = true;
      b.appendChild(h("span", "onb-step-n", num2(n + 1)));
      b.appendChild(h("span", "onb-step-l", STEP_LABELS[n]));
      b.setAttribute("aria-label", "Step " + (n + 1) + " of 3, " + STEP_NAMES[n] + (n > step ? ", not reached yet" : ""));
      b.addEventListener("click", function () { setStep(n); });
      steps.appendChild(b);
    })(i);
  }
  wrap.appendChild(steps);

  requestAnimationFrame(function () {
    if (fill.isConnected) fill.style.left = (step / (STEP_NAMES.length - 1)) * 100 + "%";
  });
  return wrap;
}

/* ---------------- paint and step machine ---------------- */

var ui = { preview: null, mount: null, blockRow: [] };

function refresh() {
  var container = ui.root && ui.root.parentNode;
  seq++;
  if (handle && handle.stop) { try { handle.stop(); } catch (e) { /* ignore */ } }
  handle = null;
  if (!container) return;
  paint(container);
}

function paint(container) {
  container.textContent = "";
  ui.preview = null;
  ui.mount = null;
  ui.blockRow = [];

  var root = h("div", "onb");
  ui.root = root;
  root.appendChild(buildRuler());

  var card = h("div", "card onb-card");
  card.appendChild(step === 0 ? buildGoalStep() : step === 1 ? buildCalStep() : buildSummaryStep());
  root.appendChild(card);

  container.appendChild(root);
  if (step === 0) paintPreview();

  if (!liveEl) liveEl = h("p", "sr");
  liveEl.setAttribute("aria-live", "polite");
  liveEl.textContent = "Step " + (step + 1) + " of 3. " + STEP_NAMES[step] + ".";
  root.appendChild(liveEl);
}

function setStep(n) {
  if (n < 0 || n >= STEP_NAMES.length || n === step) return;
  if (handle && handle.stop) { try { handle.stop(); } catch (e) { /* ignore */ } }
  handle = null;
  clearTimers();
  step = n;
  if (n > maxStep) maxStep = n;
  refresh();
  /* Walking back into the block restarts the first drill rather than leaving the
     rows in a waiting state with nothing running behind them. */
  if (n === 1 && plannedIds.length) startBlock(0);
}

/* ---------------- render ---------------- */

function normRun(r) {
  return {
    drillId: r.drill_id || r.drillId,
    value: Number(r.value),
    unit: r.unit || "",
    t: typeof r.t === "number" ? r.t : (Date.parse(r.created_at || "") || 0),
    meta: r.meta || null
  };
}

export async function render(container, ctx) {
  ctx = ctx || {};
  ctxRef = ctx;
  if (handle && handle.stop) { try { handle.stop(); } catch (e) { /* ignore */ } }
  handle = null;
  clearTimers();
  step = 0;
  maxStep = 0;
  selectedGoal = null;
  plannedIds = [];
  measured = {};
  histRecords = [];
  seq++;
  liveEl = null;

  if (!container) return;
  injectStyles();

  var runs = [];
  if (ctx.db && typeof ctx.db.loadUserData === "function") {
    try {
      var res = await ctx.db.loadUserData();
      if (res && res.ok && res.data && Array.isArray(res.data.runs)) runs = res.data.runs;
    } catch (e) { /* an empty history is the honest default on a first run */ }
  }
  for (var i = 0; i < runs.length; i++) {
    var rec = normRun(runs[i]);
    if (rec.drillId && isFinite(rec.value)) histRecords.push(rec);
  }

  /* A saved goal comes back preselected so returning to setup does not lose it. */
  var saved = ctx.profile && ctx.profile.goal;
  selectedGoal = validGoal(saved) ? saved : null;
  plannedIds = calibrationIds(goalChosen());

  try {
    paint(container);
  } catch (e) {
    /* Never lose the view to a render error: show the exit and let the user go. */
    container.textContent = "";
    var card = h("div", "card");
    card.appendChild(h("h3", null, "Setup did not load"));
    card.appendChild(h("p", "onb-sub", "The setup steps hit an error. Training still works."));
    var b = h("button", "btn-primary", "Go to dashboard");
    b.type = "button";
    b.addEventListener("click", function () { go("dashboard"); });
    var row = h("div", "onb-actions");
    row.appendChild(b);
    card.appendChild(row);
    container.appendChild(card);
  }
}