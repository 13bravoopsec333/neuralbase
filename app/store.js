/* Neuralbase store: state shape, persistence, migration, aggregation, streaks,
   personal records, habit heatmap, baseline and goal weighting. Pure logic, no
   DOM, no network. CommonJS so bun can require it, and it also assigns
   globalThis.Store for the browser. */
(function () {
  "use strict";

  var VERSION = 3;
  var MAX_RECORDS = 500;
  var DAY = 86400000;
  var GOALS = ["focus", "memory", "study", "fresh"];
  var MAX_SPAN = 5000;

  /* Direction table used when globalThis.Content is not loaded (tests, workers).
     content.js is the source of truth in the browser and wins when present. */
  var DIRECTIONS = {
    reaction: "lower", ufov: "lower", crt: "lower",
    nback: "higher", palace: "higher", reasoning: "higher",
    spaced: "higher", switching: "higher", sart: "higher", math: "higher"
  };

  /* Starting difficulty for a first run block, chosen to be easy so a new user
     sees a success before the plan starts adapting. */
  var CALIBRATION_DEFAULT = {
    reaction: 1500, ufov: 1500, crt: 1500,
    nback: 2, palace: 3, reasoning: 4, spaced: 4,
    switching: 4, sart: 6, math: 4
  };

  var FREE_FALLBACK_DEFAULT = 4;

  function blank() {
    return {
      version: VERSION,
      records: [],
      sessions: [],
      days: [],
      settings: { reduced: false, sound: false, focus: false },
      plan: "free",
      cards: [],
      sequences: [],
      seenIntro: false,
      goal: "fresh",
      baseline: null,
      reminderTime: null,
      streakFreezes: 0,
      restDays: [],
      onboarded: false,
      kudosGiven: [],
      freezeDays: [],
      freezeMilestone: 0
    };
  }

  function num(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }
  function int(v, d) { var n = num(v, NaN); return isFinite(n) ? Math.round(n) : d; }

  /* ---- local calendar day helpers ---- */

  function startOfDay(d) {
    var x = new Date(d.getTime());
    x.setHours(0, 0, 0, 0);
    return x;
  }

  /* Shift by n calendar days, so a DST change never skips or repeats a day. */
  function shiftDay(d, n) {
    var x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  /* Monday is 0. */
  function mondayIndex(d) { return (d.getDay() + 6) % 7; }

  function dayKey(d) { return iso(d); }

  /* A day key has to be a real calendar date, not just the right shape.
     longestStreak turns one into a Date to walk from, and a key like
     2020-13-45 parses to Invalid Date, which made toISOString throw and took
     the whole dashboard down. */
  function isDayKey(k) {
    if (typeof k !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(k)) return false;
    var d = new Date(k + "T00:00:00");
    if (isNaN(d.getTime())) return false;
    /* Rejects overflow dates that Date silently rolls over, 2020-02-30 becoming
       March 1, so a key always means the day it names. */
    return iso(d) === k;
  }

  function stringList(v) { return Array.isArray(v) ? v.filter(function (x) { return typeof x === "string" && x; }) : []; }

  /* ---- migration ---- */

  function normBaseline(b) {
    if (!b || typeof b !== "object" || !b.drills || typeof b.drills !== "object") return null;
    var drills = {};
    var keys = Object.keys(b.drills);
    for (var i = 0; i < keys.length; i++) {
      var d = b.drills[keys[i]];
      if (!d || typeof d !== "object") continue;
      if (typeof d.value !== "number" || !isFinite(d.value)) continue;
      var out = { value: d.value, accuracy: num(d.accuracy, 0) };
      if (typeof d.block === "number" && isFinite(d.block)) out.block = d.block;
      drills[keys[i]] = out;
    }
    if (!Object.keys(drills).length) return null;
    var at = b.at;
    if (typeof at !== "number" || !isFinite(at)) at = 0;
    return { at: at, drills: drills };
  }

  function normGoal(g) { return GOALS.indexOf(g) !== -1 ? g : "fresh"; }

  function normReminderTime(t) {
    if (typeof t !== "string" || !/^\d{2}:\d{2}$/.test(t)) return null;
    var h = +t.slice(0, 2), m = +t.slice(3, 5);
    return (h < 24 && m < 60) ? t : null;
  }

  /* Accepts a version 2 state, a version 3 state, or the oldest legacy shapes,
     and always returns a valid version 3 state. Nothing is dropped. */
  function migrate(old) {
    var s = blank();
    if (!old || typeof old !== "object") return s;
    if (Array.isArray(old.records)) {
      s.records = old.records
        .filter(function (r) { return r && typeof r.value === "number" && isFinite(r.value); })
        .map(function (r) {
          return { drillId: typeof r.drillId === "string" ? r.drillId : "reaction",
                   value: r.value, unit: typeof r.unit === "string" ? r.unit : "ms",
                   t: num(r.t, 0), meta: r.meta || null };
        });
    } else if (Array.isArray(old.runs)) {
      s.records = old.runs
        .filter(function (r) { return r && typeof r.ms === "number" && isFinite(r.ms); })
        .map(function (r) {
          return { drillId: typeof r.p === "string" ? r.p : "reaction",
                   value: r.ms, unit: "ms", t: num(r.t, 0), meta: null };
        });
    }
    s.sessions = Array.isArray(old.sessions) ? old.sessions.slice() : [];
    if (typeof old.sessions === "number") {
      s.sessions = [];
      for (var i = 0; i < old.sessions; i++) s.sessions.push({ t: 0, drills: [] });
    }
    s.days = Array.isArray(old.days) ? old.days.filter(isDayKey) : stringList(old.days);
    if (old.settings && typeof old.settings === "object") {
      s.settings.reduced = !!old.settings.reduced;
      s.settings.sound = !!old.settings.sound;
      s.settings.focus = !!old.settings.focus;
    }
    s.plan = old.plan === "pro" ? "pro" : "free";
    s.cards = Array.isArray(old.cards) ? old.cards.slice() : [];
    s.sequences = Array.isArray(old.sequences) ? old.sequences.slice() : [];
    s.seenIntro = !!old.seenIntro;

    s.goal = normGoal(old.goal);
    s.baseline = normBaseline(old.baseline);
    s.reminderTime = normReminderTime(old.reminderTime);
    s.streakFreezes = Math.max(0, int(old.streakFreezes, 0));
    s.restDays = Array.isArray(old.restDays) ? old.restDays.filter(isDayKey) : [];
    s.onboarded = !!old.onboarded || !!old.onboardedAt;
    s.kudosGiven = stringList(old.kudosGiven);
    s.freezeDays = Array.isArray(old.freezeDays) ? old.freezeDays.filter(isDayKey) : [];
    s.freezeMilestone = Math.max(0, int(old.freezeMilestone, 0));
    return s;
  }

  function load(raw) {
    if (raw == null || raw === "") return blank();
    var parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return blank(); }
    if (!parsed || typeof parsed !== "object") return blank();
    return migrate(parsed);
  }

  function serialize(state) { return JSON.stringify(state); }

  function record(state, rec) {
    if (!rec || typeof rec.value !== "number" || !isFinite(rec.value)) return state;
    state.records.push({
      drillId: typeof rec.drillId === "string" ? rec.drillId : "unknown",
      value: rec.value,
      unit: typeof rec.unit === "string" ? rec.unit : "",
      t: num(rec.t, 0),
      meta: rec.meta || null
    });
    if (state.records.length > MAX_RECORDS) {
      state.records.splice(0, state.records.length - MAX_RECORDS);
    }
    return state;
  }

  function forDrill(state, drillId) {
    return (state.records || []).filter(function (r) { return r.drillId === drillId; });
  }

  function aggregate(state, drillId, direction) {
    var rs = forDrill(state, drillId);
    if (!rs.length) return { best: null, avg: null, attempts: 0, recent: [] };
    var dir = direction === "lower" ? "lower" : "higher";
    var best = null, sum = 0;
    for (var i = 0; i < rs.length; i++) {
      var v = rs[i].value;
      if (best === null || (dir === "lower" ? v < best : v > best)) best = v;
      sum += v;
    }
    var recent = rs.slice(-10).map(function (r) { return r.value; });
    return { best: best, avg: Math.round(sum / rs.length), attempts: rs.length, recent: recent };
  }

  function iso(d) {
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  /* ---- day activity ---- */

  /* Session counts per local day. A day listed in state.days without any
     session still counts as one visit, so a legacy state reads correctly. */
  function dayCounts(state) {
    var counts = {};
    var ss = (state && state.sessions) || [];
    for (var i = 0; i < ss.length; i++) {
      var raw = ss[i] && typeof ss[i] === "object" ? ss[i].t : ss[i];
      var t = num(raw, 0);
      if (!t) continue;
      var k = iso(new Date(t));
      counts[k] = (counts[k] || 0) + 1;
    }
    var ds = (state && state.days) || [];
    for (var j = 0; j < ds.length; j++) {
      if (isDayKey(ds[j]) && !counts[ds[j]]) counts[ds[j]] = 1;
    }
    return counts;
  }

  function daySet(state) {
    var counts = dayCounts(state);
    var out = {};
    var keys = Object.keys(counts);
    for (var i = 0; i < keys.length; i++) out[keys[i]] = 1;
    return out;
  }

  /* Days the streak holds open without a session: a planned rest day, or a day
     an earned freeze was spent on. Both bridge a gap and neither counts as a
     trained day, so they are read together here. */
  function restSet(state) {
    var out = {};
    var rs = (state && state.restDays) || [];
    var fd = (state && state.freezeDays) || [];
    var i;
    for (i = 0; i < rs.length; i++) if (isDayKey(rs[i])) out[rs[i]] = 1;
    for (i = 0; i < fd.length; i++) if (isDayKey(fd[i])) out[fd[i]] = 1;
    return out;
  }

  /* ---- streaks ---- */

  /* Current consecutive day streak. Today still counts when yesterday was
     trained, so the number never drops at midnight before the user has had a
     chance to train. A day in restDays holds the streak open without adding a
     trained day to the count. */
  function streak(state, now) {
    var trained = daySet(state), rest = restSet(state);
    var today = startOfDay(now instanceof Date ? now : new Date());
    var cur = today;
    if (!trained[iso(cur)]) {
      cur = shiftDay(today, -1);
      if (!trained[iso(cur)]) return 0;
    }
    var n = 1;
    var p = shiftDay(cur, -1);
    for (var i = 0; i < MAX_SPAN; i++, p = shiftDay(p, -1)) {
      var k = iso(p);
      if (trained[k]) n++;
      else if (!rest[k]) break;
    }
    return n;
  }

  /* Best streak ever. Rest days bridge gaps, they are not counted as trained. */
  function longestStreak(state) {
    var trained = daySet(state), rest = restSet(state);
    var keys = Object.keys(trained).sort();
    if (!keys.length) return 0;
    var d = startOfDay(new Date(keys[0] + "T00:00:00"));
    var best = 0, cur = 0, guard = 0;
    while (guard++ < MAX_SPAN) {
      var k = iso(d);
      if (trained[k]) { cur++; if (cur > best) best = cur; }
      else if (!rest[k]) cur = 0;
      if (k >= keys[keys.length - 1]) break;
      d = shiftDay(d, 1);
    }
    return best;
  }

  /* The day that would break the current run, or null when nothing is at stake.
     The walk is streak()'s exactly: today, then back while days are trained or
     bridged, and the first empty unbridged day is the one that ends it. A freeze
     is only worth spending on that day, since every other day already holds. */
  function streakGapDay(state, now) {
    var trained = daySet(state), rest = restSet(state);
    var keys = Object.keys(trained);
    if (!keys.length) return null;
    var first = keys.sort()[0];
    var today = startOfDay(now instanceof Date ? now : new Date());
    var cur = today;
    if (!trained[iso(cur)]) {
      cur = shiftDay(today, -1);
      if (!trained[iso(cur)]) return null;
    }
    for (var i = 0, p = shiftDay(cur, -1); i < MAX_SPAN; i++, p = shiftDay(p, -1)) {
      var k = iso(p);
      if (trained[k] || rest[k]) continue;
      /* The day before the run's own start is not a gap. It ends nothing, so a
         freeze spent there would buy nothing and read as a bug. */
      if (k < first) return null;
      return k;
    }
    return null;
  }

  /* True when the streak is worth protecting and today has no session yet.
     Drives a hollow marker, never a countdown. */
  function streakAtRisk(state, now) {
    var s = streak(state, now);
    if (s < 3) return false;
    var trained = daySet(state);
    return !trained[iso(startOfDay(now instanceof Date ? now : new Date()))];
  }

  /* Spend one freeze on a missed day. No-op (state returned unchanged) when the
     day was trained, was already a rest day, already has a freeze on it, or the
     user holds none. Never goes below zero and never adds one. */
  function applyFreeze(state, dayKeyArg, now) {
    if (!state) return state;
    var k = isDayKey(dayKeyArg)
      ? dayKeyArg
      : iso(startOfDay(now instanceof Date ? now : new Date()));
    if (int(state.streakFreezes, 0) < 1) return state;
    if (daySet(state)[k]) return state;
    if (restSet(state)[k]) return state;
    if (!Array.isArray(state.freezeDays)) state.freezeDays = [];
    if (state.freezeDays.indexOf(k) !== -1) return state;
    state.freezeDays.push(k);
    state.streakFreezes = int(state.streakFreezes, 0) - 1;
    return state;
  }

  /* Earning rule: one freeze per completed 7 day milestone, paid out once per
     milestone. freezeMilestone remembers the highest streak that already paid,
     so calling this repeatedly in one session cannot farm freezes. Earned only,
     nothing in the app sells them. */
  function earnFreeze(state, streakLength) {
    if (!state) return state;
    var len = int(streakLength, 0);
    if (len < 7) return state;
    if (len % 7 !== 0) return state;
    var paid = Math.max(0, int(state.freezeMilestone, 0));
    if (len <= paid) return state;
    state.freezeMilestone = len;
    state.streakFreezes = int(state.streakFreezes, 0) + 1;
    return state;
  }

  /* Fraction of the last `days` local calendar days with a session, rounded to
     two decimals. */
  function consistency(state, days) {
    var total = Math.max(1, int(days, 30));
    var trained = daySet(state);
    var end = startOfDay(new Date());
    var n = 0;
    for (var i = 0; i < total; i++) if (trained[iso(shiftDay(end, -i))]) n++;
    return { trained: n, total: total, rate: Math.round((n / total) * 100) / 100 };
  }

  /* ---- direction and bests ---- */

  function directionFor(drillId, dirMap) {
    if (dirMap && (dirMap[drillId] === "lower" || dirMap[drillId] === "higher")) return dirMap[drillId];
    var C = (typeof globalThis !== "undefined" && globalThis.Content) || null;
    var D = (C && C.DRILLS) || null;
    if (D) {
      for (var i = 0; i < D.length; i++) {
        if (D[i] && D[i].id === drillId) return D[i].direction === "lower" ? "lower" : "higher";
      }
    }
    return DIRECTIONS[drillId] === "lower" ? "lower" : "higher";
  }

  function better(v, best, dir) { return dir === "lower" ? v < best : v > best; }

  function sortedRecords(state) {
    return ((state && state.records) || []).slice().sort(function (a, b) {
      return num(a && a.t, 0) - num(b && b.t, 0);
    });
  }

  /* Ordered timeline of the moments a best was beaten, per drill. The first run
     of a drill only sets the bar, it is not a moment, so it is left out. */
  function personalRecords(state, dirMap) {
    var rs = sortedRecords(state);
    var best = {}, out = [];
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i];
      if (!r || typeof r.drillId !== "string" || typeof r.value !== "number" || !isFinite(r.value)) continue;
      var id = r.drillId;
      var cur = best[id];
      if (cur === undefined) { best[id] = r.value; continue; }
      if (better(r.value, cur, directionFor(id, dirMap))) {
        out.push({ drillId: id, best: r.value, at: num(r.t, 0), prev: cur });
        best[id] = r.value;
      }
    }
    out.sort(function (a, b) { return a.at - b.at; });
    return out;
  }

  /* True when the just finished run beat the previous best, so the UI can
     celebrate once. Works whether or not the run has been recorded yet. */
  function isPersonalBest(state, rec, dirMap) {
    if (!rec || typeof rec.drillId !== "string" || typeof rec.value !== "number" || !isFinite(rec.value)) return false;
    var dir = directionFor(rec.drillId, dirMap);
    var rs = forDrill(state || { records: [] }, rec.drillId);
    var best = null;
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i];
      if (!r || typeof r.value !== "number") continue;
      if (r === rec) continue;
      if (num(r.t, 0) === num(rec.t, 0) && r.value === rec.value) continue;
      if (best === null || better(r.value, best, dir)) best = r.value;
    }
    if (best === null) return false;
    return better(rec.value, best, dir);
  }

  function latestRecord(state, dirMap) {
    var list = personalRecords(state, dirMap);
    return list.length ? list[list.length - 1] : null;
  }

  /* ---- heatmap ---- */

  /* A day is one quarter of your busiest day, rounded up, and the busiest day
     is always level 4, so a light user still sees marks. */
  function heatmapBuckets(n, max) {
    var v = num(n, 0), m = num(max, 0);
    if (v <= 0 || m <= 0) return 0;
    var level = Math.ceil((v / m) * 4);
    if (level < 1) level = 1;
    if (level > 4) level = 4;
    return level;
  }

  /* Contribution grid, columns are weeks, rows are weekdays Monday first.
     Defaults to 18 weeks, about six months. */
  function heatmap(state, weeks, now) {
    var w = Math.max(1, int(weeks, 18));
    var counts = dayCounts(state);
    var today = startOfDay(now instanceof Date ? now : new Date());
    var lastMonday = shiftDay(today, -mondayIndex(today));
    var from = shiftDay(lastMonday, -(w - 1) * 7);
    var grid = [], max = 0;
    for (var c = 0; c < w; c++) {
      var col = [];
      for (var r = 0; r < 7; r++) {
        var day = shiftDay(from, c * 7 + r);
        var k = iso(day);
        var n = day.getTime() > today.getTime() ? 0 : (counts[k] || 0);
        if (n > max) max = n;
        col.push({ key: k, n: n, level: 0 });
      }
      grid.push(col);
    }
    for (var g = 0; g < grid.length; g++) {
      for (var j = 0; j < grid[g].length; j++) grid[g][j].level = heatmapBuckets(grid[g][j].n, max);
    }
    return { weeks: grid, max: max, from: iso(from), to: iso(shiftDay(from, w * 7 - 1)) };
  }

  /* ---- baseline, calibration, goals, plan ---- */

  function recordsByDrill(state) {
    var out = {};
    var rs = sortedRecords(state);
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i];
      if (!r || typeof r.drillId !== "string" || typeof r.value !== "number" || !isFinite(r.value)) continue;
      if (!out[r.drillId]) out[r.drillId] = [];
      out[r.drillId].push(r);
    }
    return out;
  }

  function statsOf(rs, dir) {
    var best = null, sum = 0, last = 0;
    for (var i = 0; i < rs.length; i++) {
      var v = rs[i].value, t = num(rs[i].t, 0);
      if (best === null || better(v, best, dir)) best = v;
      if (t > last) last = t;
      sum += v;
    }
    return { best: best, avg: rs.length ? sum / rs.length : 0, last: last, n: rs.length };
  }

  /* Each drill is scored against its own history so the index is not a raw sum,
     then averaged over drills with real history. Below three such drills the
     answer would mean nothing, so it is null. */
  function baselineIndex(state, dirMap) {
    var by = recordsByDrill(state);
    var parts = [];
    var ids = Object.keys(by).sort();
    for (var i = 0; i < ids.length; i++) {
      var rs = by[ids[i]];
      if (rs.length < 2) continue;
      var dir = directionFor(ids[i], dirMap);
      var s = statsOf(rs, dir);
      if (s.best === null) continue;
      var scale = Math.abs(s.best);
      var ratio = scale < 1e-9 ? 0 : (dir === "lower" ? s.best / s.avg : s.avg / s.best);
      if (!isFinite(ratio) || ratio < 0) ratio = 0;
      if (ratio > 1) ratio = 1;
      parts.push(ratio);
    }
    if (parts.length < 3) return null;
    var sum = 0;
    for (var j = 0; j < parts.length; j++) sum += parts[j];
    return Math.round((sum / parts.length) * 100);
  }

  function median(values) {
    var vs = values.slice().sort(function (a, b) { return a - b; });
    if (!vs.length) return null;
    var mid = Math.floor(vs.length / 2);
    if (vs.length % 2) return vs[mid];
    return Math.round((vs[mid - 1] + vs[mid]) / 2);
  }

  function calibrationBlock(drillId, records, dirMap) {
    var vals = [];
    var rs = (records || []).filter(function (r) {
      return r && r.drillId === drillId && typeof r.value === "number" && isFinite(r.value);
    });
    for (var i = 0; i < rs.length; i++) vals.push(rs[i].value);
    if (vals.length) return median(vals);
    if (Object.prototype.hasOwnProperty.call(CALIBRATION_DEFAULT, drillId)) {
      return CALIBRATION_DEFAULT[drillId];
    }
    return directionFor(drillId, dirMap) === "lower" ? CALIBRATION_DEFAULT.ufov : FREE_FALLBACK_DEFAULT;
  }

  /* Goal weighting, small integers on purpose so the mix is legible.
     focus leans on processing speed and switching, memory on the two recall
     drills plus n-back, study on reasoning, math and spaced retrieval, and fresh
     is flat so every drill gets rotated through evenly. */
  function goalWeights(goal) {
    if (goal === "focus") {
      return { ufov: 3, switching: 3, nback: 2, sart: 2, crt: 2, reasoning: 1, palace: 1, spaced: 1, math: 1 };
    }
    if (goal === "memory") {
      return { palace: 3, spaced: 3, nback: 3, switching: 2, reasoning: 2, ufov: 1, sart: 1, crt: 1, math: 1 };
    }
    if (goal === "study") {
      return { reasoning: 3, math: 3, spaced: 3, crt: 2, switching: 2, nback: 1, ufov: 1, palace: 1, sart: 1 };
    }
    return { nback: 1, ufov: 1, palace: 1, reasoning: 1, spaced: 1, switching: 1, sart: 1, crt: 1, math: 1 };
  }

  /* Stable 0 to 1 hash, used only to nudge ties so the plan varies by day
     without shuffling when it is rendered again. */
  function hash01(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return (h % 1000) / 1000;
  }

  /* Picks count drills weighted by the goal, boosted by how stale each drill is
     and by how far its average sits from its own best. The hash01 nudge is a
     function of drill id and dayIndex only, so the same day always gives the
     same plan. */
  function dailyPlan(state, dayIndex, drillIds, count) {
    var ids = (drillIds || []).filter(function (id) { return typeof id === "string"; });
    var want = Math.max(0, int(count, 3));
    if (!ids.length || !want) return [];
    var weights = goalWeights(state && state.goal);
    var by = recordsByDrill(state);
    var now = Date.now();
    var day = int(dayIndex, 0);
    var scored = ids.map(function (id) {
      var rs = by[id] || [];
      var s = statsOf(rs, directionFor(id));
      var since = s.last ? (now - s.last) / DAY : 30;
      if (since < 0) since = 0;
      if (since > 30) since = 30;
      var stale = 1 + since / 15;
      var scale = Math.abs(s.best);
      var gap = s.n && scale >= 1e-9
        ? (directionFor(id) === "lower" ? (s.avg - s.best) / scale : (s.best - s.avg) / scale)
        : 0;
      if (!isFinite(gap) || gap < 0) gap = 0;
      if (gap > 1) gap = 1;
      var weak = 1 + gap;
      var score = (weights[id] || 1) * stale * weak + hash01(id + ":" + day) * 0.4;
      return { id: id, score: score };
    });
    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
    return scored.slice(0, want).map(function (x) { return x.id; });
  }

  function level(state) { return 1 + Math.floor(state.sessions.length / 3); }

  var api = {
    VERSION: VERSION, MAX_RECORDS: MAX_RECORDS, GOALS: GOALS,
    blank: blank, migrate: migrate, load: load, serialize: serialize,
    record: record, forDrill: forDrill, aggregate: aggregate, level: level, iso: iso,
    streak: streak, longestStreak: longestStreak, streakAtRisk: streakAtRisk,
    streakGapDay: streakGapDay,
    applyFreeze: applyFreeze, earnFreeze: earnFreeze, consistency: consistency,
    personalRecords: personalRecords, isPersonalBest: isPersonalBest, latestRecord: latestRecord,
    heatmap: heatmap, heatmapBuckets: heatmapBuckets,
    baselineIndex: baselineIndex, calibrationBlock: calibrationBlock,
    goalWeights: goalWeights, dailyPlan: dailyPlan,
    dayCounts: dayCounts
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof globalThis !== "undefined") globalThis.Store = api;
})();