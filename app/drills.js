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
  function nbackSequence(level, trials, seed, mode) {
    var m = NB_MODES.indexOf(mode) >= 0 ? mode : "dual";
    var rng = mulberry32(seed == null ? 0 : seed);
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
          cueLeft = 5 + randInt(rng, 4);
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
        else if (wantLure && level > 1) sum = sumSeq[i - 1];
        else sum = randInt(rng, 17) + 2;
        /* Single digit operands, total under 20. */
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
      ".drill-nback .drill-bar{justify-content:center}"
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

  function palaceScore(placed, recalled) {
    var lead = 0, run = 0, best = 0;
    for (var i = 0; i < placed.length; i++) {
      if (recalled[i] === placed[i]) { run++; if (run > best) best = run; }
      else run = 0;
    }
    for (var j = 0; j < placed.length; j++) {
      if (recalled[j] === placed[j]) lead++; else break;
    }
    return { recalled: lead, longest: best };
  }

  function relationKey(a, b) {
    return (a && b && a.relation && a.relation === b.relation) ? a.relation : null;
  }

  function reviewQueue(cards, now) {
    return cards.filter(function (c) { return c.due <= now; }).slice().sort(function (a, b) { return a.due - b.due; });
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

  var DrillsCore = { isMatch: isMatch, nbackChunkSize: nbackChunkSize, pressGuard: pressGuard, nextLevel: nextLevel, adaptExposure: adaptExposure, palaceScore: palaceScore, relationKey: relationKey, reviewQueue: reviewQueue, switchCost: switchCost, nbackTrialCorrect: nbackTrialCorrect, nbackOutcome: nbackOutcome, nbackVoiceMode: nbackVoiceMode, isVowel: isVowel, dPrime: dPrime, ruleShiftAccuracy: ruleShiftAccuracy, mulberry32: mulberry32, seedFrom: seedFrom, randInt: randInt, pick: pick, nbackSequence: nbackSequence, NB_MODES: NB_MODES };

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
    var TRIALS = 18;
    var BLOCK = 4;
    var level = 2, maxLevel = 2;
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
    /* Web Audio here has no per-clip stop, so a stop suspends the shared context.
       The player resumes it on the next cue, so this cuts in-flight clips without
       any change to app/ui/audio.js. */
    function silenceAudio() {
      var A = globalThis.CortexAudio;
      if (!A || !A.ctx || typeof A.ctx.suspend !== "function") return;
      if (A.ctx.state === "running") { try { A.ctx.suspend(); } catch (e) {} }
    }
    function halt(silent) {
      stopped = true;
      clearTimeout(timer);
      timers.destroy();
      if (silent) silenceAudio();
    }

    var wrap = el("div", "drill drill-nback");
    var cueEl = el("div", "drill-state nb-cue", "");
    var grid = el("div", "nb-grid");
    var cells = [];
    for (var c = 0; c < 9; c++) {
      var cell = el("span", "nb-cell");
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
    var meta = el("div", "nb-meta mono", "n = 2 · 0 / " + TRIALS);

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
        cells[k].textContent = "";
      }
      if (arith) {
        if (cur) { sumA.textContent = String(cur.a); sumB.textContent = String(cur.b); }
      } else if (cur) {
        cells[cur.pos].classList.add("on");
        if (spatial) {
          cells[cur.pos].classList.add("nb-mark");
          cells[cur.pos].textContent = ["O", "T", "S"][cur.shape];
        } else {
          stim.textContent = cur.letter;
        }
      } else {
        if (!spatial) stim.textContent = "?";
      }
      cueEl.textContent = cueText();
      meta.textContent = "n = " + level + " · " + i + " / " + TRIALS;
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
        queue = nbackSequence(level, batch, randInt(rng, 4294967296), mode);
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
    var TRIALS = 10;
    var rng = rngFrom(opts);
    var timers = makeTimers();
    var exposure = 200, i = 0, correctCount = 0, stopped = false, timer = 0, resolved = false;
    var answer = { shape: null, pos: null, pickShape: null, pickPos: null };

    var wrap = el("div", "drill drill-ufov");
    var stage = el("div", "uf-stage");
    var shape = el("div", "uf-shape");
    var dot = el("div", "uf-dot");
    stage.appendChild(shape); stage.appendChild(dot);
    var prompt = el("div", "drill-note", "Watch the center shape and the edge dot.");
    var bar = el("div", "drill-bar");
    var meta = el("div", "nb-meta mono", "exposure 200 ms · 0 / " + TRIALS);
    wrap.appendChild(stage); wrap.appendChild(prompt); wrap.appendChild(bar); wrap.appendChild(meta);
    container.appendChild(wrap);

    function clearBar() { bar.innerHTML = ""; }
    function showShapeOptions() {
      clearBar(); prompt.textContent = "Which shape was in the center?";
      SHAPES.forEach(function (s, idx) {
        var b = button("btn-ghost", s);
        b.addEventListener("click", function () { answer.pickShape = idx; showPosOptions(); });
        bar.appendChild(b);
      });
    }
    function showPosOptions() {
      clearBar(); prompt.textContent = "Where was the dot?";
      POS.forEach(function (p, idx) {
        var b = button("btn-ghost", p);
        b.addEventListener("click", function () { answer.pickPos = idx; resolve(); });
        bar.appendChild(b);
      });
    }
    function trial() {
      if (stopped) return;
      if (i >= TRIALS) return finish();
      clearBar();
      prompt.textContent = "Watch the center shape and the edge dot.";
      answer = { shape: randInt(rng, 3), pos: randInt(rng, 4), pickShape: null, pickPos: null };
      resolved = false;
      shape.className = "uf-shape s" + answer.shape;
      dot.className = "uf-dot p" + answer.pos;
      stage.classList.add("show");
      timer = timers.set(function () {
        stage.classList.remove("show");
        showShapeOptions();
      }, exposure);
    }
    function resolve() {
      if (resolved) return;
      resolved = true;
      var ok = answer.pickShape === answer.shape && answer.pickPos === answer.pos;
      if (ok) correctCount++;
      exposure = adaptExposure(exposure, ok);
      i++;
      meta.textContent = "exposure " + exposure + " ms · " + i + " / " + TRIALS;
      timer = timers.set(trial, 500);
    }
    function finish() {
      if (stopped) return;
      stopped = true;
      var acc = correctCount / TRIALS;
      var summary = el("div", "drill-summary");
      summary.appendChild(el("div", "drill-state", "Set complete"));
      summary.appendChild(el("div", "drill-note", "Threshold exposure " + exposure + " ms · accuracy " + Math.round(acc * 100) + "%"));
      container.appendChild(summary);
      if (opts.onComplete) opts.onComplete({ drillId: "ufov", value: exposure, unit: "ms", t: Date.now(), meta: { accuracy: acc } });
    }
    timer = timers.set(trial, 700);
    return {
      stop: function () {
        stopped = true;
        clearTimeout(timer);
        timers.destroy();
      }
    };
  }

  /* ---------- 3. Memory Palace ---------- */
  function palace(container, opts) {
    var rng = rngFrom(opts);
    var WORDS = ["River", "Candle", "Anchor", "Marble", "Falcon", "Garden", "Compass", "Lantern", "Bridge", "Cactus"];
    var ROUTE = 5;
    var placed = [], recalled = [], idx = 0, stopped = false;

    var wrap = el("div", "drill drill-palace");
    var stage = el("div", "pl-stage");
    var prompt = el("div", "drill-note", "Place each item at the next stop on the route.");
    var bar = el("div", "drill-bar");
    var meta = el("div", "nb-meta mono", "route " + ROUTE + " stops");
    wrap.appendChild(stage); wrap.appendChild(prompt); wrap.appendChild(bar); wrap.appendChild(meta);
    container.appendChild(wrap);

    function shuffled(arr) {
      var a = arr.slice();
      for (var i = a.length - 1; i > 0; i--) { var j = randInt(rng, i + 1); var t = a[i]; a[i] = a[j]; a[j] = t; }
      return a;
    }

    function start() {
      placed = shuffled(WORDS).slice(0, ROUTE);
      recalled = []; idx = 0;
      place();
    }
    function place() {
      if (stopped) return;
      if (idx >= placed.length) return recall();
      stage.textContent = placed[idx];
      prompt.textContent = "Stop " + (idx + 1) + " of " + ROUTE + ". Place it, then continue.";
      bar.innerHTML = "";
      var b = button("btn-primary", "Place");
      b.addEventListener("click", function () { idx++; place(); });
      bar.appendChild(b);
    }
    function recall() {
      idx = 0;
      function step() {
        if (stopped) return;
        if (idx >= placed.length) return finish();
        var correct = placed[idx];
        var opts3 = shuffled([correct].concat(shuffled(WORDS.filter(function (w) { return w !== correct; })).slice(0, 2)));
        stage.textContent = "Stop " + (idx + 1);
        prompt.textContent = "What was here?";
        bar.innerHTML = "";
        opts3.forEach(function (w) {
          var b = button("btn-ghost", w);
          b.addEventListener("click", function () { recalled[idx] = w; idx++; step(); });
          bar.appendChild(b);
        });
      }
      step();
    }
    function finish() {
      if (stopped) return;
      stopped = true;
      var sc = palaceScore(placed, recalled);
      var summary = el("div", "drill-summary");
      summary.appendChild(el("div", "drill-state", "Set complete"));
      summary.appendChild(el("div", "drill-note", sc.recalled + " of " + placed.length + " recalled in order"));
      container.appendChild(summary);
      if (opts.onComplete) opts.onComplete({ drillId: "palace", value: sc.recalled, unit: "items", t: Date.now(), meta: { longest: sc.longest, route: placed.length } });
    }
    start();
    return { stop: function () { stopped = true; } };
  }

  /* ---------- 4. Relational Reasoning ---------- */
  function reasoning(container, opts) {
    var ITEMS = [
      { relation: "part-whole", a: "Hand", b: "Finger", c: "Tree", correct: "Branch", wrong: ["Forest", "Leaf"] },
      { relation: "opposite", a: "Hot", b: "Cold", c: "Up", correct: "Down", wrong: ["High", "Sky"] },
      { relation: "cause-effect", a: "Rain", b: "Wet", c: "Sun", correct: "Warm", wrong: ["Bright", "Day"] },
      { relation: "part-whole", a: "Car", b: "Wheel", c: "Book", correct: "Page", wrong: ["Shelf", "Read"] },
      { relation: "opposite", a: "Early", b: "Late", c: "Open", correct: "Closed", wrong: ["Door", "Wide"] },
      { relation: "cause-effect", a: "Fire", b: "Smoke", c: "Friction", correct: "Heat", wrong: ["Cold", "Speed"] },
      { relation: "part-whole", a: "Clock", b: "Hands", c: "Guitar", correct: "Strings", wrong: ["Song", "Wood"] },
      { relation: "opposite", a: "Begin", b: "End", c: "Push", correct: "Pull", wrong: ["Move", "Force"] }
    ];
    var rng = rngFrom(opts);
    var TRIALS = 8, i = 0, correctCount = 0, stopped = false;

    var wrap = el("div", "drill drill-reasoning");
    var stem = el("div", "rr-stem");
    var prompt = el("div", "drill-note", "Pick the option that shares the same relation.");
    var bar = el("div", "drill-bar");
    var meta = el("div", "nb-meta mono", "0 / " + TRIALS);
    wrap.appendChild(stem); wrap.appendChild(prompt); wrap.appendChild(bar); wrap.appendChild(meta);
    container.appendChild(wrap);

    function shuffled(a) {
      var x = a.slice();
      for (var k = x.length - 1; k > 0; k--) { var j = randInt(rng, k + 1); var t = x[k]; x[k] = x[j]; x[j] = t; }
      return x;
    }
    function trial() {
      if (stopped) return;
      if (i >= TRIALS) return finish();
      var item = pick(rng, ITEMS);
      stem.innerHTML = '<span class="rr-a">' + item.a + '</span> : <span class="rr-b">' + item.b + '</span> :: <span class="rr-c">' + item.c + '</span> : <span class="rr-q">?</span>';
      bar.innerHTML = "";
      shuffled([item.correct].concat(item.wrong)).forEach(function (w) {
        var b = button("btn-ghost", w);
        b.addEventListener("click", function () {
          if (w === item.correct) correctCount++;
          i++;
          meta.textContent = i + " / " + TRIALS;
          trial();
        });
        bar.appendChild(b);
      });
    }
    function finish() {
      if (stopped) return;
      stopped = true;
      var summary = el("div", "drill-summary");
      summary.appendChild(el("div", "drill-state", "Set complete"));
      summary.appendChild(el("div", "drill-note", correctCount + " of " + TRIALS + " correct"));
      container.appendChild(summary);
      if (opts.onComplete) opts.onComplete({ drillId: "reasoning", value: correctCount, unit: "correct", t: Date.now(), meta: { trials: TRIALS } });
    }
    trial();
    return { stop: function () { stopped = true; } };
  }

  /* ---------- 5. Spaced Retrieval ---------- */
  function spaced(container, opts) {
    var cards = (opts.cards || []).slice();
    var Spacing = globalThis.Spacing;
    var stopped = false;

    var wrap = el("div", "drill drill-spaced");
    var stage = el("div", "sp-stage");
    var prompt = el("div", "drill-note", "");
    var bar = el("div", "drill-bar");
    var meta = el("div", "nb-meta mono", "");
    wrap.appendChild(stage); wrap.appendChild(prompt); wrap.appendChild(bar); wrap.appendChild(meta);
    container.appendChild(wrap);

    function persist() { if (opts.onCards) opts.onCards(cards); }

    function addForm() {
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
        meta.textContent = cards.length + " cards";
      });
      var review = button("btn-ghost", "Review due");
      review.addEventListener("click", function () { runReview(); });
      bar.appendChild(front); bar.appendChild(back); bar.appendChild(add); bar.appendChild(review);
      meta.textContent = cards.length + " cards";
    }

    function runReview() {
      var now = Date.now();
      var q = reviewQueue(cards, now);
      if (!q.length) {
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
        stage.textContent = card.front;
        prompt.textContent = "Recall the answer, then check.";
        bar.innerHTML = "";
        var reveal = button("btn-primary", "Show answer");
        reveal.addEventListener("click", function () {
          stage.textContent = card.back;
          prompt.textContent = "Did you get it?";
          bar.innerHTML = "";
          var yes = button("btn-primary", "Got it");
          var no = button("btn-ghost", "Missed");
          yes.addEventListener("click", function () { gradeCard(card, true); });
          no.addEventListener("click", function () { gradeCard(card, false); });
          bar.appendChild(yes); bar.appendChild(no);
        });
        bar.appendChild(reveal);
      }
      function gradeCard(card, correct) {
        if (correct) got++;
        var updated = Spacing.grade(card, correct, Date.now());
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
      /* Clear the last card's controls before the summary. Leaving them on screen
         under "Review complete" offers a grade key for a card already graded. */
      stage.textContent = "";
      prompt.textContent = "";
      bar.innerHTML = "";
      meta.textContent = cards.length + (cards.length === 1 ? " card" : " cards");
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

    addForm();
    return { stop: function () { stopped = true; } };
  }

  /* ---------- 6. Task Switching ---------- */
  function switching(container, opts) {
    var rng = rngFrom(opts);
    var TRIALS = 12;
    var i = 0, correctCount = 0, stopped = false;
    var lastRule = null;
    var repeatTimes = [], switchTimes = [];
    var shownAt = 0, rule = "color", shape = 0, color = 0;

    var wrap = el("div", "drill drill-switching");
    var ruleEl = el("div", "ts-rule mono", "Rule: Color");
    var stage = el("div", "ts-stage");
    var stim = el("div", "ts-stim");
    stage.appendChild(stim);
    var prompt = el("div", "drill-note", "Answer by the rule shown.");
    var bar = el("div", "drill-bar");
    var meta = el("div", "nb-meta mono", "0 / " + TRIALS);
    wrap.appendChild(ruleEl); wrap.appendChild(stage); wrap.appendChild(prompt); wrap.appendChild(bar); wrap.appendChild(meta);
    container.appendChild(wrap);

    function trial() {
      if (stopped) return;
      if (i >= TRIALS) return finish();
      rule = rng() < 0.5 ? "color" : "shape";
      shape = randInt(rng, 2);
      color = randInt(rng, 2);
      stim.className = "ts-stim " + (shape ? "s1" : "s0") + " " + (color ? "c1" : "c0");
      ruleEl.textContent = "Rule: " + (rule === "color" ? "Color" : "Shape");
      prompt.textContent = rule === "color" ? "Pick the color." : "Pick the shape.";
      bar.innerHTML = "";
      var labels = rule === "color" ? ["Orange", "Blue"] : ["Circle", "Square"];
      var correct = rule === "color" ? color : shape;
      labels.forEach(function (lab, idx) {
        var b = button("btn-ghost", lab);
        b.addEventListener("click", function () { answer(idx === correct); });
        bar.appendChild(b);
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
      meta.textContent = i + " / " + TRIALS;
      trial();
    }
    function finish() {
      if (stopped) return;
      stopped = true;
      var cost = switchCost(repeatTimes, switchTimes);
      var summary = el("div", "drill-summary");
      summary.appendChild(el("div", "drill-state", "Set complete"));
      summary.appendChild(el("div", "drill-note", correctCount + " of " + TRIALS + " correct" + (cost != null ? " · switch cost " + cost + " ms" : "")));
      container.appendChild(summary);
      if (opts.onComplete) opts.onComplete({ drillId: "switching", value: correctCount, unit: "correct", t: Date.now(), meta: { trials: TRIALS, accuracy: correctCount / TRIALS, switchCost: cost } });
    }
    trial();
    return { stop: function () { stopped = true; } };
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
