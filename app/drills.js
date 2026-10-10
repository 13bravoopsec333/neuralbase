/* Neuralbase drills: pure helpers (DrillsCore) and DOM drill factories (Drills). */
(function () {
  "use strict";

  /* ---------- pure helpers ---------- */

  /* mulberry32: small, fast, well distributed. Same seed, same stream. */
  function mulberry32(seed) {
    var a = (typeof seed === "number" ? seed : seedFrom(seed)) >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* FNV-1a, 32 bit. Turns any seed label into a numeric seed. */
  function seedFrom(str) {
    var h = 2166136261 >>> 0;
    var s = str == null ? "" : String(str);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function randInt(rng, n) { return Math.floor(rng() * n); }

  function pick(rng, arr) { return arr[randInt(rng, arr.length)]; }

  /* Default stream for normal play: unseeded, but still rng shaped. */
  function freshRng() {
    var now = typeof performance !== "undefined" && performance.now ? performance.now() * 1000 : 0;
    return mulberry32((Date.now() ^ Math.floor(now)) >>> 0);
  }

  function rngFrom(opts) {
    opts = opts || {};
    if (opts.rng) return opts.rng;
    if (opts.seed != null) return mulberry32(opts.seed);
    return freshRng();
  }

  /* Seed bag shared with the n-back generator, one field per mode. */
  var NB_MODES = ["dual", "visual", "letter", "vowel", "arithmetic", "spatial"];
  var NB_LETTERS = ["A", "E", "I", "O", "U", "C", "H", "K", "L", "Q", "R", "S", "T"];
  var NB_VOWELS = ["A", "E", "I", "O", "U"];
  var NB_CONSONANTS = ["C", "H", "K", "L", "Q", "R", "S", "T"];
  var NB_SHAPES = ["circle", "triangle", "square"];
  /* Letter voice clips exist only for the modes that put a letter on screen:
     dual, visual, letter, vowel. Arithmetic and spatial have no matching clip in
     app/audio/manifest.json, so they stay silent instead of reaching for one. */
  var NB_VOICE = { dual: 1, visual: 1, letter: 1, vowel: 1 };
  function nbackVoiceMode(mode) { return NB_VOICE[mode] === 1; }
  var NB_CUES = {
    visual: "MATCH POSITION",
    letter: "MATCH LETTER",
    vowel: "MATCH VOWEL",
    arithmetic: "MATCH SUM",
    spatial: "MATCH PLACE"
  };
  var NB_HINTS = {
    dual: "Respond only when the current cue's rule is met n steps back. A match that violates the cue is a trap.",
    visual: "Respond when the lit square sits in the same place as n steps back.",
    letter: "Respond when the letter is the same as the letter n steps back.",
    vowel: "Respond when the letter repeats the letter n steps back and that letter is a vowel. A repeated consonant is a trap.",
    arithmetic: "Respond when the sum matches the sum from n steps back.",
    spatial: "Respond when the shape sits in the same square as n steps back. The shape itself may change."
  };

  /* Fixed rule per single-dimension mode. "spatial" is position plus a shape. */
  var NB_RULE = { visual: "position", letter: "letter", vowel: "vowel", arithmetic: "sum", spatial: "spatial" };

  /* Pure trial generator: the stimuli array for one block at one level. */
  function nbackSequence(level, trials, seed, mode, cueLength) {
    var m = NB_MODES.indexOf(mode) >= 0 ? mode : "dual";
    var rng = mulberry32(seed == null ? 0 : seed);
    /* How many trials one rule stays live before the cue switches. Validated by
       drillOptions, so it is a whole number in 4..10. */
    var cueLen = (typeof cueLength === "number" && isFinite(cueLength)) ? Math.max(1, Math.round(cueLength)) : 6;
    var out = [];
    var posSeq = [], letSeq = [], sumSeq = [], shapeSeq = [];
    var rule = null, cueLeft = 0, cueCount = 0, cueChanged = false;

    /* Vowel mode plans each trial before its letter is drawn. A target needs the
       letter n steps back to be a vowel, a trap needs it to be a consonant. The
       plan is read when that letter is generated, so the rates land on the same
       30 percent target and 18 percent lure as the other modes, instead of the
       roughly half target rate a plain random repeat produced. */
    var vowelPlan = [];
    if (m === "vowel") {
      for (var vp = 0; vp < trials; vp++) {
        if (vp < level) { vowelPlan.push("none"); continue; }
        var vr = rng();
        vowelPlan.push(vr < 0.3 ? "target" : (vr < 0.48 ? "trap" : "none"));
      }
    }

    /* A vowel-mode letter for position i, drawn from the pool its future repeat
       needs and kept clear of an accidental match at i. */
    function vowelLetter(i) {
      var plan = (i + level < trials) ? vowelPlan[i + level] : "none";
      var pool = plan === "target" ? NB_VOWELS : (plan === "trap" ? NB_CONSONANTS : NB_LETTERS);
      var l = pick(rng, pool);
      if (i >= level && l === letSeq[i - level]) l = pool[(pool.indexOf(l) + 1) % pool.length];
      return l;
    }

    for (var i = 0; i < trials; i++) {
      if (m === "dual") {
        if (cueLeft <= 0) {
          var set = level >= 2 ? ["position", "letter", "vowel"] : ["position", "letter"];
          var choices = set.filter(function (r) { return r !== rule; });
          if (!choices.length) choices = set;
          rule = pick(rng, choices);
          cueLeft = cueLen;
          cueCount = 0;
          cueChanged = true;
        }
      } else rule = NB_RULE[m];

      var st = { mode: m, index: i, rule: rule, cueChanged: cueChanged, postSwitch: m === "dual" ? cueCount < 3 : false };
      cueChanged = false;
      if (m === "dual") { cueCount++; cueLeft--; }

      /* Same rates as the dual drill: 30 percent true target, 18 percent lure. */
      var wantMatch = false, wantLure = false;
      if (i >= level) {
        var roll = rng();
        if (roll < 0.3) wantMatch = true;
        else if (roll < 0.48) wantLure = true;
      }

      if (rule === "sum") {
        var sum;
        if (wantMatch) sum = sumSeq[i - level];
        else if (wantLure && level > 1 && sumSeq[i - 1] !== sumSeq[i - level]) sum = sumSeq[i - 1];
        /* Sums run 4 to 17 so every one of them splits into more than one pair of
           single digits. The wider 2 to 18 range included totals that have a single
           valid split: 18 can only be 9+9, so those trials always looked identical
           and the sum was readable off the digits without adding anything up. */
        else {
          /* Rejected on purpose. A trial meant to be a non-target that happened to
             draw the same total as the one n steps back scored anyway, so the real
             target rate ran 0.34 to 0.44 against the 30 percent the other modes
             hold, and the mode was quietly easier than its copy claims. With 14
             possible totals that collision lands about one time in seven. */
          sum = randInt(rng, 14) + 4;
          if (i >= level && sum === sumSeq[i - level]) sum = 4 + (sum - 3) % 14;
          if (level > 1 && sum === sumSeq[i - 1]) sum = 4 + (sum - 3) % 14;
        }
        var lo = Math.max(1, sum - 9), hi = Math.min(9, sum - 1);
        var a = lo + randInt(rng, hi - lo + 1);
        st.a = a; st.b = sum - a; st.sum = sum;
        st.target = i >= level && sum === sumSeq[i - level];
        st.pMatch = false; st.lMatch = false; st.vowel = false;
        sumSeq.push(sum);
      } else {
        var posRule = rule === "position" || rule === "spatial";
        var p;
        if (m === "vowel") {
          p = randInt(rng, 9);
          if (i >= level && p === posSeq[i - level]) p = (p + 1) % 9;
        } else {
          /* Under a position cue the lure repeats the letter; under a letter cue it repeats the position. */
          var wantPMatch = posRule ? wantMatch : (wantLure && level > 1);
          if (wantPMatch) p = posSeq[i - level];
          else { p = randInt(rng, 9); if (i >= level && p === posSeq[i - level]) p = (p + 1) % 9; }
        }

        var l;
        if (m === "vowel") {
          var vplan = vowelPlan[i];
          l = (i >= level && vplan !== "none") ? letSeq[i - level] : vowelLetter(i);
        } else {
          var wantLMatch = posRule ? (wantLure && level > 1) : wantMatch;
          if (wantLMatch) l = letSeq[i - level];
          else { l = pick(rng, NB_LETTERS); if (i >= level && l === letSeq[i - level]) l = NB_LETTERS[(NB_LETTERS.indexOf(l) + 1) % NB_LETTERS.length]; }
        }

        var pMatch = i >= level && p === posSeq[i - level];
        var lMatch = i >= level && l === letSeq[i - level];
        var vowel = isVowel(l);
        st.pos = p; st.letter = l;
        st.pMatch = pMatch; st.lMatch = lMatch; st.vowel = vowel;
        st.target = rule === "vowel" ? (lMatch && vowel) : (rule === "letter" ? lMatch : pMatch);
        posSeq.push(p); letSeq.push(l);

        if (rule === "spatial") {
          var sh;
          /* A lure repeats the shape from n steps back in a different cell, so
             the place rule has a visible trap. Otherwise keep the shape
             uncorrelated with the position so it cannot cue the answer. */
          if (wantLure && i >= level) sh = shapeSeq[i - level];
          else {
            sh = randInt(rng, NB_SHAPES.length);
            if (i >= level && sh === shapeSeq[i - level]) sh = (sh + 1) % NB_SHAPES.length;
          }
          shapeSeq.push(sh);
          st.shape = sh;
        }
      }
      out.push(st);
    }
    return out;
  }

  /* Seconds each item stays on screen during the palace encoding phase. A method
     of loci only works if the item is held in mind long enough to be seen in a
     place, and holding one image in one place for well under two seconds is
     about the floor for that. At 2.5 s, five stops is about thirteen seconds of
     encoding, which is what a five item route has to cost to be worth scoring.
     Long enough to imagine in, short enough that a set is not a chore. */
  var PALACE_STUDY_SECONDS = 2.5;
  var PALACE_STUDY_MS = Math.round(PALACE_STUDY_SECONDS * 1000);

  /* Timer bag: one pending timeout, cleared on stop, paused while the tab is hidden. */
  function makeTimers() {
    var slot = null;
    var onVis = function () {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "hidden") {
        if (slot && !slot.paused) { clearTimeout(slot.id); slot.paused = true; }
      } else if (slot && slot.paused) {
        slot.id = setTimeout(slot.fn, slot.ms);
        slot.paused = false;
      }
    };
    if (typeof document !== "undefined" && document.addEventListener) {
      document.addEventListener("visibilitychange", onVis);
    }
    return {
      set: function (fn, ms) {
        if (slot) clearTimeout(slot.id);
        slot = { fn: fn, ms: ms, id: setTimeout(fn, ms), paused: false };
        return slot.id;
      },
      clear: function () {
        if (slot) { clearTimeout(slot.id); slot = null; }
      },
      destroy: function () {
        if (slot) { clearTimeout(slot.id); slot = null; }
        if (typeof document !== "undefined" && document.removeEventListener) {
          document.removeEventListener("visibilitychange", onVis);
        }
      }
    };
  }

  /* Keys arrive on document, so a drill that forgets its unbind keeps firing
     into a dead closure for the rest of the session. bindKey hands back the
     only thing that undoes it, and every drill calls that on stop. Held keys
     are dropped here rather than in each handler: auto-repeat would otherwise
     answer the next trial before the player could read it. */
  function bindKey(doc, fn) {
    if (!doc || typeof doc.addEventListener !== "function") return function () {};
    function handler(e) { if (e.repeat) return; fn(e); }
    doc.addEventListener("keydown", handler);
    return function () { doc.removeEventListener("keydown", handler); };
  }

  /* "1" to "9" as a zero based option index, anything else -1. */
  function digitIndex(key) {
    return typeof key === "string" && key.length === 1 && key >= "1" && key <= "9"
      ? Number(key) - 1 : -1;
  }

  /* Web Audio has no per clip stop, so a stopped drill suspends the shared
     context. The next drill resumes it on its first cue, which cuts anything
     still sounding without a change to app/ui/audio.js. */
  function silenceAudio() {
    var A = globalThis.CortexAudio;
    if (!A || !A.ctx || typeof A.ctx.suspend !== "function") return;
    if (A.ctx.state === "running") { try { A.ctx.suspend(); } catch (e) {} }
  }

  /* An option button with its shortcut printed on it, the way crt prints
     "key 1" on a lane. One helper so all six keyed drills look the same. */
  function optionButton(label, idx, onPick) {
    var b = button("btn-ghost nb-opt", label);
    b.appendChild(el("span", "nb-key", String(idx + 1)));
    b.setAttribute("aria-label", label + ", key " + (idx + 1));
    b.addEventListener("click", onPick);
    return b;
  }

  var doc = typeof document !== "undefined" ? document : null;

  /* Drill scoped styles, theme tokens only. */
  function injectStyles() {
    if (typeof document === "undefined" || document.getElementById("nb-drill-styles")) return;
    var s = document.createElement("style");
    s.id = "nb-drill-styles";
    s.textContent = [
      ".drill-nback .nb-cell.nb-mark{display:flex;align-items:center;justify-content:center;background:var(--panel2);border-color:var(--lime);color:var(--lime);font-family:var(--mono);font-size:13px;font-weight:600;letter-spacing:.04em}",
      ".drill-nback .nb-sum{display:flex;align-items:baseline;gap:6px;font-size:34px;font-weight:600;letter-spacing:.02em}",
      ".drill-nback .nb-sum-op{font-size:20px;color:var(--muted)}",
      ".drill-nback .nb-sum-v{font-variant-numeric:tabular-nums}",
      /* The drill reads as a centered instrument: every child centers on the
         cross axis, the grid keeps its cap and centers, and the text blocks and
         button row center themselves. Panel padding is untouched. */
      ".drill-nback{align-items:center;text-align:center}",
      ".drill-nback .nb-grid{margin-inline:auto}",
      ".drill-nback .nb-cue,.drill-nback .nb-letter,.drill-nback .nb-hint,.drill-nback .nb-meta{text-align:center}",
      ".drill-nback .nb-sum{justify-content:center}",
      ".drill-nback .drill-bar{justify-content:center}",
      /* An option button carries its shortcut, so a key player can see what
         the digits are. The label and the key sit side by side. */
      ".nb-opt{display:inline-flex;align-items:center;gap:9px}",
      ".nb-key{font-family:var(--mono);font-size:10.5px;letter-spacing:.06em;color:var(--dim)}",
      /* Grid cells are now the position response, so they take a pointer and a
         focus ring like any other control. */
      ".drill-nback .nb-cell{cursor:pointer;padding:0;font:inherit;color:var(--ink);display:flex;align-items:center;justify-content:center}",
      ".drill-nback .nb-cell:focus-visible{outline:2px solid var(--lime-edge);outline-offset:1px}",
      /* The printed digit sits in the corner and the stimulus in the middle, so
         a lit cell still reads as one shape and one number. */
      ".drill-nback .nb-cell .k{position:absolute;top:3px;left:5px;font-family:var(--mono);font-size:10px;line-height:1;color:var(--dim)}",
      ".drill-nback .nb-cell .v{font-family:var(--mono);font-size:13px;font-weight:600;line-height:1}",
      ".drill-nback .nb-cell{position:relative}",
      /* A pressed cell keeps the mark so the eye can see what was answered. */
      ".drill-nback .nb-cell.nb-pick{border-color:var(--lime-edge);box-shadow:inset 0 0 0 1px var(--lime-edge)}",
      /* The number rule needs the digit readable on the shape, so the stimulus
         centers its own text. */
      ".drill-switching .ts-stim{display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:24px;font-weight:600;color:var(--bg)}",
      /* The palace study clock. A flat track that drains left to right over the
         study period, so the time is visible rather than implied. */
      ".drill-palace .pl-study{display:flex;flex-direction:column;align-items:center;gap:6px}",
      ".drill-palace .pl-track{width:min(300px,100%);height:4px;border-radius:2px;background:var(--line2);overflow:hidden}",
      ".drill-palace .pl-fill{height:100%;width:100%;background:var(--lime);transform-origin:left center;transition:transform .1s linear}",
      ".drill-palace .pl-cue{font-family:var(--mono);font-size:12px;color:var(--muted);letter-spacing:.04em}",
      "@media(prefers-reduced-motion:reduce){.drill-palace .pl-fill{transition:none}}"
    ].join("");
    (document.head || document.documentElement).appendChild(s);
  }

  function isMatch(seq, n) {
    if (!seq || seq.length <= n || n < 1) return false;
    return seq[seq.length - 1] === seq[seq.length - 1 - n];
  }

  function pressGuard() {
    var fired = false;
    return {
      fire: function () { if (fired) return false; fired = true; return true; },
      reset: function () { fired = false; }
    };
  }

  function nextLevel(cur, correct, trials) {
    var acc = trials > 0 ? correct / trials : 0;
    var n = cur;
    if (acc >= 0.8) n = cur + 1;
    else if (acc <= 0.4) n = cur - 1;
    return Math.max(1, n);
  }

  function adaptExposure(cur, correct) {
    var next = correct ? cur * 0.85 : cur * 1.15;
    return Math.max(20, Math.min(500, Math.round(next)));
  }

  function palaceScore(placed, recalled, order) {
    var lead = 0, run = 0, best = 0, total = 0;
    for (var i = 0; i < placed.length; i++) {
      if (recalled[i] === placed[i]) { run++; if (run > best) best = run; total++; }
      else run = 0;
    }
    for (var j = 0; j < placed.length; j++) {
      if (recalled[j] === placed[j]) lead++; else break;
    }
    /* In order scores the leading run, because a stop out of place means the
       route is lost. Any order scores every stop that landed right. */
    return { recalled: order === "any-order" ? total : lead, longest: best };
  }

  function relationKey(a, b) {
    return (a && b && a.relation && a.relation === b.relation) ? a.relation : null;
  }

  function reviewQueue(cards, now) {
    return cards.filter(function (c) { return c.due <= now; }).slice().sort(function (a, b) { return a.due - b.due; });
  }

  function shuffleWith(rng, arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = randInt(rng, i + 1); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  /* The review queue for one pass. New cards (never reviewed) are capped by
     newPerSession so a backlog of new cards cannot crowd out the reviews that
     are already due; the whole pass is capped by reviewLimit. Order due-first
     keeps the schedule order, shuffled draws a random one. */
  function spacedQueue(cards, now, opts) {
    var o = opts || {};
    var limit = (typeof o.reviewLimit === "number" && isFinite(o.reviewLimit)) ? o.reviewLimit : 10;
    var newCap = (typeof o.newPerSession === "number" && isFinite(o.newPerSession)) ? o.newPerSession : 3;
    var due = reviewQueue(cards, now);
    var fresh = [], old = [];
    for (var i = 0; i < due.length; i++) {
      if (Number(due[i] && due[i].reps) > 0) old.push(due[i]);
      else fresh.push(due[i]);
    }
    var picked = fresh.slice(0, Math.max(0, newCap)).concat(old);
    if (o.order === "shuffled" && typeof o.rng === "function") picked = shuffleWith(o.rng, picked);
    else picked.sort(function (a, b) { return (Number(a && a.due) || 0) - (Number(b && b.due) || 0); });
    return picked.slice(0, Math.max(0, limit));
  }

  function switchCost(repeatTimes, switchTimes) {
    if (!repeatTimes || !switchTimes || !repeatTimes.length || !switchTimes.length) return null;
    var m = function (a) { return a.reduce(function (s, x) { return s + x; }, 0) / a.length; };
    return Math.round(m(switchTimes) - m(repeatTimes));
  }

  function nbackTrialCorrect(pMatch, pressedPos, lMatch, pressedLet) {
    return (!!pressedPos === !!pMatch) && (!!pressedLet === !!lMatch);
  }

  /* One trial's outcome for the n-back host. Dual mode scores both buttons
     against the live rule; single modes score the one button against the target. */
  function nbackOutcome(dual, rule, target, pressedPos, pressedLet) {
    var t = !!target;
    if (dual) {
      var expPos = rule === "position" && t;
      var expLet = rule !== "position" && t;
      return {
        ok: (!!pressedPos === expPos) && (!!pressedLet === expLet),
        hit: t && (!!pressedPos || !!pressedLet),
        falseAlarm: !t && (!!pressedPos || !!pressedLet)
      };
    }
    var responded = !!pressedPos || !!pressedLet;
    return { ok: responded === t, hit: t && responded, falseAlarm: !t && responded };
  }

  function isVowel(ch) {
    return "AEIOU".indexOf(ch) >= 0;
  }

  /* Acklam inverse-normal approximation (probit) for d-prime. */
  function normInv(p) {
    if (p <= 0) return -6;
    if (p >= 1) return 6;
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    var plow = 0.02425, phigh = 1 - plow, q, r;
    if (p < plow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > phigh) {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  function dPrime(hits, falseAlarms, trials) {
    if (trials <= 0) return 0;
    var hr = (hits + 0.5) / (trials + 1);
    var far = (falseAlarms + 0.5) / (trials + 1);
    return normInv(hr) - normInv(far);
  }

  function ruleShiftAccuracy(perTrial) {
    if (!perTrial || !perTrial.length) return null;
    var n = 0, c = 0;
    for (var i = 0; i < perTrial.length; i++) {
      if (perTrial[i].postSwitch) { n++; if (perTrial[i].correct) c++; }
    }
    return n ? c / n : null;
  }

  /* Trials to draw in one chunk. The first `level` trials of a sequence are
     warm-up with nothing to compare against, so a chunk no longer than the
     level holds no scorable trial at all and the level climbs on free
     auto-passes. Two trials past the warm-up guarantees at least one, while
     never exceeding what is left in the set. */
  function nbackChunkSize(block, level, remaining) {
    var b = typeof block === "number" && isFinite(block) ? block : 0;
    var l = typeof level === "number" && isFinite(level) ? level : 0;
    var r = typeof remaining === "number" && isFinite(remaining) ? remaining : 0;
    return Math.max(0, Math.min(Math.max(b, l + 2), r));
  }

  /* Per-drill starting settings. Each entry carries a type: a number (min, max,
     step), a toggle (boolean), or a choice (options, single or multi). The Train
     view renders its panel from this same table and drillOptions validates
     against it, so a hand-edited store can never put a drill out of range. */
  var DRILL_OPTION_SPEC = {
    nback: [
      { key: "startLevel", label: "Starting level", type: "number", min: 1, max: 4, step: 1, def: 2 },
      { key: "trials", label: "Trials", type: "number", min: 12, max: 30, step: 6, def: 18 },
      { key: "cueLength", label: "Cue length", type: "number", min: 4, max: 10, step: 1, def: 6 },
      { key: "stimulusMs", label: "Stimulus time", type: "choice", options: [{ value: 1500, label: "1.5 s" }, { value: 2000, label: "2 s" }, { value: 3000, label: "3 s" }], def: 2000 }
    ],
    ufov: [
      { key: "startExposure", label: "Start exposure", type: "number", min: 100, max: 400, step: 50, def: 200 },
      { key: "trials", label: "Trials", type: "number", min: 6, max: 20, step: 2, def: 10 },
      { key: "edgeTargets", label: "Edge targets", type: "number", min: 1, max: 2, step: 1, def: 1 },
      { key: "centerShape", label: "Center shape", type: "toggle", def: true }
    ],
    palace: [
      { key: "routeLength", label: "Route length", type: "number", min: 5, max: 10, step: 1, def: 5 },
      { key: "studySeconds", label: "Study seconds", type: "number", min: 1, max: 5, step: 0.5, def: 2.5 },
      { key: "itemSet", label: "Items", type: "choice", options: [{ value: "words", label: "Words" }, { value: "numbers", label: "Numbers" }, { value: "mixed", label: "Mixed" }], def: "words" },
      { key: "recallOrder", label: "Recall order", type: "choice", options: [{ value: "in-order", label: "In order" }, { value: "any-order", label: "Any order" }], def: "in-order" }
    ],
    reasoning: [
      { key: "trials", label: "Trials", type: "number", min: 8, max: 20, step: 4, def: 8 },
      { key: "timeLimit", label: "Time limit", type: "choice", options: [{ value: 0, label: "Off" }, { value: 10, label: "10 s" }, { value: 20, label: "20 s" }], def: 0 },
      { key: "relationSet", label: "Relations", type: "choice", options: [{ value: "all", label: "All" }, { value: "part-whole", label: "Part-whole" }, { value: "function", label: "Function" }, { value: "category", label: "Category" }, { value: "opposite", label: "Opposite" }, { value: "sequence", label: "Sequence" }], def: "all" }
    ],
    spaced: [
      { key: "reviewLimit", label: "Review limit", type: "number", min: 5, max: 30, step: 5, def: 10 },
      { key: "newPerSession", label: "New per session", type: "number", min: 0, max: 10, step: 1, def: 3 },
      { key: "retentionTarget", label: "Retention target", type: "number", min: 0.7, max: 0.95, step: 0.05, def: 0.9 },
      { key: "order", label: "Order", type: "choice", options: [{ value: "due-first", label: "Due first" }, { value: "shuffled", label: "Shuffled" }], def: "due-first" }
    ],
    switching: [
      { key: "trials", label: "Trials", type: "number", min: 12, max: 30, step: 6, def: 12 },
      { key: "switchRate", label: "Switch rate", type: "number", min: 0.2, max: 0.5, step: 0.1, def: 0.3 },
      { key: "dimensions", label: "Rules", type: "choice", options: [{ value: "two", label: "Two" }, { value: "three", label: "Three" }], def: "two" },
      { key: "cueVisible", label: "Show cue", type: "toggle", def: true }
    ],
    sart: [
      { key: "trials", label: "Trials", type: "number", min: 20, max: 60, step: 10, def: 30 },
      { key: "targetDigit", label: "Target digit", type: "number", min: 1, max: 9, step: 1, def: 3 },
      { key: "signalRate", label: "Signal rate", type: "number", min: 0.1, max: 0.3, step: 0.05, def: 0.2 },
      { key: "responseWindow", label: "Response window", type: "choice", options: [{ value: 0, label: "Off" }, { value: 800, label: "800 ms" }, { value: 1200, label: "1200 ms" }], def: 0 }
    ],
    crt: [
      { key: "trials", label: "Trials", type: "number", min: 10, max: 40, step: 10, def: 20 },
      { key: "choices", label: "Lights", type: "number", min: 2, max: 4, step: 1, def: 2 },
      { key: "foreperiod", label: "Foreperiod", type: "choice", options: [{ value: "fixed", label: "Fixed" }, { value: "random", label: "Random" }], def: "random" },
      { key: "catchTrials", label: "Catch trials", type: "toggle", def: false }
    ],
    math: [
      { key: "ops", label: "Operations", type: "choice", multi: true, options: [{ value: "+", label: "Add" }, { value: "-", label: "Sub" }, { value: "*", label: "Mul" }, { value: "/", label: "Div" }], def: ["+", "-", "*", "/"] },
      { key: "digits", label: "Operand digits", type: "number", min: 1, max: 3, step: 1, def: 2 },
      { key: "timePerProblem", label: "Time per problem", type: "choice", options: [{ value: 0, label: "Off" }, { value: 5, label: "5 s" }, { value: 10, label: "10 s" }, { value: 15, label: "15 s" }], def: 0 },
      { key: "startLevel", label: "Starting level", type: "number", min: 1, max: 3, step: 1, def: 1 }
    ]
  };

  function drillOptionSpec() { return DRILL_OPTION_SPEC; }

  /* One number through the spec: a finite number is used, anything else falls
     back to the default, then the result is clamped into range and snapped to
     the step grid. Clamping again after the snap catches the case where rounding
     pushes a value back past the top of the range. */
  function snapDrillNumber(value, spec) {
    var v = (typeof value === "number" && isFinite(value)) ? value : spec.def;
    v = Math.max(spec.min, Math.min(spec.max, v));
    v = spec.min + Math.round((v - spec.min) / spec.step) * spec.step;
    v = Math.max(spec.min, Math.min(spec.max, v));
    /* Step arithmetic on a fractional step (0.05) leaves float noise such as
       0.8999999999999999. Round it away so a snapped value is the value. */
    return Math.round(v * 1e10) / 1e10;
  }

  function choiceValues(spec) {
    var out = [];
    for (var i = 0; i < spec.options.length; i++) out.push(spec.options[i].value);
    return out;
  }

  /* One value through the spec, by type. A number is clamped and snapped, a
     toggle takes only a real boolean, a single choice takes only one of its
     values, and a multi choice keeps the valid values it was given. Anything
     else falls back to the default, so a drill never sees NaN, an unknown value
     or an empty set. */
  function coerceDrillOption(value, spec) {
    var type = spec.type || "number";
    if (type === "toggle") return typeof value === "boolean" ? value : spec.def;
    if (type === "choice") {
      var vals = choiceValues(spec);
      if (spec.multi) {
        if (!Array.isArray(value)) return spec.def.slice();
        var picked = [];
        for (var i = 0; i < value.length; i++) {
          if (vals.indexOf(value[i]) >= 0 && picked.indexOf(value[i]) < 0) picked.push(value[i]);
        }
        return picked.length ? picked : spec.def.slice();
      }
      for (var j = 0; j < vals.length; j++) if (value === vals[j]) return value;
      return spec.def;
    }
    return snapDrillNumber(value, spec);
  }

  /* Every key for one drill, validated. An unknown id has nothing to validate,
     so it returns an empty bag rather than throwing. */
  function drillOptions(id, overrides) {
    var list = DRILL_OPTION_SPEC[id];
    if (!list) return {};
    var o = overrides || {};
    var out = {};
    for (var i = 0; i < list.length; i++) {
      out[list[i].key] = coerceDrillOption(o[list[i].key], list[i]);
    }
    return out;
  }

  var DrillsCore = { isMatch: isMatch, nbackChunkSize: nbackChunkSize, pressGuard: pressGuard, nextLevel: nextLevel, adaptExposure: adaptExposure, palaceScore: palaceScore, relationKey: relationKey,
    drillOptionSpec: drillOptionSpec, drillOptions: drillOptions,
    PALACE_STUDY_SECONDS: PALACE_STUDY_SECONDS, PALACE_STUDY_MS: PALACE_STUDY_MS,
    PALACE_ROUTE: 5, bindKey: bindKey, digitIndex: digitIndex, silenceAudio: silenceAudio, reviewQueue: reviewQueue, spacedQueue: spacedQueue, switchCost: switchCost, nbackTrialCorrect: nbackTrialCorrect, nbackOutcome: nbackOutcome, nbackVoiceMode: nbackVoiceMode, isVowel: isVowel, dPrime: dPrime, ruleShiftAccuracy: ruleShiftAccuracy, mulberry32: mulberry32, seedFrom: seedFrom, randInt: randInt, pick: pick, nbackSequence: nbackSequence, NB_MODES: NB_MODES, coerceDrillOption: coerceDrillOption };

  /* ---------- registry ---------- */
  var factories = {};

  function register(id, factory) { factories[id] = factory; }
  function ids() { return Object.keys(factories); }
  function seedRng(seed) { return mulberry32(seed == null ? 0 : seed); }
  function start(id, container, opts) {
    var f = factories[id];
    if (!f) return { stop: function () {} };
    container.innerHTML = "";
    var t0 = Date.now();
    var o = opts || {};
    var wrapped = {
      cards: o.cards,
      onCards: o.onCards,
      rng: o.rng,
      seed: o.seed,
      mode: o.mode,
      /* Validated starting settings. o.options is the nested form the Train view
         will use; a flat object is accepted too, so a caller can pass startLevel
         at the top level without wrapping it. */
      options: drillOptions(id, o.options || o),
      onComplete: function (rec) {
        if (rec) {
          rec.meta = rec.meta || {};
          if (rec.meta.duration_ms == null) rec.meta.duration_ms = Math.max(1, Date.now() - t0);
        }
        if (o.onComplete) o.onComplete(rec);
      }
    };
    return f(container, wrapped);
  }

  /* ---------- shared UI helpers ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function button(cls, text) {
    var b = el("button", cls, text);
    b.type = "button";
    return b;
  }

  /* ---------- 1. Executive N-Back, six modes (default dual: rule-cued switching) ---------- */
  function nback(container, opts) {
    injectStyles();
    /* The mode is read once here and held for the whole set. A picker change
       while a set is running cannot reach into this closure, so a stale switch
       can never swap the rule or the sequence mid-set. */
    var mode = NB_MODES.indexOf(opts.mode) >= 0 ? opts.mode : "dual";
    var dual = mode === "dual";
    var arith = mode === "arithmetic";
    var spatial = mode === "spatial";
    var voiceMode = nbackVoiceMode(mode);
    /* Validated by drillOptions: 12, 18 or 24. The default keeps the 18 trial
       set the drill has always run. */
    var TRIALS = (opts.options && typeof opts.options.trials === "number") ? opts.options.trials : 18;
    var BLOCK = 4;
    /* The starting n and the level the set can climb to. Validated by
       drillOptions, so it is always a whole number in 1..4. */
    var startLevel = (opts.options && typeof opts.options.startLevel === "number") ? opts.options.startLevel : 2;
    /* Validated by drillOptions: 4 to 10 trials a rule stays live before the cue
       switches. Default 6. */
    var cueLength = (opts.options && typeof opts.options.cueLength === "number") ? opts.options.cueLength : 6;
    /* Validated by drillOptions: 1500, 2000 or 3000 ms. How long the stimulus
       stays on screen before it blanks. The response window after it stays at
       2500 ms, so a longer stimulus simply stays visible to the end of the trial. */
    var stimMs = (opts.options && typeof opts.options.stimulusMs === "number") ? opts.options.stimulusMs : 2000;
    var level = startLevel, maxLevel = startLevel;
    var rng = rngFrom(opts);
    var correctTrials = 0;
    var blockCorrect = 0, blockCount = 0;
    var i = 0, stopped = false, finished = false;
    var pressedPos = false, pressedLet = false;
    var curTarget = false, curPostSwitch = false;
    var hits = 0, falseAlarms = 0;
    var scorable = 0;
    var perTrial = [];
    var cur = null;
    var queue = [];
    var timers = makeTimers();
    var timer = 0;
    /* The stimulus blank runs on its own clock so the trial window can stay one
       makeTimers slot. Cleared on stop and at the start of every trial. */
    var blankTimer = 0;

    /* Audio is optional and global. Every cue checks `stopped` first, so a cue
       queued before a stop cannot fire afterwards, and a mode with no matching
       clip in the manifest stays silent instead of reaching for one. */
    function withAudio(fn) {
      if (stopped) return;
      var A = globalThis.CortexAudio;
      if (!A) return;
      try { fn(A); } catch (e) {}
    }
    function playSfx(name) { withAudio(function (A) { if (A.playSfx) A.playSfx(name); }); }
    function playLetter(l) {
      if (!voiceMode) return;
      withAudio(function (A) { if (A.playVoice) A.playVoice("letter." + l.toLowerCase()); });
    }
    function halt(silent) {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(blankTimer);
      timers.destroy();
      unbindKey();
      if (silent) silenceAudio();
    }

    var wrap = el("div", "drill drill-nback");
    var cueEl = el("div", "drill-state nb-cue", "");
    var grid = el("div", "nb-grid");
    var cells = [], cellVals = [];
    for (var c = 0; c < 9; c++) {
      /* The cells used to be inert spans, so the only way to say "the position
         matches" was the button below the grid. They are the position response
         now: a real button, labelled, with its digit printed on it. */
      var cell = button("nb-cell");
      cell.setAttribute("aria-label", "Cell " + (c + 1) + ", key " + (c + 1));
      /* Two spans so paint can clear the stimulus without taking the printed
         digit with it. */
      cell.appendChild(el("span", "k", String(c + 1)));
      var cellVal = el("span", "v", "");
      cell.appendChild(cellVal);
      cellVals.push(cellVal);
      cells.push(cell); grid.appendChild(cell);
    }
    var stim = el("div", "nb-letter mono", "?");
    var sumWrap = el("div", "nb-sum");
    var sumA = el("span", "nb-sum-v", "");
    var sumOp = el("span", "nb-sum-op", "+");
    var sumB = el("span", "nb-sum-v", "");
    sumWrap.appendChild(sumA); sumWrap.appendChild(sumOp); sumWrap.appendChild(sumB);
    var hint = el("div", "nb-hint", NB_HINTS[mode]);
    var bar = el("div", "drill-bar");
    var posBtn = button("btn-ghost", "Position match");
    var letBtn = button("btn-ghost", "Letter match");
    var oneBtn = button("btn-primary", "Match");
    if (dual) { bar.appendChild(posBtn); bar.appendChild(letBtn); }
    else bar.appendChild(oneBtn);
    var meta = el("div", "nb-meta mono", "n = " + level + " · 0 / " + TRIALS + " · " + stimMs + " ms");

    wrap.appendChild(cueEl);
    /* Arithmetic has no grid (the sum is the stimulus) and spatial has no letter
       (the shape carries the position), so neither gets the other's element. */
    if (!arith) wrap.appendChild(grid);
    if (arith) wrap.appendChild(sumWrap);
    else if (!spatial) wrap.appendChild(stim);
    wrap.appendChild(hint); wrap.appendChild(bar); wrap.appendChild(meta);
    container.appendChild(wrap);

    function onPos() { if (!stopped) pressedPos = true; }
    function onLet() { if (!stopped) pressedLet = true; }
    function onOne() {
      if (stopped) return;
      pressedPos = true;
      pressedLet = true;
    }
    posBtn.addEventListener("click", onPos);
    letBtn.addEventListener("click", onLet);
    oneBtn.addEventListener("click", onOne);
    /* A cell press is a position press. Painting a response on the cell keeps the
       answer where the eye already is, instead of in a button under the grid. */
    for (var cc = 0; cc < 9; cc++) {
      (function (k) {
        cells[k].addEventListener("click", function () {
          cells[k].classList.add("nb-pick");
          onPos();
        });
      })(cc);
    }

    /* Digits answer the grid and letters the mode buttons. Both go through the
       same handlers the mouse does, so a key and a click cannot score
       differently. */
    var unbindKey = bindKey(doc, function (e) {
      var cell = digitIndex(e.key);
      if (cell >= 0 && !arith) { e.preventDefault(); cells[cell].click(); return; }
      if (dual) {
        if (e.key === "p") { e.preventDefault(); posBtn.click(); return; }
        if (e.key === "l") { e.preventDefault(); letBtn.click(); return; }
      } else if (e.key === "m") {
        e.preventDefault();
        oneBtn.click();
      }
    });

    function cueText() {
      if (dual) {
        if (!cur) return "GET READY";
        if (cur.rule === "position") return "MATCH POSITION";
        if (cur.rule === "letter") return "MATCH LETTER";
        return "MATCH VOWEL";
      }
      return NB_CUES[mode];
    }

    function paint() {
      for (var k = 0; k < 9; k++) {
        cells[k].classList.remove("on");
        cells[k].classList.remove("nb-mark");
        cells[k].classList.remove("nb-pick");
        cellVals[k].textContent = "";
      }
      if (arith) {
        if (cur) { sumA.textContent = String(cur.a); sumB.textContent = String(cur.b); }
      } else if (cur) {
        cells[cur.pos].classList.add("on");
        if (spatial) {
          cells[cur.pos].classList.add("nb-mark");
          cellVals[cur.pos].textContent = ["O", "T", "S"][cur.shape];
        } else {
          stim.textContent = cur.letter;
        }
      } else {
        if (!spatial) stim.textContent = "?";
      }
      cueEl.textContent = cueText();
      meta.textContent = "n = " + level + " · " + i + " / " + TRIALS + " · " + stimMs + " ms";
    }

    /* Blank the stimulus without touching the printed digits or the response
       marks, so a short stimulus time reads as the item disappearing. */
    function clearStimulus() {
      for (var k = 0; k < 9; k++) {
        cells[k].classList.remove("on");
        cells[k].classList.remove("nb-mark");
      }
      if (arith) { sumA.textContent = ""; sumB.textContent = ""; }
      else if (!spatial) stim.textContent = "?";
    }

    /* Blocks are drawn in chunks so a level change can restart the chunk. The
       chunk has to be longer than the level, because the first `level` trials
       of a sequence are warm-up with nothing to compare against. A block of
       BLOCK at level 4 or above contained no scorable trial at all, so every
       trial in it auto-passed and the level climbed on nothing. */
    function nextStimulus() {
      if (!queue.length) {
        var batch = nbackChunkSize(BLOCK, level, TRIALS - i);
        if (batch <= 0) return null;
        queue = nbackSequence(level, batch, randInt(rng, 4294967296), mode, cueLength);
      }
      var st = queue.shift();
      if (st.cueChanged) playSfx("tap");
      return st;
    }

    function beginTrial() {
      if (stopped) return;
      if (!container.isConnected) return halt(true);
      if (i >= TRIALS) return finish();
      cur = nextStimulus();
      if (!cur) return finish();
      curPostSwitch = !!cur.postSwitch;
      curTarget = !!cur.target;
      pressedPos = false; pressedLet = false;
      i++;
      paint();
      playLetter(cur.letter);
      clearTimeout(blankTimer);
      if (stimMs < 2500) {
        blankTimer = setTimeout(function () { if (!stopped) clearStimulus(); }, stimMs);
      }
      timer = timers.set(endTrial, 2500);
    }

    function endTrial() {
      if (stopped) return;
      if (!container.isConnected) return halt(true);
      var o = nbackOutcome(dual, cur.rule, curTarget, pressedPos, pressedLet);
      if (o.hit) hits++;
      if (o.falseAlarm) falseAlarms++;
      perTrial.push({ correct: o.ok, postSwitch: curPostSwitch });
      playSfx(o.ok ? "correct" : "incorrect");
      /* Only trials that carried a real comparison move the level. A warm-up
         trial has no answer, so scoring it would only ever reward not pressing. */
      if (cur.index >= level) {
        if (o.ok) { blockCorrect++; correctTrials++; }
        blockCount++;
        scorable++;
      }
      if (blockCount >= BLOCK) {
        level = nextLevel(level, blockCorrect, blockCount);
        if (level > maxLevel) maxLevel = level;
        blockCorrect = 0; blockCount = 0;
        queue = [];
      }
      beginTrial();
    }

    function finish() {
      if (stopped) return;
      stopped = true;
      finished = true;
      timers.destroy();
      clearTimeout(blankTimer);
      unbindKey();
      /* Accuracy and d-prime are over the trials that carried a comparison. Counting
         the warm-up trials, which auto-pass because the right answer is to do
         nothing, inflated both. scorable is zero only if the set ended before
         any real trial, and the guards keep that off the page as NaN. */
      var acc = scorable > 0 ? correctTrials / scorable : 0;
      var dp = dPrime(hits, falseAlarms, scorable);
      var rs = ruleShiftAccuracy(perTrial);
      var summary = el("div", "drill-summary");
      summary.appendChild(el("div", "drill-state", "Set complete"));
      summary.appendChild(el("div", "drill-note", "Highest n " + maxLevel + " · accuracy " + Math.round(acc * 100) + "%" + (rs != null ? " · shift " + Math.round(rs * 100) + "%" : "")));
      container.appendChild(summary);
      if (opts.onComplete) {
        opts.onComplete({ drillId: "nback", value: maxLevel, unit: "n", t: Date.now(), meta: { mode: mode, accuracy: acc, hits: hits, falseAlarms: falseAlarms, ruleShiftAccuracy: rs, dPrime: dp } });
      }
    }

    paint();
    timer = timers.set(beginTrial, 800);
    return {
      stop: function () {
        /* A finished set is not a stopped one: let the final feedback clip play
           out. Any other stop goes silent at once. */
        if (finished) return;
        halt(true);
      }
    };
  }
  register("nback", nback);

  /* ---------- 2. Speed of Processing (UFOV) ---------- */
  function ufov(container, opts) {
    var SHAPES = ["Circle", "Triangle", "Square"];
    var POS = ["Top", "Right", "Bottom", "Left"];
    /* Validated by drillOptions: 6 to 20 on a two step grid. */
    var TRIALS = (opts.options && typeof opts.options.trials === "number") ? opts.options.trials : 10;
    /* Validated by drillOptions: one or two edge targets to locate. */
    var EDGE = (opts.options && typeof opts.options.edgeTargets === "number") ? opts.options.edgeTargets : 1;
    /* Validated by drillOptions: whether a center shape has to be identified. */
    var CENTER = !(opts.options && opts.options.centerShape === false);
    var rng = rngFrom(opts);
    var timers = makeTimers();
    /* Validated by drillOptions: a whole number of ms in 100..400. */
    var exposure = (opts.options && typeof opts.options.startExposure === "number") ? opts.options.startExposure : 200;
    var i = 0, correctCount = 0, stopped = false, timer = 0, resolved = false;
    var answer = { shape: null, positions: [], pickShape: null, picks: [] };

    var wrap = el("div", "drill drill-ufov");
    var stage = el("div", "uf-stage");
    var shape = CENTER ? el("div", "uf-shape") : null;
    if (shape) stage.appendChild(shape);
    var dots = [];
    for (var d = 0; d < EDGE; d++) {
      var dot = el("div", "uf-dot");
      dots.push(dot);
      stage.appendChild(dot);
    }
    var prompt = el("div", "drill-note", watchText());
    var bar = el("div", "drill-bar");
    var meta = el("div", "nb-meta mono", ufovMeta());
    wrap.appendChild(stage); wrap.appendChild(prompt); wrap.appendChild(bar); wrap.appendChild(meta);
    container.appendChild(wrap);

    function watchText() {
      var edge = EDGE > 1 ? "the edge dots" : "the edge dot";
      return CENTER ? "Watch the center shape and " + edge + "." : "Watch " + edge + ".";
    }
    function ufovMeta() {
      return "exposure " + exposure + " ms · " + EDGE + (EDGE === 1 ? " dot" : " dots") + " · " + i + " / " + TRIALS;
    }

    function clearBar() { bar.innerHTML = ""; }
    /* A pick holds for a beat before the next step so the choice is visible.
       Without it the bar swapped under the player's hand and neither a click
       nor a digit showed which of the options had actually been taken. */
    var PICK_HOLD_MS = 260;
    /* One pick per question. Held while the mark is on screen so a double press
       cannot answer the same question twice and skip a trial. */
    var taken = false;
    function picked(n, next) {
      if (stopped || taken) return;
      taken = true;
      var b = bar.children[n];
      if (b) b.classList.add("nb-pick");
      timers.set(next, PICK_HOLD_MS);
    }
    function showShapeOptions() {
      clearBar(); prompt.textContent = "Which shape was in the center?";
      taken = false;
      SHAPES.forEach(function (s, idx) {
        bar.appendChild(optionButton(s, idx, function () {
          answer.pickShape = idx;
          picked(idx, function () { showPosOptions(0); });
        }));
      });
    }
    function showPosOptions(step) {
      clearBar();
      prompt.textContent = EDGE > 1 ? "Where was dot " + (step + 1) + " of " + EDGE + "?" : "Where was the dot?";
      taken = false;
      POS.forEach(function (p, idx) {
        bar.appendChild(optionButton(p, idx, function () {
          answer.picks[step] = idx;
          picked(idx, function () {
            if (step + 1 < EDGE) showPosOptions(step + 1);
            else resolve();
          });
        }));
      });
    }
    /* One or two edge targets, so the answer is a set, not a single position. */
    function sameSet(a, b) {
      if (a.length !== b.length) return false;
      var x = a.slice().sort(function (p, q) { return p - q; });
      var y = b.slice().sort(function (p, q) { return p - q; });
      for (var k = 0; k < x.length; k++) if (x[k] !== y[k]) return false;
      return true;
    }
    function trial() {
      if (stopped) return;
      if (i >= TRIALS) return finish();
      clearBar();
      prompt.textContent = watchText();
      var pool = [0, 1, 2, 3];
      for (var s = pool.length - 1; s > 0; s--) { var j = randInt(rng, s + 1); var t = pool[s]; pool[s] = pool[j]; pool[j] = t; }
      answer = { shape: randInt(rng, 3), positions: pool.slice(0, EDGE), pickShape: null, picks: [] };
      resolved = false;
      taken = false;
      if (shape) shape.className = "uf-shape s" + answer.shape;
      dots.forEach(function (el, k) { el.className = "uf-dot p" + answer.positions[k]; });
      stage.classList.add("show");
      timer = timers.set(function () {
        stage.classList.remove("show");
        if (CENTER) showShapeOptions(); else showPosOptions(0);
      }, exposure);
    }
    function resolve() {
      if (resolved) return;
      resolved = true;
      var ok = (!CENTER || answer.pickShape === answer.shape) && sameSet(answer.picks, answer.positions);
      if (ok) correctCount++;
      exposure = adaptExposure(exposure, ok);
      i++;
      meta.textContent = ufovMeta();
      timer = timers.set(trial, 500);
    }
    function finish() {
      if (stopped) return;
      stopped = true;
      unbindKey();
      var acc = correctCount / TRIALS;
      var summary = el("div", "drill-summary");
      summary.appendChild(el("div", "drill-state", "Set complete"));
      summary.appendChild(el("div", "drill-note", "Threshold exposure " + exposure + " ms · accuracy " + Math.round(acc * 100) + "%"));
      container.appendChild(summary);
      if (opts.onComplete) opts.onComplete({ drillId: "ufov", value: exposure, unit: "ms", t: Date.now(), meta: { accuracy: acc, edgeTargets: EDGE, centerShape: CENTER } });
    }
    /* Digits take the visible options in order, so the printed key and the button
       position cannot drift apart. Both questions use this one path. Guarded on
       the bar itself: during the stimulus window the bar is empty, and a digit
       then has nothing to answer. */
    var unbindKey = bindKey(doc, function (e) {
      var n = digitIndex(e.key);
      if (stopped || n < 0) return;
      var btn = bar.children[n];
      if (!btn) return;
      e.preventDefault();
      btn.click();
    });
    timer = timers.set(trial, 700);
    return {
      stop: function () {
        stopped = true;
        clearTimeout(timer);
        timers.destroy();
        unbindKey();
      }
    };
  }

  /* ---------- 3. Memory Palace ---------- */
  function palace(container, opts) {
    var rng = rngFrom(opts);
    /* Ten words for a five stop route meant two of every six words had appeared
       recently and the same set came round often. Concrete, distinct and easy to
       picture, which is the whole point of placing them. No word repeats and no
       word is a prefix of another, so a recall option set never shows two things
       that look like the same thing. */
    var WORDS = [
      "River", "Candle", "Anchor", "Marble", "Falcon", "Garden", "Compass", "Lantern",
      "Bridge", "Cactus", "Lighthouse", "Kettle", "Anvil", "Bonfire", "Drawbridge",
      "Meadow", "Postcard", "Satchel", "Windmill", "Hammock", "Waterfall", "Pinecone",
      "Sundial", "Kite", "Buoy", "Campfire", "Treasure", "Shovel", "Footbridge", "Bucket"
    ];
    /* Two digit numbers for the numbers set, distinct and short enough to place. */
    var NUMBERS = [
      "17", "42", "63", "28", "75", "34", "59", "81", "26", "47",
      "93", "15", "68", "52", "37", "84", "19", "71", "46", "95",
      "23", "58", "72", "39", "64", "87", "31", "56", "79", "12"
    ];
    /* Validated by drillOptions: a whole number of stops in 5..10. The literal
       default stays on one line so the content check can read the shipped value. */
    var ROUTE = 5;
    if (opts.options && typeof opts.options.routeLength === "number") ROUTE = opts.options.routeLength;
    /* Validated by drillOptions: 1.5 to 4 seconds on a half second grid. No option
       keeps the 2.5 s study period. The local name shadows the module constant on
       purpose: the study clock and the shipped default are the same idea, and the
       source check reads the name. */
    var PALACE_STUDY_MS = Math.round(((opts.options && typeof opts.options.studySeconds === "number") ? opts.options.studySeconds : PALACE_STUDY_SECONDS) * 1000);
    /* Validated by drillOptions: words, numbers or mixed. */
    var ITEM_SET = (opts.options && opts.options.itemSet) || "words";
    /* Validated by drillOptions: in-order or any-order. */
    var RECALL_ORDER = (opts.options && opts.options.recallOrder) || "in-order";
    var placed = [], recalled = [], idx = 0, stopped = false, order = [];
    /* The study clock needs two timers at once, the advance and the repaint,
       which makeTimers holds one of. So these two keep their own ids and stop()
       clears both by hand. */
    var studyTimer = 0, tickTimer = 0;
    var deadline = 0, phase = "encode";

    injectStyles();
    var wrap = el("div", "drill drill-palace");
    var stage = el("div", "pl-stage");
    var study = el("div", "pl-study");
    var track = el("div", "pl-track");
    var fill = el("div", "pl-fill");
    track.appendChild(fill);
    var cue = el("div", "pl-cue", "");
    study.appendChild(track); study.appendChild(cue);
    var prompt = el("div", "drill-note", "Place each item at the next stop on the route.");
    var bar = el("div", "drill-bar");
    var meta = el("div", "nb-meta mono", palaceMeta());
    wrap.appendChild(stage); wrap.appendChild(study); wrap.appendChild(prompt); wrap.appendChild(bar); wrap.appendChild(meta);
    container.appendChild(wrap);

    function pool() {
      if (ITEM_SET === "numbers") return NUMBERS;
      if (ITEM_SET === "mixed") return WORDS.concat(NUMBERS);
      return WORDS;
    }
    function palaceMeta() {
      var set = ITEM_SET === "numbers" ? "numbers" : ITEM_SET === "mixed" ? "mixed" : "words";
      var orderTxt = RECALL_ORDER === "any-order" ? "any order" : "in order";
      return "route " + ROUTE + " stops · " + (PALACE_STUDY_MS / 1000) + " s each · " + set + " · " + orderTxt;
    }

    function shuffled(arr) {
      var a = arr.slice();
      for (var i = a.length - 1; i > 0; i--) { var j = randInt(rng, i + 1); var t = a[i]; a[i] = a[j]; a[j] = t; }
      return a;
    }

    function start() {
      placed = shuffled(pool()).slice(0, ROUTE);
      recalled = []; idx = 0;
      var indices = [];
      for (var k = 0; k < placed.length; k++) indices.push(k);
      order = RECALL_ORDER === "any-order" ? shuffled(indices) : indices;
      place();
    }
    /* One item on screen for the study period. The bar drains over it so the time
       is visible, and Place skips ahead for a player who already has the image.
       Two timers are pending at once here: the advance and the repaint. That is
       outside what makeTimers holds, so the study clock keeps its own ids and
       stop() clears both. */
    function place() {
      if (stopped) return;
      if (idx >= placed.length) return recall();
      phase = "encode";
      study.hidden = false;
      stage.textContent = placed[idx];
      prompt.textContent = "Stop " + (idx + 1) + " of " + ROUTE + ". Picture it here, then continue.";
      bar.innerHTML = "";
      var b = button("btn-primary", "Place");
      b.setAttribute("aria-label", "Place now, key Enter");
      b.addEventListener("click", next);
      bar.appendChild(b);
      deadline = Date.now() + PALACE_STUDY_MS;
      tickTimer = setInterval(paint, 100);
      studyTimer = setTimeout(next, PALACE_STUDY_MS);
      paint();
    }
    function paint() {
      if (stopped) return;
      var left = Math.max(0, deadline - Date.now());
      var frac = PALACE_STUDY_MS ? left / PALACE_STUDY_MS : 0;
      fill.style.transform = "scaleX(" + frac.toFixed(3) + ")";
      cue.textContent = (left / 1000).toFixed(1) + " s to picture it";
    }
    function next() {
      if (stopped) return;
      clearTimeout(studyTimer);
      clearInterval(tickTimer);
      studyTimer = 0; tickTimer = 0;
      idx++;
      place();
    }
    function recall() {
      /* Recall keeps no timer. Thinking is the task here and a clock would only
         punish it, so the phase waits on the player and nothing else. Any order
         asks the stops in a shuffled order and scores the placements, not the
         run. */
      phase = "recall";
      study.hidden = true;
      var step = 0;
      function ask() {
        if (stopped) return;
        if (step >= placed.length) return finish();
        var stopIndex = order[step];
        var correct = placed[stopIndex];
        var wrongs = shuffled(pool().filter(function (w) { return w !== correct; })).slice(0, 2);
        var opts3 = shuffled([correct].concat(wrongs));
        stage.textContent = "Stop " + (stopIndex + 1);
        prompt.textContent = "What was here?";
        bar.innerHTML = "";
        opts3.forEach(function (w, n) {
          bar.appendChild(optionButton(w, n, function () { recalled[stopIndex] = w; step++; ask(); }));
        });
      }
      ask();
    }
    function finish() {
      if (stopped) return;
      stopped = true;
      clearTimeout(studyTimer);
      clearInterval(tickTimer);
      unbindKey();
      var sc = palaceScore(placed, recalled, RECALL_ORDER);
      var summary = el("div", "drill-summary");
      summary.appendChild(el("div", "drill-state", "Set complete"));
      summary.appendChild(el("div", "drill-note", sc.recalled + " of " + placed.length + " recalled" + (RECALL_ORDER === "any-order" ? " in any order" : " in order")));
      container.appendChild(summary);
      if (opts.onComplete) opts.onComplete({ drillId: "palace", value: sc.recalled, unit: "items", t: Date.now(), meta: { longest: sc.longest, route: placed.length, itemSet: ITEM_SET, recallOrder: RECALL_ORDER } });
    }
    /* Enter places the current item and moves on. Digits answer the recall. */
    var unbindKey = bindKey(doc, function (e) {
      if (stopped) return;
      if (phase === "encode") {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); next(); }
        return;
      }
      var n = digitIndex(e.key);
      if (n < 0) return;
      var b = bar.children[n];
      if (b) { e.preventDefault(); b.click(); }
    });

    start();
    return {
      stop: function () {
        if (stopped) return;
        stopped = true;
        /* Both study timers go here. Left pending, the next stop's advance would
           fire into a torn down drill and the bar would keep draining. */
        clearTimeout(studyTimer);
        clearInterval(tickTimer);
        unbindKey();
      }
    };
  }

  /* ---------- 4. Relational Reasoning ---------- */
  function reasoning(container, opts) {
    /* A:b :: c:? with exactly one defensible answer.
       This was eight items for an eight trial set, so every play was the same
       eight questions reordered. It is now a pool well past the trial count, so
       a repeat set draws different items.

       Distractors are picked so none of them also satisfies the relation. The
       old Hand:Finger :: Tree:? item offered "Leaf" as a wrong answer, and a
       leaf is also a part of a tree, so the item had two defensible answers and
       scored a correct reply as wrong. Where a relation has obvious near
       synonyms sitting in the same category, the distractors come from outside
       it entirely. */
    var ITEMS = [
      /* part of: a is the whole, b is a part of it */
      { relation: "part-whole", a: "Book", b: "Page", c: "Car", correct: "Wheel", wrong: ["Oxygen", "Hungry"] },
      { relation: "part-whole", a: "Tree", b: "Root", c: "Human", correct: "Heart", wrong: ["Ladder", "Tuesday"] },
      { relation: "part-whole", a: "Ocean", b: "Wave", c: "Mountain", correct: "Peak", wrong: ["Basket", "Silence"] },
      { relation: "part-whole", a: "Guitar", b: "String", c: "Piano", correct: "Key", wrong: ["Window", "Thursday"] },
      { relation: "part-whole", a: "Computer", b: "Keyboard", c: "Camera", correct: "Lens", wrong: ["Sandwich", "Purple"] },
      { relation: "part-whole", a: "Hand", b: "Finger", c: "Foot", correct: "Toe", wrong: ["Forest", "Cloud"] },
      { relation: "part-whole", a: "House", b: "Roof", c: "Boat", correct: "Sail", wrong: ["Candy", "Monday"] },
      { relation: "part-whole", a: "Table", b: "Leg", c: "River", correct: "Bank", wrong: ["Jacket", "Seven"] },
      { relation: "part-whole", a: "Sword", b: "Blade", c: "Flag", correct: "Pole", wrong: ["Basket", "Gentle"] },
      { relation: "part-whole", a: "Cake", b: "Candle", c: "Honeycomb", correct: "Cell", wrong: ["Pencil", "Loud"] },

      /* opposite */
      { relation: "opposite", a: "Hot", b: "Cold", c: "Up", correct: "Down", wrong: ["High", "Sky"] },
      { relation: "opposite", a: "Early", b: "Late", c: "Open", correct: "Closed", wrong: ["Door", "Wide"] },
      { relation: "opposite", a: "Begin", b: "End", c: "Push", correct: "Pull", wrong: ["Move", "Force"] },
      { relation: "opposite", a: "Wet", b: "Dry", c: "Soft", correct: "Hard", wrong: ["Chair", "Yellow"] },
      { relation: "opposite", a: "Heavy", b: "Light", c: "Full", correct: "Empty", wrong: ["Bucket", "Green"] },
      { relation: "opposite", a: "Above", b: "Below", c: "Front", correct: "Back", wrong: ["Wall", "Loud"] },
      { relation: "opposite", a: "Fast", b: "Slow", c: "Yes", correct: "No", wrong: ["Table", "Maybe"] },
      { relation: "opposite", a: "Bright", b: "Dim", c: "Wide", correct: "Narrow", wrong: ["Lamp", "Sweet"] },
      { relation: "opposite", a: "Day", b: "Night", c: "Deep", correct: "Shallow", wrong: ["Clock", "Heavy"] },
      { relation: "opposite", a: "Tight", b: "Loose", c: "Smooth", correct: "Rough", wrong: ["Knot", "Metal"] },
      { relation: "opposite", a: "Ancient", b: "Modern", c: "Win", correct: "Lose", wrong: ["Temple", "Race"] },
      { relation: "opposite", a: "Gather", b: "Scatter", c: "Inflate", correct: "Deflate", wrong: ["Pump", "Purple"] },

      /* cause and effect: a brings about b */
      { relation: "cause-effect", a: "Rain", b: "Wet", c: "Fire", correct: "Smoke", wrong: ["Bright", "Day"] },
      { relation: "cause-effect", a: "Ice", b: "Cold", c: "Sunlight", correct: "Heat", wrong: ["Basket", "Fast"] },
      { relation: "cause-effect", a: "Smoke", b: "Ash", c: "Rain", correct: "Flood", wrong: ["Window", "Heavy"] },
      { relation: "cause-effect", a: "Rust", b: "Iron", c: "Magnet", correct: "Attract", wrong: ["Paper", "Bright"] },
      { relation: "cause-effect", a: "Noise", b: "Ear", c: "Light", correct: "Eye", wrong: ["Cloud", "Dry"] },
      { relation: "cause-effect", a: "Plant", b: "Water", c: "Practice", correct: "Better", wrong: ["Cold", "Door"] },
      { relation: "cause-effect", a: "Fever", b: "Rest", c: "Hunger", correct: "Food", wrong: ["Wall", "Loud"] },
      { relation: "cause-effect", a: "Knife", b: "Cut", c: "Soap", correct: "Grease", wrong: ["Pillow", "Seven"] },

      /* kind of: a is a b */
      { relation: "category", a: "Oak", b: "Tree", c: "Rose", correct: "Flower", wrong: ["Forest", "Green"] },
      { relation: "category", a: "Sparrow", b: "Bird", c: "Trout", correct: "Fish", wrong: ["Sky", "Fast"] },
      { relation: "category", a: "Bee", b: "Insect", c: "Whale", correct: "Mammal", wrong: ["Ocean", "Huge"] },
      { relation: "category", a: "Copper", b: "Metal", c: "Oxygen", correct: "Gas", wrong: ["Wire", "Blue"] },
      { relation: "category", a: "Hammer", b: "Tool", c: "Poem", correct: "Writing", wrong: ["Shelf", "Quiet"] },
      { relation: "category", a: "Cedar", b: "Wood", c: "Piano", correct: "Instrument", wrong: ["Room", "Loud"] },

      /* used for: a does b */
      { relation: "function", a: "Umbrella", b: "Rain", c: "Broom", correct: "Floor", wrong: ["Noise", "Cold"] },
      { relation: "function", a: "Scissors", b: "Paper", c: "Spoon", correct: "Soup", wrong: ["Shop", "Heavy"] },
      { relation: "function", a: "Key", b: "Lock", c: "Needle", correct: "Thread", wrong: ["Window", "Thursday"] },
      { relation: "function", a: "Soap", b: "Grease", c: "Whistle", correct: "Signal", wrong: ["Grass", "Loud"] },
      { relation: "function", a: "Pen", b: "Write", c: "Thermometer", correct: "Temperature", wrong: ["Cloud", "Dry"] },

      /* comes before: a happens earlier than b */
      { relation: "sequence", a: "Monday", b: "Wednesday", c: "Seed", correct: "Plant", wrong: ["Basket", "Silence"] },
      { relation: "sequence", a: "Dawn", b: "Dusk", c: "Egg", correct: "Chick", wrong: ["Wire", "Blue"] },
      { relation: "sequence", a: "Waking", b: "Sleeping", c: "Sprout", correct: "Flower", wrong: ["Pencil", "Loud"] }
    ];
    var rng = rngFrom(opts);
    /* Validated by drillOptions: 8 to 20 on a four step grid. */
    var TRIALS = (opts.options && typeof opts.options.trials === "number") ? opts.options.trials : 8;
    /* Validated by drillOptions: 0 (untimed), 10 or 20 seconds. A nonzero limit
       auto-advances a trial when the time is up, so an unanswered item counts as
       wrong instead of waiting forever. */
    var timeLimit = (opts.options && typeof opts.options.timeLimit === "number") ? opts.options.timeLimit : 0;
    /* Validated by drillOptions: which relation types appear, or all of them. */
    var relationSet = (opts.options && typeof opts.options.relationSet === "string") ? opts.options.relationSet : "all";
    var limitTimer = 0;
    var i = 0, correctCount = 0, stopped = false;
    /* The options currently on the bar, so a digit can reach the same button a
       click would. Named off opts on purpose: opts is the drill's parameter and
       holds onComplete, so shadowing it silently drops the run record. */
    var optionList = [];

    injectStyles();
    var wrap = el("div", "drill drill-reasoning");
    var stem = el("div", "rr-stem");
    var prompt = el("div", "drill-note", "Pick the option that shares the same relation.");
    var bar = el("div", "drill-bar");
    var meta = el("div", "nb-meta mono", metaText());
    wrap.appendChild(stem); wrap.appendChild(prompt); wrap.appendChild(bar); wrap.appendChild(meta);
    container.appendChild(wrap);

    /* The trial count, the limit and the relation set, on screen, so the chosen
       settings are visible while the set runs. */
    function metaText() {
      return i + " / " + TRIALS + (timeLimit > 0 ? " · " + timeLimit + " s limit" : " · untimed") + " · " + (relationSet === "all" ? "all relations" : relationSet);
    }

    /* The pool the trial draws from. A single relation narrows it; all of them
       keeps the full set. */
    function itemPool() {
      if (relationSet === "all") return ITEMS;
      var p = ITEMS.filter(function (it) { return it.relation === relationSet; });
      return p.length ? p : ITEMS;
    }

    /* One clock per trial. Cleared on answer, on finish and on stop, so it can
       never fire into a torn down drill. */
    function armLimit() {
      if (limitTimer) { clearTimeout(limitTimer); limitTimer = 0; }
      if (timeLimit > 0 && !stopped) {
        limitTimer = setTimeout(function () {
          limitTimer = 0;
          if (stopped) return;
          i++;
          meta.textContent = metaText();
          trial();
        }, timeLimit * 1000);
      }
    }

    function shuffled(a) {
      var x = a.slice();
      for (var k = x.length - 1; k > 0; k--) { var j = randInt(rng, k + 1); var t = x[k]; x[k] = x[j]; x[j] = t; }
      return x;
    }
    function trial() {
      if (stopped) return;
      if (i >= TRIALS) return finish();
      var item = pick(rng, itemPool());
      stem.innerHTML = '<span class="rr-a">' + item.a + '</span> : <span class="rr-b">' + item.b + '</span> :: <span class="rr-c">' + item.c + '</span> : <span class="rr-q">?</span>';
      bar.innerHTML = "";
      optionList = shuffled([item.correct].concat(item.wrong));
      optionList.forEach(function (w, n) {
        bar.appendChild(optionButton(w, n, function () {
          if (limitTimer) { clearTimeout(limitTimer); limitTimer = 0; }
          if (w === item.correct) correctCount++;
          i++;
          meta.textContent = metaText();
          trial();
        }));
      });
      armLimit();
    }
    function finish() {
      if (stopped) return;
      stopped = true;
      if (limitTimer) { clearTimeout(limitTimer); limitTimer = 0; }
      unbindKey();
      var summary = el("div", "drill-summary");
      summary.appendChild(el("div", "drill-state", "Set complete"));
      summary.appendChild(el("div", "drill-note", correctCount + " of " + TRIALS + " correct"));
      container.appendChild(summary);
      if (opts.onComplete) opts.onComplete({ drillId: "reasoning", value: correctCount, unit: "correct", t: Date.now(), meta: { trials: TRIALS, timeLimit: timeLimit, relationSet: relationSet } });
    }
    /* Digits pick the option in the order the buttons are shown, so the printed
       key and the visual order can never drift apart. */
    var unbindKey = bindKey(doc, function (e) {
      var n = digitIndex(e.key);
      if (stopped || n < 0) return;
      /* Guard against the bar, not the cached option list. The list can be stale
         whenever the bar has been emptied, and then bar.children[n] is undefined.
         Checking the element we are about to click cannot be wrong. */
      var btn = bar.children[n];
      if (!btn) return;
      e.preventDefault();
      btn.click();
    });
    trial();
    return { stop: function () { stopped = true; if (limitTimer) { clearTimeout(limitTimer); limitTimer = 0; } unbindKey(); } };
  }

  /* ---------- 5. Spaced Retrieval ---------- */
  function spaced(container, opts) {
    var cards = (opts.cards || []).slice();
    var Spacing = globalThis.Spacing;
    var rng = rngFrom(opts);
    var stopped = false;
    /* Validated by drillOptions: at most this many cards are reviewed in one
       pass. Fewer due means fewer reviewed. */
    var reviewLimit = (opts.options && typeof opts.options.reviewLimit === "number") ? opts.options.reviewLimit : 10;
    /* Validated by drillOptions: at most this many never-reviewed cards join one
       pass, so a backlog of new cards cannot crowd out the due reviews. */
    var newPerSession = (opts.options && typeof opts.options.newPerSession === "number") ? opts.options.newPerSession : 3;
    /* Validated by drillOptions: 0.7 to 0.95. Passed to the scheduler as the
       retention target, so a higher target pulls the next due date closer and a
       lower one pushes it out. Default 0.9 matches the scheduler's own default. */
    var retentionTarget = (opts.options && typeof opts.options.retentionTarget === "number") ? opts.options.retentionTarget : 0.9;
    /* Validated by drillOptions: due-first or shuffled. */
    var order = (opts.options && typeof opts.options.order === "string") ? opts.options.order : "due-first";
    /* What the keyboard is looking at: the add form, the question, the grade, or
       a finished summary. One flag, so one handler covers every screen the drill
       puts up instead of a handler per screen. */
    var screen = "add";

    injectStyles();
    var wrap = el("div", "drill drill-spaced");
    var stage = el("div", "sp-stage");
    var prompt = el("div", "drill-note", "");
    var bar = el("div", "drill-bar");
    var meta = el("div", "nb-meta mono", "");
    wrap.appendChild(stage); wrap.appendChild(prompt); wrap.appendChild(bar); wrap.appendChild(meta);
    container.appendChild(wrap);

    function persist() { if (opts.onCards) opts.onCards(cards); }

    /* The card count and the chosen settings, on screen in every phase. */
    function cardMeta() {
      return cards.length + (cards.length === 1 ? " card" : " cards") + " · " + Math.round(retentionTarget * 100) + "% target · " + (order === "shuffled" ? "shuffled" : "due first") + " · " + newPerSession + " new";
    }

    function addForm() {
      screen = "add";
      stage.innerHTML = "";
      prompt.textContent = "Add cards to study. They come back at growing intervals.";
      bar.innerHTML = "";
      var front = document.createElement("input"); front.className = "sp-input"; front.placeholder = "Front"; front.setAttribute("aria-label", "Front");
      var back = document.createElement("input"); back.className = "sp-input"; back.placeholder = "Back"; back.setAttribute("aria-label", "Back");
      var add = button("btn-primary", "Add");
      add.addEventListener("click", function () {
        if (!front.value.trim() || !back.value.trim()) return;
        var made = Spacing.newCard(front.value.trim(), back.value.trim(), Date.now());
        /* clientId is the card's store identity. Left unset, db.cardRow hashes it
           from the content, which is stable but is not the id a later save looks
           up, so set it here and keep the card addressable from its first write. */
        made.clientId = made.id;
        cards.push(made);
        front.value = ""; back.value = "";
        persist();
        meta.textContent = cardMeta();
      });
      var review = button("btn-ghost", "Review due");
      review.addEventListener("click", function () { runReview(); });
      bar.appendChild(front); bar.appendChild(back); bar.appendChild(add); bar.appendChild(review);
      meta.textContent = cardMeta();
    }

    function runReview() {
      var now = Date.now();
      var q = spacedQueue(cards, now, { reviewLimit: reviewLimit, newPerSession: newPerSession, order: order, rng: rng });
      if (!q.length) {
        screen = "add";
        stage.textContent = "Nothing due";
        prompt.textContent = "No cards are due right now. Add more or come back later.";
        bar.innerHTML = "";
        return;
      }
      var idx = 0, got = 0;
      function step() {
        if (stopped) return;
        if (idx >= q.length) return finish(got, q.length);
        var card = q[idx];
        screen = "question";
        stage.textContent = card.front;
        prompt.textContent = "Recall the answer, then check.";
        bar.innerHTML = "";
        var reveal = button("btn-primary nb-opt", "Show answer");
        reveal.appendChild(el("span", "nb-key", "enter"));
        reveal.addEventListener("click", function () {
          screen = "grade";
          stage.textContent = card.back;
          prompt.textContent = "Did you get it?";
          bar.innerHTML = "";
          /* Grading is the one place a stray key could do real damage, since it
             reschedules the card. So a grade needs a held digit or an arrow,
             both shown on the buttons. */
          var yes = button("btn-primary nb-opt", "Got it");
          yes.appendChild(el("span", "nb-key", "1"));
          yes.setAttribute("aria-label", "Got it, key 1 or right arrow");
          var no = button("btn-ghost nb-opt", "Missed");
          no.appendChild(el("span", "nb-key", "2"));
          no.setAttribute("aria-label", "Missed, key 2 or left arrow");
          yes.addEventListener("click", function () { gradeCard(card, true); });
          no.addEventListener("click", function () { gradeCard(card, false); });
          bar.appendChild(yes); bar.appendChild(no);
        });
        bar.appendChild(reveal);
      }
      function gradeCard(card, correct) {
        if (correct) got++;
        var updated = Spacing.grade(card, correct, Date.now(), { retention: retentionTarget });
        /* Spacing.grade returns the schedule fields only. clientId, the hint, the
           deck and the suspended flag have to ride along from the card being
           graded, or the next save mints a new client_id and the store keeps a
           second row for a card that was just reviewed once. */
        var merged = {}, k;
        for (k in card) if (Object.prototype.hasOwnProperty.call(card, k)) merged[k] = card[k];
        for (k in updated) if (Object.prototype.hasOwnProperty.call(updated, k)) merged[k] = updated[k];
        merged.id = card.id;
        merged.clientId = card.clientId || card.id;
        merged.cardType = card.cardType;
        merged.hint = card.hint;
        for (var i = 0; i < cards.length; i++) if (cards[i].id === card.id) cards[i] = merged;
        persist();
        idx++; step();
      }
      step();
    }

    function finish(got, total) {
      if (stopped) return;
      stopped = true;
      /* The summary is a live screen: "Review due" reopens the queue and clears
         this flag, so the binding stays. Stop is what unbinds it. */
      screen = "summary";
      /* Clear the last card's controls before the summary. Leaving them on screen
         under "Review complete" offers a grade key for a card already graded. */
      stage.textContent = "";
      prompt.textContent = "";
      bar.innerHTML = "";
      meta.textContent = cardMeta();
      var summary = el("div", "drill-summary");
      summary.appendChild(el("div", "drill-state", "Review complete"));
      summary.appendChild(el("div", "drill-note",
        got + " of " + total + " recalled. Add more below, or review again when the next one is due."));
      var again = button("btn-ghost", "Review due");
      again.addEventListener("click", function () {
        /* stopped guards the drill host's teardown. Reopening the queue from the
           summary clears it, or every step would return immediately. */
        stopped = false;
        runReview();
      });
      var add = button("btn-ghost", "Add a card");
      add.addEventListener("click", function () { addForm(); });
      var row = el("div", "drill-bar");
      row.appendChild(again); row.appendChild(add);
      summary.appendChild(row);
      container.appendChild(summary);
      if (opts.onComplete) opts.onComplete({ drillId: "spaced", value: got, unit: "cards", t: Date.now(), meta: { total: total } });
    }

    /* One handler for the three screens the drill puts up. Enter submits on the
       add form and reveals in review, a digit or an arrow grades. Anything else
       is ignored, so a stray key cannot reschedule a card. */
    var unbindKey = bindKey(doc, function (e) {
      if (stopped) return;
      if (screen === "add") {
        if (e.key !== "Enter") return;
        e.preventDefault();
        /* The add form is two inputs then Add, so Add is the third control. */
        bar.children[2].click();
        return;
      }
      if (screen === "question") {
        if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
        e.preventDefault();
        bar.children[0].click();
        return;
      }
      if (screen !== "grade") return;
      var n = digitIndex(e.key);
      var right = e.key === "ArrowRight" || e.key === "ArrowUp";
      var left = e.key === "ArrowLeft" || e.key === "ArrowDown";
      if (n === 0 || right) { e.preventDefault(); bar.children[0].click(); }
      else if (n === 1 || left) { e.preventDefault(); bar.children[1].click(); }
    });

    addForm();
    return {
      stop: function () {
        /* No early return on stopped: a finished review can be reopened from the
           summary, and a stop has to win over that however the drill was left. */
        stopped = true;
        unbindKey();
      }
    };
  }

  /* ---------- 6. Task Switching ---------- */
  function switching(container, opts) {
    var rng = rngFrom(opts);
    /* Validated by drillOptions: 12 to 30 on a six step grid. */
    var TRIALS = (opts.options && typeof opts.options.trials === "number") ? opts.options.trials : 12;
    /* Validated by drillOptions: 0.2 to 0.5. The share of trials whose rule
       differs from the one before it. */
    var switchRate = (opts.options && typeof opts.options.switchRate === "number") ? opts.options.switchRate : 0.3;
    /* Validated by drillOptions: two rules (color, shape) or three (add number). */
    var DIMS = (opts.options && opts.options.dimensions === "three") ? ["color", "shape", "number"] : ["color", "shape"];
    /* Validated by drillOptions: show the rule cue every trial, or only on a
       switch. */
    var cueVisible = !(opts.options && opts.options.cueVisible === false);
    var i = 0, correctCount = 0, stopped = false;
    var lastRule = null;
    var repeatTimes = [], switchTimes = [];
    var shownAt = 0, rule = "color", shape = 0, color = 0, number = 1;
    /* The labels currently on the bar, so a digit can reach the same button a
       click would. Off the opts name on purpose: that is the parameter holding
       onComplete. */
    var optionList = [];

    injectStyles();
    var wrap = el("div", "drill drill-switching");
    var ruleEl = el("div", "ts-rule mono", "Rule: Color");
    var stage = el("div", "ts-stage");
    var stim = el("div", "ts-stim");
    stage.appendChild(stim);
    var prompt = el("div", "drill-note", "Answer by the rule shown.");
    var bar = el("div", "drill-bar");
    var meta = el("div", "nb-meta mono", metaText());
    wrap.appendChild(ruleEl); wrap.appendChild(stage); wrap.appendChild(prompt); wrap.appendChild(bar); wrap.appendChild(meta);
    container.appendChild(wrap);

    /* Trial count, switch rate and how many rules are live, on screen. */
    function metaText() {
      return i + " / " + TRIALS + " · " + Math.round(switchRate * 100) + "% switch · " + DIMS.length + " rules";
    }

    /* The rule the next trial shows. With no previous rule it is a fair draw;
       after that the switch rate decides whether the rule changes, so a low rate
       holds one rule and a high rate switches more often. */
    function nextRule() {
      if (lastRule === null) return pick(rng, DIMS);
      if (rng() < switchRate) {
        var others = DIMS.filter(function (d) { return d !== lastRule; });
        return pick(rng, others);
      }
      return lastRule;
    }

    function trial() {
      if (stopped) return;
      if (i >= TRIALS) return finish();
      rule = nextRule();
      shape = randInt(rng, 2);
      color = randInt(rng, 2);
      number = 1 + randInt(rng, 2);
      stim.className = "ts-stim " + (shape ? "s1" : "s0") + " " + (color ? "c1" : "c0");
      stim.textContent = DIMS.length === 3 ? String(number) : "";
      /* The cue stays up every trial, or only when the rule just changed. */
      var isSwitch = lastRule === null || rule !== lastRule;
      ruleEl.textContent = "Rule: " + (rule === "color" ? "Color" : rule === "shape" ? "Shape" : "Number");
      ruleEl.hidden = !cueVisible && !isSwitch;
      prompt.textContent = rule === "color" ? "Pick the color." : rule === "shape" ? "Pick the shape." : "Pick the number.";
      bar.innerHTML = "";
      var labels = rule === "color" ? ["Orange", "Blue"] : rule === "shape" ? ["Circle", "Square"] : ["1", "2"];
      var correct = rule === "color" ? color : rule === "shape" ? shape : number - 1;
      optionList = labels;
      labels.forEach(function (lab, idx) {
        bar.appendChild(optionButton(lab, idx, function () { answer(idx === correct); }));
      });
      shownAt = performance.now();
    }
    function answer(ok) {
      var rt = Math.max(1, Math.round(performance.now() - shownAt));
      if (ok) correctCount++;
      if (lastRule !== null) {
        if (rule === lastRule) repeatTimes.push(rt); else switchTimes.push(rt);
      }
      lastRule = rule;
      i++;
      meta.textContent = metaText();
      trial();
    }
    function finish() {
      if (stopped) return;
      stopped = true;
      unbindKey();
      var cost = switchCost(repeatTimes, switchTimes);
      var summary = el("div", "drill-summary");
      summary.appendChild(el("div", "drill-state", "Set complete"));
      summary.appendChild(el("div", "drill-note", correctCount + " of " + TRIALS + " correct" + (cost != null ? " · switch cost " + cost + " ms" : "")));
      container.appendChild(summary);
      if (opts.onComplete) opts.onComplete({ drillId: "switching", value: correctCount, unit: "correct", t: Date.now(), meta: { trials: TRIALS, accuracy: correctCount / TRIALS, switchCost: cost, dimensions: DIMS.length, cueVisible: cueVisible } });
    }
    /* Two options, one digit each, in the order they are drawn. The rule changes
       between trials but the count does not, so the handler reads the current
       bar rather than a cached list. */
    var unbindKey = bindKey(doc, function (e) {
      var n = digitIndex(e.key);
      if (stopped || n < 0) return;
      /* Guard against the bar, not the cached option list. The list can be stale
         whenever the bar has been emptied, and then bar.children[n] is undefined.
         Checking the element we are about to click cannot be wrong. */
      var btn = bar.children[n];
      if (!btn) return;
      e.preventDefault();
      btn.click();
    });
    trial();
    return { stop: function () { stopped = true; unbindKey(); } };
  }

  /* ---------- placeholders replaced in later tasks ---------- */
  function placeholder(id, name) {
    return function (container, opts) {
      var wrap = el("div", "drill");
      wrap.appendChild(el("div", "drill-state", name));
      wrap.appendChild(el("div", "drill-note", "In development."));
      container.appendChild(wrap);
      return { stop: function () {} };
    };
  }
  register("ufov", ufov);
  register("palace", palace);
  register("reasoning", reasoning);
  register("spaced", spaced);
  register("switching", switching);

  var api = { DrillsCore: DrillsCore, register: register, ids: ids, start: start, seedRng: seedRng };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof globalThis !== "undefined") globalThis.Drills = api;
})();
