/* Neuralbase v2 Settings view.
   Renders the settings overlay body into `container`. The shell owns the floating
   trigger and the overlay chrome (scrim, Done button, Escape to close).
   ctx = { user, profile, db, api, audio, themes, motion, navigate }
   Audio and motion preferences are local (the frozen schema has no audio columns);
   theme, display name, daily goal, and visibility persist to the profile. */

var AUDIO_KEY = "cortex.audio";
var MOTION_KEY = "cortex.motion.reduce";
/* Quiet hours and the last fired reminder stay on this device. The frozen
   schema has no columns for them, and they should not follow a profile to a
   device where they mean a different local time. */
var REMINDER_KEY = "cortex.reminder";
var REMINDER_TICK_MS = 30000;
var PLAN_CACHE_KEY = "cortex.cache.data";
var STYLE_ID = "nb-settings-styles";

var GOAL_LABELS = { focus: "Focus", memory: "Memory", study: "Study", fresh: "Fresh" };
var GOAL_REASONS = {
  focus: "Your day leans on speed and switching, with fast reactions and quick rule changes.",
  memory: "Your day leans on the recall drills, holding items and finding them again.",
  study: "Your day leans on reasoning, arithmetic, and spaced review of new material.",
  fresh: "Your day spreads evenly, so every drill gets a turn."
};

/* One goal, one plain sentence about what it changes. */
function goalReason(g) { return GOAL_REASONS[g] || GOAL_REASONS.fresh; }

/* Theme tokens only, so all five themes pick these rows up. */
function injectStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  var s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = [
    ".set-field{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);margin-bottom:7px}",
    ".set-goals{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}",
    ".set-goal{font-family:var(--mono);font-size:10px;letter-spacing:.07em;text-transform:uppercase;padding:6px 9px;border-radius:8px;background:transparent;border:1px solid var(--line2);color:var(--muted);transition:border-color .15s ease,color .15s ease}",
    ".set-goal:hover{border-color:var(--lime-edge);color:var(--ink)}",
    ".set-goal[aria-pressed=\"true\"]{color:var(--lime);border-color:var(--lime-edge);background:var(--lime-soft)}",
    ".set-reason{font-size:13px;color:var(--muted);padding:var(--set-in) 0 0;max-width:54ch;margin:0}",
    ".set-count{margin:0;font-size:14px;color:var(--ink)}",
    ".set-time{width:82px;max-width:100%;font-family:var(--mono);font-variant-numeric:tabular-nums;background:var(--panel2);color:var(--ink);border:1px solid var(--line2);border-radius:8px;padding:6px 8px}",
    /* One rhythm for the overlay: --set-sec between cards, --set-in inside a card.
       The rule above "Shared profile" reads the same section gap as the others, so
       that block no longer sits 8px tighter than the rest. */
    /* Wider than the other centered columns. The page is three columns of rows,
       and at 780px each column was too narrow to hold a label and its control
       on one line, so every row wrapped and the page grew taller still. */
    ".set-view{--set-sec:16px;--set-in:12px;max-width:1320px}",
    ".set-view .set-note{margin-top:var(--set-in)}",
    ".set-divider{height:1px;background:var(--line);margin:var(--set-sec) 0 0}",

    /* Three groups. Each column is headed once, in the mono label style every
       other surface uses, so a reader can jump to the group they came for. */
    ".set-grid{display:grid;grid-template-columns:1fr;gap:var(--set-sec) var(--gap-5);align-items:start}",
    "@media (min-width:1080px){.set-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}",
    "@media (max-width:1079px){.set-group+.set-group{margin-top:var(--gap-5)}}",
    ".set-group-l{margin:0 0 10px;font-family:var(--mono);font-size:10px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}",

    /* The card that answers the question the page was opened for. The accent edge
       is the same one the rail uses for the current page, so it reads as
       "you are here" rather than as another kind of card. */
    ".set-lead{border-color:var(--lime-edge)}",
    ".set-lead>h3{font-size:14px}",
    ".set-bio{width:260px;max-width:100%;background:var(--panel2);color:var(--ink);border:1px solid var(--line2);border-radius:8px;padding:7px 9px;font:inherit;resize:vertical;min-height:64px}",
    ".set-times{display:flex;align-items:center;gap:7px;flex-wrap:wrap;justify-content:flex-end}",
    ".set-err{font-size:12px;color:var(--warn);text-align:right}",
    ".set-block{padding:14px 0;border-bottom:1px solid var(--line)}",
    ".set-block:last-child{border-bottom:0}",
    "@media (max-width:560px){.set-goals{justify-content:flex-start}}"
  ].join("");
  document.head.appendChild(s);
}

/* Swatch previews. Mirrors the token sets in styles.css so a tile can paint its
   own theme without applying it first. */
var THEME_COLORS = {
  graphite:  { bg: "#14161A", panel: "#1C1F26", accent: "#B6E24A" },
  carbon:    { bg: "#000000", panel: "#0C0D0F", accent: "#C6F24E" },
  porcelain: { bg: "#F4F5F2", panel: "#FFFFFF", accent: "#3F6B00" },
  midnight:  { bg: "#0E1524", panel: "#151E31", accent: "#8AB4FF" },
  ember:     { bg: "#17120F", panel: "#201915", accent: "#FF9E4F" }
};

function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function readJSON(key, fallback) {
  try {
    var raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* degrade */ }
}

function systemReduced() {
  try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
  catch (e) { return false; }
}

/* "HH:MM" to minutes after midnight, or null when the string is not a clock
   time. Deliberately strict, so 24:00 and 9:60 are rejected rather than clamped. */
