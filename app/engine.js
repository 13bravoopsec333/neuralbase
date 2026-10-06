/* Neuralbase engine: circuits, adaptive mix, entitlements, interleaving. Pure logic. */
(function () {
  "use strict";

  var PLAN_FREE = "free";
  var PLAN_PRO = "pro";
  var FREE_DRILLS = ["nback", "ufov", "spaced"];
  var ALL_DRILLS = ["nback", "ufov", "palace", "reasoning", "spaced", "switching", "sart", "crt", "math"];

  /* N-back mode ids. These MUST match the MODES list in app/content.js. content.js and
     engine.js are independent classic scripts with no bundler, so the list is duplicated
     rather than imported. tests/registry.test.js asserts the two agree. */
  var MODE_IDS = ["dual", "visual", "letter", "vowel", "arithmetic", "spatial"];
  var DEFAULT_MODE = "dual";
  var NBACK_DRILL = "nback";

  /* arithmetic and spatial add a second value to track or a spatial layout to read, so
     they carry more setup and a steeper learning curve. Those get gated behind Pro;
     dual, visual, letter, and vowel stay on Free. Flip this to [] to unlock everything. */
  var PRO_ONLY_MODES = ["arithmetic", "spatial"];

  var Store = null;
  try {
    if (typeof require === "function") Store = require("./store.js");
  } catch (e) { Store = null; }
  if (!Store && typeof globalThis !== "undefined") Store = globalThis.Store;

  function canAccess(drillId, plan) {
    if (plan === PLAN_PRO) return ALL_DRILLS.indexOf(drillId) !== -1;
    return FREE_DRILLS.indexOf(drillId) !== -1;
  }

  function lockedDrills(plan) {
    return ALL_DRILLS.filter(function (id) { return !canAccess(id, plan); });
  }

  function poolFor(plan) {
    return plan === PLAN_FREE ? FREE_DRILLS.slice() : ALL_DRILLS.slice();
  }

  /* A circuit is three drills. Walk the pool with a stride of 4 from a start that
     advances one per day: 4 is coprime with both pool sizes (3 and 9), so a circuit can
     never repeat a drill, and consecutive days start at different offsets so two users
     on the same day are not trivially on the same sequence. */
  var CIRCUIT_SIZE = 3;
  var CIRCUIT_STRIDE = 4;

  function dailyCircuit(dayIndex, plan) {
    var pool = poolFor(plan || PLAN_PRO);
    var out = [];
    var n = pool.length;
    var d = Math.abs(dayIndex | 0);
    for (var k = 0; k < CIRCUIT_SIZE && k < n; k++) {
      out.push(pool[(d + k * CIRCUIT_STRIDE) % n]);
    }
    return out;
  }

  function canAccessMode(drillId, modeId, plan) {
    if (drillId !== NBACK_DRILL) return false;
    if (MODE_IDS.indexOf(modeId) === -1) return false;
    if (plan === PLAN_PRO) return true;
    return PRO_ONLY_MODES.indexOf(modeId) === -1;
  }

  function modesFor(drillId, plan) {
    if (drillId !== NBACK_DRILL) return [];
    return MODE_IDS.filter(function (id) { return canAccessMode(drillId, id, plan || PLAN_FREE); });
  }

  function adaptiveMix(state, count, plan) {
    var pool = poolFor(plan || PLAN_FREE);
    var now = Date.now();
    var records = (state && state.records) || [];
    var scored = pool.map(function (id) {
      var rs = records.filter(function (r) { return r.drillId === id; });
      var last = 0;
      for (var i = 0; i < rs.length; i++) if (rs[i].t > last) last = rs[i].t;
      var staleness = last ? (now - last) / 86400000 : 999;
      var best = null, sum = 0;
      for (var j = 0; j < rs.length; j++) {
        if (best === null || rs[j].value < best) best = rs[j].value;
        sum += rs[j].value;
      }
      var avg = rs.length ? sum / rs.length : 0;
      var weakness = best !== null ? Math.max(0, avg - best) : 0;
      return { id: id, score: staleness + weakness };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, count).map(function (s) { return s.id; });
  }

  function interleave(seq) {
    var order = [], counts = {};
    for (var i = 0; i < seq.length; i++) {
      var x = seq[i];
      if (!(x in counts)) { counts[x] = 0; order.push(x); }
      counts[x]++;
    }
    var out = [], last = null, total = seq.length;
    while (out.length < total) {
      var pick = null, best = -1;
      for (var a = 0; a < order.length; a++) {
        var k = order[a];
        if (counts[k] <= 0 || k === last) continue;
        if (counts[k] > best) { best = counts[k]; pick = k; }
      }
      if (pick === null) {
        for (var b = 0; b < order.length; b++) { if (counts[order[b]] > 0) { pick = order[b]; break; } }
      }
      if (pick === null) break;
      out.push(pick); counts[pick]--; last = pick;
    }
    return out;
  }

  var api = {
    PLAN_FREE: PLAN_FREE, PLAN_PRO: PLAN_PRO,
    FREE_DRILLS: FREE_DRILLS, ALL_DRILLS: ALL_DRILLS,
    MODE_IDS: MODE_IDS, PRO_ONLY_MODES: PRO_ONLY_MODES, DEFAULT_MODE: DEFAULT_MODE,
    canAccess: canAccess, lockedDrills: lockedDrills, dailyCircuit: dailyCircuit, adaptiveMix: adaptiveMix, interleave: interleave,
    canAccessMode: canAccessMode, modesFor: modesFor
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof globalThis !== "undefined") globalThis.Engine = api;
})();
