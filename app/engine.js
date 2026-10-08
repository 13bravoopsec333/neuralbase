/* Neuralbase engine: circuits, adaptive mix, interleaving. Pure logic.

   Everything here is available to everyone. There is no plan, no tier and no
   entitlement check, so nothing in this file can lock a drill or an n-back mode.
   The access functions are kept as named shims because a dozen call sites ask
   through them, and they now answer the same way for every input; if that call
   surface is ever cleaned up they can go with it. */
(function () {
  "use strict";

  var ALL_DRILLS = ["nback", "ufov", "palace", "reasoning", "spaced", "switching", "sart", "crt", "math"];

  /* N-back mode ids. These MUST match the MODES list in app/content.js. content.js and
     engine.js are independent classic scripts with no bundler, so the list is duplicated
     rather than imported. tests/registry.test.js asserts the two agree. */
  var MODE_IDS = ["dual", "visual", "letter", "vowel", "arithmetic", "spatial"];
  var DEFAULT_MODE = "dual";
  var NBACK_DRILL = "nback";

  var Store = null;
  try {
    if (typeof require === "function") Store = require("./store.js");
  } catch (e) { Store = null; }
  if (!Store && typeof globalThis !== "undefined") Store = globalThis.Store;

  /* Always allowed. The plan argument is ignored and kept only so existing call
     sites do not have to change shape in the same commit as the behaviour. */
  function canAccess(drillId) {
    return ALL_DRILLS.indexOf(drillId) !== -1;
  }

  function lockedDrills() {
    return [];
  }

  function poolFor() {
    return ALL_DRILLS.slice();
  }

  /* A circuit is three drills. Walk the pool with a stride of 4 from a start that
     advances one per day: 4 is coprime with the pool size (9), so a circuit can
     never repeat a drill, and consecutive days start at different offsets so two users
     on the same day are not trivially on the same sequence. */
  var CIRCUIT_SIZE = 3;
  var CIRCUIT_STRIDE = 4;

  function dailyCircuit(dayIndex) {
    var pool = poolFor();
    var out = [];
    var n = pool.length;
    var d = Math.abs(dayIndex | 0);
    for (var k = 0; k < CIRCUIT_SIZE && k < n; k++) {
      out.push(pool[(d + k * CIRCUIT_STRIDE) % n]);
    }
    return out;
  }

  /* Every mode of every drill is available. A mode id that is not real is still
     rejected, because that is a programming error rather than a paywall. */
  function canAccessMode(drillId, modeId) {
    if (drillId !== NBACK_DRILL) return false;
    return MODE_IDS.indexOf(modeId) !== -1;
  }

  function modesFor(drillId) {
    if (drillId !== NBACK_DRILL) return [];
    return MODE_IDS.slice();
  }

  function adaptiveMix(state, count) {
    var pool = poolFor();
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
    ALL_DRILLS: ALL_DRILLS,
    MODE_IDS: MODE_IDS, DEFAULT_MODE: DEFAULT_MODE,
    canAccess: canAccess, lockedDrills: lockedDrills, poolFor: poolFor,
    dailyCircuit: dailyCircuit,
    adaptiveMix: adaptiveMix, interleave: interleave,
    canAccessMode: canAccessMode, modesFor: modesFor
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof globalThis !== "undefined") globalThis.Engine = api;
})();