function hmMinutes(v) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(v == null ? "" : v).trim());
  if (!m) return null;
  var h = +m[1], mm = +m[2];
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

function hmText(mins) {
  var h = Math.floor(mins / 60), m = mins % 60;
  return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
}

/* Days since the epoch in local time, so a day boundary matches the user's
   midnight rather than UTC's. */
function localDayIndex(t) {
  var d = new Date(t);
  return Math.floor((t - d.getTimezoneOffset() * 60000) / 86400000);
}

/* Quiet hours may run past midnight, so a window that wraps is two ranges. */
function inQuietMinutes(mins, start, end) {
  if (start < end) return mins >= start && mins < end;
  return mins >= start || mins < end;
}

/* The reminder decision, pure. Everything it needs arrives in the argument and
   one boolean leaves, so it can be read and tested without a clock, a DOM or a
   storage layer.
   ponytail: there is no service worker and no push backend, so the only caller
   is the tab that is open right now. Delete this with the Reminders section. */
export function reminderDue(o) {
  var opts = o || {};
  var now = typeof opts.now === "number" && isFinite(opts.now) ? opts.now : Date.now();
  var at = hmMinutes(opts.reminderTime);
  if (at === null) return false;
  var d = new Date(now);
  if (isNaN(d.getTime())) return false;
  var mins = d.getHours() * 60 + d.getMinutes();
  /* Fires on the reminder minute and stays catchable for two hours, so a tab
     opened late still gets one. */
  if (mins < at || mins > at + 120) return false;
  var q = opts.quietHours || {};
  var qs = hmMinutes(q.start), qe = hmMinutes(q.end);
  if (qs !== null && qe !== null && qs !== qe && inQuietMinutes(mins, qs, qe)) return false;
  var last = typeof opts.lastAt === "number" && isFinite(opts.lastAt) ? opts.lastAt : 0;
  if (last && localDayIndex(last) === localDayIndex(now)) return false;
  return true;
}

/* Module state for the reminder checker. The loop outlives the settings view on
   purpose: a reminder is worth setting once, then it should keep working while
   the app is open. */
var reminderTimer = null;
var settingsCtx = null;

function reminderConfig() {
  var local = readJSON(REMINDER_KEY, {}) || {};
  var p = (settingsCtx && settingsCtx.profile) || {};
  return {
    reminderTime: p.reminder_time || "",
    quietHours: { start: local.quietStart || "", end: local.quietEnd || "" },
    lastAt: Number(local.lastAt) || 0
  };
}

function checkReminder() {
  var c = reminderConfig();
  if (!c.reminderTime) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  var now = Date.now();
  if (!reminderDue({ now: now, reminderTime: c.reminderTime, quietHours: c.quietHours, lastAt: c.lastAt })) return;
  try {
    var n = new Notification("Neuralbase", { body: "Today's set is ready when you are.", tag: "nb-reminder" });
    if (n && n.close) setTimeout(function () { try { n.close(); } catch (e) { /* degrade */ } }, 15000);
  } catch (e) { return; }
  writeJSON(REMINDER_KEY, { quietStart: c.quietHours.start, quietEnd: c.quietHours.end, lastAt: now });
}

function ensureReminderLoop() {
  if (reminderTimer) return;
  reminderTimer = setInterval(checkReminder, REMINDER_TICK_MS);
  checkReminder();
}

/* A settings card: an h3 title over a .set-list of rows.
   `lead` marks the card that answers the question this page is opened for. It
   gets the accent edge, so the eye lands on it before the rest. */
function section(title, lead) {
  var card = el("section", "card" + (lead ? " set-lead" : ""));
  card.appendChild(el("h3", null, title));
  var body = el("div", "set-list");
  body.style.marginTop = "4px";
  card.appendChild(body);
  return { el: card, body: body };
}

/* A .set-row with a label/caption on the left and a control slot on the right. */
function row(label, cap) {
  var r = el("div", "set-row");
  var info = el("div", "set-info");
  info.appendChild(el("span", "set-label", label));
  if (cap) info.appendChild(el("span", "set-cap", cap));
  r.appendChild(info);
  var right = el("div");
  right.style.cssText = "display:flex;align-items:center;gap:10px;";
  r.appendChild(right);
  return { el: r, right: right };
}

function toggleSwitch(checked, label, onChange) {
  var b = el("button", "switch");
  b.type = "button";
  b.setAttribute("role", "switch");
  b.setAttribute("aria-checked", checked ? "true" : "false");
  b.setAttribute("aria-label", label);
  b.addEventListener("click", function () {
    var next = b.getAttribute("aria-checked") !== "true";
    b.setAttribute("aria-checked", next ? "true" : "false");
    onChange(next);
  });
  return b;
}

export function render(container, ctx) {
  if (!container) return;
  ctx = ctx || {};
  var db = ctx.db || {};
  var audio = ctx.audio || {};
  var themes = ctx.themes || {};
  var motion = ctx.motion || {};
  var profile = ctx.profile || {};
  var user = ctx.user || {};
  var navigate = typeof ctx.navigate === "function" ? ctx.navigate : function () {};

  container.innerHTML = "";
  injectStyles();
  settingsCtx = ctx;

  var live = el("div", "sr");
  live.setAttribute("aria-live", "polite");
  function say(msg) { live.textContent = msg; }

  function saveProfile(patch) {
    if (typeof db.updateProfile !== "function") {
      say("Profile storage is unavailable.");
      return Promise.resolve({ ok: false, error: "unavailable" });
    }
    return Promise.resolve(db.updateProfile(patch)).then(function (r) {
      if (r && r.ok === false) say("Could not save: " + (r.error || "unknown error"));
      return r;
    }).catch(function (e) {
      say("Could not save: " + (e && e.message ? e.message : e));
      return { ok: false };
    });
  }

  /* Three groups, so the page reads as three decisions rather than seven
     identical stacks. Each group is a labelled column at desktop width and a
     labelled stack at phone width, and the groups go in the order a person
     actually arrives with: how the app trains, how it looks and sounds, then
     the account. */
  var groups = [];
  function group(label) {
    var g = { label: label, sections: [] };
    groups.push(g);
    return g;
  }
  var gTrain = group("How you train");
  var gApp = group("Look and sound");
  var gYou = group("Your account");

  /* Every section names the group it belongs to. The group decides the column it
     lands in and how far down the page it sits, which is the hierarchy the page
     was missing as a flat stack of identical cards. */
  function push(title, group, lead) {
    var s = section(title, lead);
    group.sections.push(s);
    return s;
  }

  /* ---------- Appearance ---------- */
  var appearance = push("Appearance", gApp);
  var themeRow = row("Theme", "Change the look of the app.");
  var swatches = el("div");
  swatches.style.cssText = "display:flex;gap:10px;flex-wrap:wrap;";
  var list = (typeof themes.list === "function" ? themes.list() : []) || [];
  var current = (typeof themes.current === "function" ? themes.current() : (profile.theme || "graphite")) || "graphite";

  list.forEach(function (t) {
    var colors = THEME_COLORS[t.name] || THEME_COLORS.graphite;
    var btn = el("button", "theme-swatch");
    btn.type = "button";
    btn.setAttribute("data-theme", t.name);
    btn.setAttribute("aria-label", t.label + " theme");
    btn.setAttribute("aria-pressed", t.name === current ? "true" : "false");
    btn.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:6px;background:transparent;border:0;padding:0;";

    var tile = el("span");
    tile.style.cssText = "position:relative;display:block;width:46px;height:46px;border-radius:var(--r);" +
      "border:1px solid " + (t.name === current ? "var(--lime)" : "var(--line2)") + ";background:" + colors.bg +
      ";overflow:hidden;box-shadow:" + (t.name === current ? "0 0 0 2px var(--lime-soft)" : "none") + ";";
    var panel = el("span");
    panel.style.cssText = "position:absolute;left:6px;right:6px;top:8px;height:12px;border-radius:8px;background:" + colors.panel + ";";
    var accent = el("span");
    accent.style.cssText = "position:absolute;left:6px;bottom:8px;width:16px;height:6px;border-radius:8px;background:" + colors.accent + ";";
    tile.appendChild(panel);
    tile.appendChild(accent);
    btn.appendChild(tile);
    btn.appendChild(el("span", "cap", t.label));

    btn.addEventListener("click", function () {
      var name = typeof themes.apply === "function" ? themes.apply(t.name) : t.name;
      var kids = swatches.children;
      for (var i = 0; i < kids.length; i++) {
        var on = kids[i] === btn;
        kids[i].setAttribute("aria-pressed", on ? "true" : "false");
        var tl = kids[i].firstChild;
        if (tl) {
          tl.style.borderColor = on ? "var(--lime)" : "var(--line2)";
          tl.style.boxShadow = on ? "0 0 0 2px var(--lime-soft)" : "none";
        }
      }
      saveProfile({ theme: name }).then(function () { say(t.label + " theme applied."); });
    });
    swatches.appendChild(btn);
  });
  themeRow.right.appendChild(swatches);
  appearance.body.appendChild(themeRow.el);

  /* ---------- Sound ---------- */
  var prefs = Object.assign({ volume: 0.6, muted: false, sfx: true, voice: true }, readJSON(AUDIO_KEY, {}));
  function applyAudio() {
    if (typeof audio.setVolume === "function") audio.setVolume(prefs.volume);
    if (typeof audio.setMuted === "function") audio.setMuted(prefs.muted);
    if (typeof audio.setSfx === "function") audio.setSfx(prefs.sfx);
    if (typeof audio.setVoice === "function") audio.setVoice(prefs.voice);
  }
  function saveAudio() { writeJSON(AUDIO_KEY, prefs); applyAudio(); }
  applyAudio();

  var sound = push("Sound", gApp);
  var muteRow = row("Mute all", "Silences every cue, overrides the toggles below.");
  muteRow.right.appendChild(toggleSwitch(prefs.muted, "Mute all", function (on) {
    prefs.muted = on;
    saveAudio();
    say(on ? "Sound muted." : "Sound on.");
  }));
  sound.body.appendChild(muteRow.el);

  var sfxRow = row("Sound effects", "Short cues on correct, incorrect, and complete.");
  sfxRow.right.appendChild(toggleSwitch(prefs.sfx, "Sound effects", function (on) {
    prefs.sfx = on;
    saveAudio();
    say("Sound effects " + (on ? "on." : "off."));
  }));
  sound.body.appendChild(sfxRow.el);

  var voiceRow = row("Voice cues", "Spoken letters and rule cues.");
  voiceRow.right.appendChild(toggleSwitch(prefs.voice, "Voice cues", function (on) {
    prefs.voice = on;
    saveAudio();
    say("Voice cues " + (on ? "on." : "off."));
  }));
  sound.body.appendChild(voiceRow.el);

  var volRow = row("Volume", "How loud cues play.");
  var vol = el("input");
  vol.type = "range";
  vol.min = "0";
  vol.max = "100";
  vol.step = "5";
  vol.value = String(Math.round(prefs.volume * 100));
  vol.setAttribute("aria-label", "Volume");
  vol.setAttribute("aria-valuetext", vol.value + " percent");
  vol.style.cssText = "width:150px;accent-color:var(--lime);";
  var pct = el("span", "mono", vol.value + "%");
  pct.style.color = "var(--muted)";
  vol.addEventListener("input", function () {
    prefs.volume = Number(vol.value) / 100;
    pct.textContent = vol.value + "%";
    vol.setAttribute("aria-valuetext", vol.value + " percent");
    if (typeof audio.setVolume === "function") audio.setVolume(prefs.volume);
  });
  vol.addEventListener("change", function () { writeJSON(AUDIO_KEY, prefs); });
  volRow.right.appendChild(vol);
  volRow.right.appendChild(pct);
  sound.body.appendChild(volRow.el);

  /* ---------- Motion ---------- */
  var motionSection = push("Motion", gApp);
  var explicit = null;
  try { explicit = localStorage.getItem(MOTION_KEY); } catch (e) { explicit = null; }
  var lockedToSystem = systemReduced() && explicit === null;
  var reducedNow = typeof motion.reduced === "function" ? !!motion.reduced() : lockedToSystem;
  var motionRow = row(
    "Reduce motion",
    lockedToSystem ? "On, following your system setting." : "Trim animation to the essentials."
  );
  var motionSwitch = toggleSwitch(reducedNow, "Reduce motion", function (on) {
    if (typeof motion.setReduced === "function") motion.setReduced(on);
    say("Reduced motion " + (on ? "on." : "off."));
  });
  if (lockedToSystem) motionSwitch.disabled = true;
  motionRow.right.appendChild(motionSwitch);
  motionSection.body.appendChild(motionRow.el);

  /* ---------- Training ---------- */
  var training = push("Training", gTrain, true);

  /* Reopen setup. Boot sends a first run here, but there has to be a way back for
     someone who skipped it or wants to recalibrate once the history has grown. */
  var setupRow = row("Setup and calibration", "Goal, then a short block per drill to set a starting point.");
  var setupBtn = el("button", "btn-ghost", "Run setup");
  setupBtn.type = "button";
  setupBtn.addEventListener("click", function () { navigate("onboarding"); });
  setupRow.right.appendChild(setupBtn);
  training.body.appendChild(setupRow.el);

  var goal = Number(profile.daily_goal);
  if (!isFinite(goal) || goal < 1) goal = 3;
  goal = Math.max(1, Math.min(10, Math.round(goal)));
  var goalRow = row("Daily goal", "Sessions per day. Three is a good start.");
  var stepper = el("div");
  stepper.style.cssText = "display:flex;align-items:center;gap:10px;";
  var minus = el("button", "btn-ghost", "-");
  minus.type = "button";
  minus.setAttribute("aria-label", "Decrease daily goal");
  var goalVal = el("span", "mono", String(goal));
  goalVal.style.cssText = "min-width:22px;text-align:center;font-size:16px;";
  goalVal.setAttribute("aria-live", "polite");
  var plus = el("button", "btn-ghost", "+");
  plus.type = "button";
  plus.setAttribute("aria-label", "Increase daily goal");

  function setGoal(next) {
    goal = Math.max(1, Math.min(10, next));
    goalVal.textContent = String(goal);
    minus.disabled = goal <= 1;
    plus.disabled = goal >= 10;
    saveProfile({ daily_goal: goal }).then(function () { say("Daily goal set to " + goal + "."); });
    renderPlan();
  }
  minus.addEventListener("click", function () { setGoal(goal - 1); });
  plus.addEventListener("click", function () { setGoal(goal + 1); });
  minus.disabled = goal <= 1;
  plus.disabled = goal >= 10;
  stepper.appendChild(minus);
  stepper.appendChild(goalVal);
  stepper.appendChild(plus);
  goalRow.right.appendChild(stepper);
  training.body.appendChild(goalRow.el);

  /* ---------- Training: what the goal is for ---------- */
  /* The plan readout is the point of the picker. A goal you cannot see working
     is a preference with no consequence, so the day's mix is printed under it
     and repainted the moment the goal changes. */
  var Store = globalThis.Store || {};
  var Engine = globalThis.Engine || {};
  var allIds = Engine.ALL_DRILLS ? Engine.ALL_DRILLS.slice()
    : ((globalThis.Content && globalThis.Content.DRILLS) || []).map(function (d) { return d.id; });
  var pickedGoal = (Store.GOALS || []).indexOf(profile.goal) !== -1 ? profile.goal : "fresh";

  function drillName(id) {
    var D = (globalThis.Content && globalThis.Content.DRILLS) || [];
    for (var i = 0; i < D.length; i++) if (D[i].id === id) return D[i];
    return { name: id, trains: "" };
  }

  /* Runs from the local cache, so the plan reacts to real staleness and real
     weakness instead of showing the same three names every day. */
  function planState() {
    var cache = readJSON(PLAN_CACHE_KEY, null);
    var runs = (cache && cache.runs) || [];
    var records = [];
    for (var i = 0; i < runs.length; i++) {
      var r = runs[i] || {};
      var v = Number(r.value);
      var id = r.drill_id || r.drillId;
      if (!id || !isFinite(v)) continue;
      records.push({ drillId: id, value: v, unit: r.unit || "", t: Date.parse(r.created_at || r.createdAt || "") || 0, meta: null });
    }
    return { records: records, goal: pickedGoal };
  }

  var pickRow = row("Training goal", "Sets which drills your daily plan picks.");
  var goalSet = el("div", "set-goals");
  goalSet.setAttribute("role", "group");
  goalSet.setAttribute("aria-label", "Training goal");
  var goalBtns = {};
  (Store.GOALS || ["fresh"]).forEach(function (g) {
    var b = el("button", "set-goal", GOAL_LABELS[g] || g);
    b.type = "button";
    b.setAttribute("data-goal", g);
    b.setAttribute("aria-pressed", g === pickedGoal ? "true" : "false");
    b.addEventListener("click", function () { pickGoal(g); });
    goalBtns[g] = b;
    goalSet.appendChild(b);
  });
  pickRow.right.appendChild(goalSet);
  training.body.appendChild(pickRow.el);

  var goalBlock = el("div", "set-block");
  var reason = el("p", "set-reason", goalReason(pickedGoal));
  goalBlock.appendChild(reason);
  var planWrap = el("div");
  planWrap.style.marginTop = "12px";
  planWrap.appendChild(el("span", "set-field", "Today's set"));
  var planCount = el("p", "set-count");
  planWrap.appendChild(planCount);
  var planCap = el("p", "cap");
  planCap.style.margin = "6px 0 0";
  planWrap.appendChild(planCap);
  goalBlock.appendChild(planWrap);
  training.body.appendChild(goalBlock);

  /* The plan readout is the point of the picker, so it stays, but as one line:
     a count of today's drills and a plain note about what the goal changes. The
     drill names live on the dashboard and the circuit, not here. */
  function renderPlan() {
    var ids = typeof Store.dailyPlan === "function"
      ? Store.dailyPlan(planState(), localDayIndex(Date.now()), allIds, goal)
      : [];
    var reachable = allIds.filter(function (id) {
      return true;
    }).length;
    planCount.textContent = ids.length + (ids.length === 1 ? " drill today." : " drills today.");
    /* On Pro the row caption already says the goal picks the drills, so a second
       sentence saying that is noise. On Free the caveat earns its place: it is
       the only thing explaining why pressing these buttons changes nothing. */
    planCap.textContent = reachable < allIds.length
      ? "Free includes " + reachable + " drills, so the set stays the same each day."
      : "";
    planCap.style.display = planCap.textContent ? "" : "none";
    /* The group's accessible name still resolves today's set, with the drill
       names a screen reader can hear even though they are not printed on screen. */
    var names = ids.map(function (id) { return drillName(id).name; });
    goalSet.setAttribute("aria-label", "Training goal. Today's set: " +
      (names.length ? names.join(", ") : "no drills on your plan") + ".");
  }

  function pickGoal(g) {
    pickedGoal = g;
    Object.keys(goalBtns).forEach(function (k) {
      goalBtns[k].setAttribute("aria-pressed", k === g ? "true" : "false");
    });
    reason.textContent = goalReason(g);
    renderPlan();
    /* Announced on the group itself: the plan is a visible change, and the
       polite announcement carries it for anyone not watching the screen. */
    goalSet.setAttribute("aria-live", "polite");
    saveProfile({ goal: g }).then(function (r) {
      if (r && r.ok === false) return;
      profile.goal = g;
      say("Training goal set to " + (GOAL_LABELS[g] || g) + ".");
    });
  }

  renderPlan();

  /* ---------- Reminders ---------- */
  /* Honest ceiling, stated in the section itself: there is no service worker
     and no push backend here, so the only thing a reminder can do is appear in
     a tab that is open. Everything below is local. */
  var reminders = push("Reminders", gTrain);
  var remLocal = readJSON(REMINDER_KEY, {}) || {};

  var timeRow = row("Reminder time", "");
  var timeInfo = timeRow.el.querySelector(".set-info");
  var timeCap = el("span", "set-cap", "A 24 hour time, like 09:00. One reminder a day at most.");
  timeCap.id = "reminder-time-help";
  timeInfo.appendChild(timeCap);
  var timeWrap = el("div");
  timeWrap.style.cssText = "display:flex;flex-direction:column;gap:4px;align-items:flex-end;";
  var timeInput = el("input", "set-time");
  /* A text input, not type="time". A native time field silently discards
     anything malformed, so a person who types 9:5 and tabs away is told nothing
     at all. This one keeps what they typed and answers it. */
  timeInput.type = "text";
  timeInput.inputMode = "numeric";
  timeInput.maxLength = 5;
  timeInput.placeholder = "09:00";
  timeInput.setAttribute("aria-label", "Reminder time");
  timeInput.setAttribute("aria-describedby", "reminder-time-help");
  var storedTime = profile.reminder_time || "";
  timeInput.value = hmMinutes(storedTime) === null ? "" : hmText(hmMinutes(storedTime));
  var timeErr = el("span", "set-err");
  timeErr.hidden = true;
  var lastLine = el("span", "cap");
  lastLine.style.textAlign = "right";

  function paintLast() {
    var last = Number(remLocal.lastAt) || 0;
    if (!last) { lastLine.textContent = "No reminder yet."; return; }
    var d = new Date(last);
    var at = hmText(d.getHours() * 60 + d.getMinutes());
    var today = localDayIndex(last) === localDayIndex(Date.now());
    lastLine.textContent = today ? "Last reminder today at " + at : "Last reminder at " + at;
  }
  paintLast();

  function commitTime() {
    var v = String(timeInput.value || "").trim();
    if (hmMinutes(v) === null) {
      timeErr.textContent = v ? "That is not a time. Use 24 hours, like 09:00." : "Leave it empty to turn reminders off.";
      timeErr.hidden = false;
      say(timeErr.textContent);
      return;
    }
    timeErr.hidden = true;
    var norm = hmText(hmMinutes(v));
    timeInput.value = norm;
    saveProfile({ reminder_time: norm }).then(function (r) {
      if (r && r.ok === false) return;
      profile.reminder_time = norm;
      say("Reminder time set to " + norm + ".");
    });
  }
  timeInput.addEventListener("change", commitTime);
  timeInput.addEventListener("blur", commitTime);
  timeWrap.appendChild(timeInput);
  timeWrap.appendChild(timeErr);
  timeWrap.appendChild(lastLine);
  timeRow.right.appendChild(timeWrap);
  reminders.body.appendChild(timeRow.el);

  function notifState() {
    if (typeof Notification === "undefined") return "unsupported";
    return Notification.permission;
  }

  var notifyRow = row("Browser notifications", "");
  var notifyBtn = el("button", "btn-ghost");
  notifyBtn.type = "button";
  var notifyWrap = el("div");
  notifyWrap.style.cssText = "display:flex;flex-direction:column;gap:4px;align-items:flex-end;";
  var notifyCap = el("span", "cap");
  notifyCap.style.textAlign = "right";

  function paintNotify() {
    var p = notifState();
    notifyCap.style.color = "";
    if (p === "unsupported") {
      notifyBtn.textContent = "Not available";
      notifyBtn.disabled = true;
      notifyCap.style.color = "var(--warn)";
      notifyCap.textContent = "This browser cannot show notifications.";
      return;
    }
    if (p === "granted") {
      notifyBtn.textContent = "Allowed";
      notifyBtn.disabled = true;
      notifyCap.textContent = "Reminders can show while a tab is open.";
      return;
    }
    if (p === "denied") {
      notifyBtn.textContent = "Blocked";
      notifyBtn.disabled = true;
      notifyCap.style.color = "var(--warn)";
      notifyCap.textContent = "This browser blocks notifications. Allow them in site settings.";
      return;
    }
    notifyBtn.textContent = "Allow reminders";
    notifyBtn.disabled = false;
    notifyCap.textContent = "The browser asks once. Nothing is sent anywhere.";
  }
  paintNotify();

  notifyBtn.addEventListener("click", function () {
    if (notifState() !== "default") return;
    try {
      var asked = Notification.requestPermission();
      if (asked && typeof asked.then === "function") {
        asked.then(function () { paintNotify(); say(notifyResult()); }, function () { paintNotify(); say(notifyResult()); });
      } else {
        setTimeout(function () { paintNotify(); say(notifyResult()); }, 200);
      }
    } catch (e) { paintNotify(); say(notifyResult()); }
  });
  function notifyResult() {
    var p = notifState();
    if (p === "granted") return "Reminders allowed.";
    if (p === "denied") return "This browser blocked reminders.";
    return "No permission, so reminders stay off.";
  }
  notifyWrap.appendChild(notifyBtn);
  notifyWrap.appendChild(notifyCap);
  notifyRow.right.appendChild(notifyWrap);
  reminders.body.appendChild(notifyRow.el);

  var quietRow = row("Quiet hours", "No reminders between these times.");
  var quietWrap = el("div");
  quietWrap.style.cssText = "display:flex;flex-direction:column;gap:4px;align-items:flex-end;";
  var quietSet = el("div", "set-times");
  var quietStart = el("input", "set-time");
  quietStart.type = "text";
  quietStart.inputMode = "numeric";
  quietStart.maxLength = 5;
  quietStart.placeholder = "22:00";
  quietStart.setAttribute("aria-label", "Quiet hours start");
  quietStart.value = hmMinutes(remLocal.quietStart) === null ? "" : hmText(hmMinutes(remLocal.quietStart));
  var quietEnd = el("input", "set-time");
  quietEnd.type = "text";
  quietEnd.inputMode = "numeric";
  quietEnd.maxLength = 5;
  quietEnd.placeholder = "07:00";
  quietEnd.setAttribute("aria-label", "Quiet hours end");
  quietEnd.value = hmMinutes(remLocal.quietEnd) === null ? "" : hmText(hmMinutes(remLocal.quietEnd));
  var quietErr = el("span", "set-err");
  quietErr.hidden = true;
  quietSet.appendChild(quietStart);
  quietSet.appendChild(el("span", "cap", "to"));
  quietSet.appendChild(quietEnd);
  quietWrap.appendChild(quietSet);
  quietWrap.appendChild(quietErr);
  quietRow.right.appendChild(quietWrap);
  reminders.body.appendChild(quietRow.el);

  function saveQuiet() {
    var a = String(quietStart.value || "").trim();
    var b = String(quietEnd.value || "").trim();
    var pair = (a === "" && b === "");
    if (!pair && (hmMinutes(a) === null || hmMinutes(b) === null)) {
      quietErr.textContent = "Both times are needed, like 22:00 to 07:00.";
      quietErr.hidden = false;
      say(quietErr.textContent);
      return;
    }
    if (!pair && a === b) {
      quietErr.textContent = "Those times are the same. That would silence every reminder.";
      quietErr.hidden = false;
      say(quietErr.textContent);
      return;
    }
    quietErr.hidden = true;
    var sa = pair ? "" : hmText(hmMinutes(a));
    var sb = pair ? "" : hmText(hmMinutes(b));
    quietStart.value = sa;
    quietEnd.value = sb;
    remLocal.quietStart = sa;
    remLocal.quietEnd = sb;
    writeJSON(REMINDER_KEY, remLocal);
    say(pair ? "Quiet hours cleared." : "Quiet hours set from " + sa + " to " + sb + ".");
  }
  quietStart.addEventListener("change", saveQuiet);
  quietEnd.addEventListener("change", saveQuiet);
  quietEnd.addEventListener("blur", saveQuiet);

  var remNote = el("p", "set-note",
    "A reminder only shows in a Neuralbase tab that is open, and only after you set a time. " +
    "There is no background service and no push server, so a closed tab gets nothing.");
  reminders.el.appendChild(remNote);

  /* ---------- Account ---------- */
  var account = push("Account", gYou);

  var nameRow = row("Display name", "2 to 24 characters. Shown on leaderboards.");
  var nameWrap = el("div");
  nameWrap.style.cssText = "display:flex;flex-direction:column;gap:4px;align-items:flex-end;";
  var nameInput = el("input");
  nameInput.type = "text";
  nameInput.maxLength = 24;
  nameInput.value = profile.display_name ||
    (user.user_metadata && user.user_metadata.display_name) || "";
  nameInput.setAttribute("aria-label", "Display name");
  nameInput.style.cssText = "background:var(--panel2);color:var(--ink);border:1px solid var(--line2);" +
    "border-radius:8px;padding:7px 9px;font:inherit;width:190px;";
  var nameErr = el("span", "cap");
  nameErr.style.color = "var(--warn)";
  nameErr.hidden = true;

  function commitName() {
    var v = nameInput.value.trim();
    if (v.length < 2 || v.length > 24) {
      nameErr.textContent = "Use 2 to 24 characters.";
      nameErr.hidden = false;
      return;
    }
    nameErr.hidden = true;
    if (v === (profile.display_name || "")) return;
    saveProfile({ display_name: v }).then(function (r) {
      if (!r || r.ok !== false) {
        profile.display_name = v;
        say("Display name saved.");
      }
    });
  }
  nameInput.addEventListener("blur", commitName);
  nameInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); nameInput.blur(); }
  });
  nameWrap.appendChild(nameInput);
  nameWrap.appendChild(nameErr);
  nameRow.right.appendChild(nameWrap);
  account.body.appendChild(nameRow.el);

  var emailRow = row("Email", "Managed by your sign-in provider.");
  var emailInput = el("input");
  emailInput.type = "email";
  emailInput.value = user.email || "";
  emailInput.readOnly = true;
  emailInput.setAttribute("aria-label", "Email, read only");
  emailInput.style.cssText = "background:var(--panel2);color:var(--muted);border:1px solid var(--line);" +
    "border-radius:8px;padding:7px 9px;font:inherit;width:210px;";
  emailRow.right.appendChild(emailInput);
  account.body.appendChild(emailRow.el);

  var visRow = row("Visibility", "How you appear on leaderboards.");
  var visSel = el("select");
  visSel.setAttribute("aria-label", "Leaderboard visibility");
  visSel.style.cssText = "background:var(--panel2);color:var(--ink);border:1px solid var(--line2);" +
    "border-radius:8px;padding:7px 9px;font:inherit;";
  [["name", "Your name"], ["anon", "Anonymous handle"]].forEach(function (o) {
    var opt = el("option", null, o[1]);
    opt.value = o[0];
    visSel.appendChild(opt);
  });
  visSel.value = profile.visibility === "anon" ? "anon" : "name";
  visSel.addEventListener("change", function () {
    saveProfile({ visibility: visSel.value }).then(function () {
      say(visSel.value === "anon" ? "Shown as an anonymous handle." : "Shown as your name.");
    });
  });
  visRow.right.appendChild(visSel);
  account.body.appendChild(visRow.el);

  var signOutRow = row("Sign out", "End this session on this device.");
  var signOutBtn = el("button", "btn-ghost", "Sign out");
  signOutBtn.type = "button";
  signOutBtn.addEventListener("click", function () {
    var fn = (ctx.auth && typeof ctx.auth.signOut === "function" && ctx.auth.signOut) ||
      (typeof ctx.signOut === "function" && ctx.signOut) ||
      (db && typeof db.signOut === "function" && db.signOut) || null;
    if (!fn) { say("Sign out is not available."); return; }
    signOutBtn.disabled = true;
    Promise.resolve(fn()).then(function (r) {
      signOutBtn.disabled = false;
      if (r && r.ok === false) { say("Could not sign out."); return; }
      navigate("landing");
    }).catch(function () {
      signOutBtn.disabled = false;
      say("Could not sign out.");
    });
  });
  signOutRow.right.appendChild(signOutBtn);
  account.body.appendChild(signOutRow.el);

  /* ---------- Shared profile ---------- */
  /* What another person sees when they open this profile from a leaderboard.
     These toggles are enforced server-side: profile_public() returns null for
     anything switched off, so this is a real withholding and not a cosmetic hide. */
  var privacy = push("Shared profile", gYou);
  privacy.divider = true;

  var privacyNote = el("p", "set-note",
    "What other people see when they open your profile from a leaderboard. " +
    "Anything switched off is withheld by the server, not just hidden on screen.");
  privacyNote.style.margin = "0 0 4px";
  privacy.body.appendChild(privacyNote);

  function savePrivacy(patch) {
    if (typeof db.saveProfilePrivacy !== "function") {
      say("Profile privacy is unavailable.");
      return Promise.resolve({ ok: false });
    }
    return Promise.resolve(db.saveProfilePrivacy(patch)).then(function (r) {
      if (r && r.ok === false) say("Could not save: " + (r.error || "unknown error"));
      return r;
    }).catch(function () { say("Could not save."); return { ok: false }; });
  }

  function privacyToggle(key, label, cap, dflt) {
    var on = profile[key] == null ? dflt : profile[key] === true;
    var r = row(label, cap);
    r.right.appendChild(toggleSwitch(on, label, function (next) {
      profile[key] = next;
      savePrivacy({ [key]: next }).then(function (res) {
        if (!res || res.ok !== false) say(label + (next ? " is now shared." : " is now private."));
      });
    }));
    privacy.body.appendChild(r.el);
  }

  privacyToggle("show_avatar", "Profile picture", "Your avatar, if you have one.", true);
  privacyToggle("show_bests", "Personal bests", "Your best result for each drill.", true);
  privacyToggle("show_streak", "Streak", "Your current and longest streak.", true);
  privacyToggle("show_joined", "Member since", "The month you joined.", true);
  privacyToggle("show_sessions", "Sessions per day", "How many sessions you run each day.", false);
  privacyToggle("show_activity", "Past month of activity", "Your training activity over the last 30 days.", false);

  var bioRow = row("Bio", "Up to 280 characters. Shown on your public profile.");
  var bioInput = el("textarea", "set-bio");
  bioInput.maxLength = 280;
  bioInput.value = profile.bio || "";
  bioInput.setAttribute("aria-label", "Profile bio");
  bioInput.placeholder = "A line about what you are training for.";
  bioInput.addEventListener("blur", function () {
    var v = bioInput.value.trim();
    if (v === (profile.bio || "")) return;
    profile.bio = v;
    savePrivacy({ bio: v || null }).then(function (res) {
      if (!res || res.ok !== false) say(v ? "Bio saved." : "Bio cleared.");
    });
  });
  bioRow.right.appendChild(bioInput);
  privacy.body.appendChild(bioRow.el);

  var deleteRow = row("Delete account", "Permanently removes your account and all data.");
  var deleteBtn = el("button", "btn-danger", "Delete");
  deleteBtn.type = "button";
  deleteRow.right.appendChild(deleteBtn);
  plan.body.appendChild(deleteRow.el);

  var confirm = el("div", "confirm");
  confirm.hidden = true;
  confirm.appendChild(el("p", "confirm-copy", "This permanently deletes your account and all data. Type DELETE to confirm."));
  var confirmInput = el("input");
  confirmInput.type = "text";
  confirmInput.placeholder = "DELETE";
  confirmInput.setAttribute("aria-label", "Type DELETE to confirm");
  confirmInput.style.cssText = "background:var(--panel2);color:var(--ink);border:1px solid var(--line2);" +
    "border-radius:8px;padding:7px 9px;font:inherit;width:150px;";
  confirm.appendChild(confirmInput);
  var confirmActions = el("div", "confirm-actions");
  var confirmBtn = el("button", "btn-danger", "Delete account");
  confirmBtn.type = "button";
  confirmBtn.disabled = true;
  var cancelBtn = el("button", "btn-ghost", "Cancel");
  cancelBtn.type = "button";
  confirmActions.appendChild(confirmBtn);
  confirmActions.appendChild(cancelBtn);
  confirm.appendChild(confirmActions);
  plan.body.appendChild(confirm);

  confirmInput.addEventListener("input", function () {
    confirmBtn.disabled = confirmInput.value.trim() !== "DELETE";
  });
  deleteBtn.addEventListener("click", function () {
    confirm.hidden = false;
    deleteBtn.hidden = true;
    confirmInput.value = "";
    confirmBtn.disabled = true;
    confirmInput.focus();
  });
  cancelBtn.addEventListener("click", function () {
    confirm.hidden = true;
    deleteBtn.hidden = false;
    deleteBtn.focus();
  });
  confirmBtn.addEventListener("click", function () {
    var fn = (ctx.auth && typeof ctx.auth.deleteAccount === "function" && ctx.auth.deleteAccount) ||
      (typeof ctx.deleteAccount === "function" && ctx.deleteAccount) ||
      (db && typeof db.deleteAccount === "function" && db.deleteAccount) || null;
    if (!fn) { say("Account deletion is not available in this build."); return; }
    confirmBtn.disabled = true;
    Promise.resolve(fn()).then(function (r) {
      if (r && r.ok === false) { confirmBtn.disabled = false; say("Could not delete the account."); return; }
      navigate("landing");
    }).catch(function () {
      confirmBtn.disabled = false;
      say("Could not delete the account.");
    });
  });

  /* Starts once per page session and outlives this view. The check itself is
     reminderDue above; this is only the clock that calls it. */
  ensureReminderLoop();

  /* ---------- assemble ----------
     Three columns at desktop width, one stack at phone width. Each column is
     headed by the group label, so the page reads as three decisions rather than
     seven identical cards. At phone width the same three groups stack in the
     same order, which keeps the reading order and the visual order identical. */
  var col = el("div", "view-mid set-view");
  var wrap = el("div", "set-grid");
  groups.forEach(function (g) {
    var colEl = el("div", "set-group");
    colEl.setAttribute("role", "group");
    colEl.setAttribute("aria-label", g.label);
    colEl.appendChild(el("h2", "set-group-l", g.label));
    g.sections.forEach(function (s) {
      /* A section flagged `divider` gets a rule above it instead of plain
         spacing: the same device the rail uses between the account control and
         the modules, and it reads the same gap as every other card. */
      if (s.divider) {
        var rule = el("div", "set-divider");
        rule.setAttribute("aria-hidden", "true");
        colEl.appendChild(rule);
      } else {
        s.el.style.marginTop = "var(--set-sec)";
      }
      colEl.appendChild(s.el);
    });
    wrap.appendChild(colEl);
  });
  col.appendChild(wrap);
  col.appendChild(live);
  container.appendChild(col);
}

export default render;
