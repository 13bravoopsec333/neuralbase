/* Neuralbase extra drills: sart (go/no-go sustained attention), crt (choice reaction
   time), math (mental arithmetic sprint). Pure helpers on DrillsExtraCore, DOM
   factories registered into the existing Drills registry. */
(function () {
  "use strict";

  /* ---------- pure helpers ---------- */

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randInt(rng, n) {
    n = Math.floor(n);
    if (!(n > 0)) return 0;
    var x = Math.floor(rng() * n);
    if (!(x >= 0)) x = 0;
    if (x >= n) x = n - 1;
    return x;
  }

  function pick(rng, arr) {
    if (!arr || !arr.length) return undefined;
    return arr[randInt(rng, arr.length)];
  }

  /* A seeded stream for a passed seed. Train hands over an eight digit hex
     label, so the seed can be a string; DrillsCore.mulberry32 already hashes a
     string seed the same way every other drill's stream does. Falling back to
     the local mulberry32 keeps the helper working if DrillsCore is not loaded. */
  function seedRng(seed) {
    var D = globalThis.Drills && globalThis.Drills.DrillsCore;
    if (D && typeof D.mulberry32 === "function") return D.mulberry32(seed);
    return mulberry32(seed);
  }

  function rngFor(opts) {
    var o = opts || {};
    if (typeof o.rng === "function") return o.rng;
    if (o.seed != null) return seedRng(o.seed);
    return mulberry32(Date.now());
  }

  function median(list) {
    var xs = [];
    for (var i = 0; i < (list || []).length; i++) {
      var v = list[i];
      if (typeof v === "number" && isFinite(v)) xs.push(v);
    }
    if (!xs.length) return null;
    xs.sort(function (a, b) { return a - b; });
    var m = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
  }

  /* SART scoring. A trial is correct either when the target is pressed or a
     non-target is held back. A missed target (omission) and a press on a
     non-target (commission) are both errors, so a flawless run scores 100%. */
  var SART_TARGET = 3;

  function scoreSart(trials, targetDigit) {
    var target = targetDigit == null ? SART_TARGET : targetDigit;
    var t = trials || [];
    var omissions = 0, commissions = 0, hits = 0, withheld = 0, rts = [];
    for (var i = 0; i < t.length; i++) {
      var tr = t[i] || {};
      var isTarget = Number(tr.digit) === target;
      if (isTarget) {
        if (tr.pressed) {
          hits++;
          if (typeof tr.rt === "number" && isFinite(tr.rt)) rts.push(tr.rt);
        } else {
          omissions++;
        }
      } else if (tr.pressed) {
        commissions++;
      } else {
        withheld++;
      }
    }
    var correct = hits + withheld;
    var med = median(rts);
    return {
      trials: t.length,
      hits: hits,
      omissions: omissions,
      commissions: commissions,
      correct: correct,
      accuracy: t.length ? correct / t.length : 0,
      rtMedian: med == null ? null : Math.round(med)
    };
  }

  function pickChoice(medianRt, maxLights) {
    var cap = (typeof maxLights === "number" && maxLights >= 2) ? Math.floor(maxLights) : 3;
    if (typeof medianRt !== "number" || !isFinite(medianRt) || medianRt <= 0) return Math.min(2, cap);
    if (medianRt < 250 && cap >= 4) return 4;
    if (medianRt < 350) return Math.min(3, cap);
    return 2;
  }

  /* The wait before a light, in ms. Fixed is one steady beat; random spreads it,
     which stops a fast player from predicting the light. */
  function crtForeperiod(kind, rng) {
    if (kind === "fixed") return 800;
    return 400 + randInt(rng, 1200);
  }

  /* The labels for n lights. Two are the outer lanes, three add the center, four
     split the center. */
  function laneLabels(n) {
    if (n <= 2) return ["Left", "Right"];
    if (n === 3) return ["Left", "Center", "Right"];
    return ["Left", "Center left", "Center right", "Right"];
  }

  /* Whether a trial shows no light at all. Only when catch trials are on. */
  function crtIsCatch(catchOn, rng) {
    return !!catchOn && rng() < 0.2;
  }

  function problem(level, op, a, b, expected) {
    return { level: level, op: op, a: a, b: b, expected: expected, text: a + " " + op + " " + b };
  }

  /* level 0: addition and subtraction inside 30.
     level 1: adds times tables and exact division by 2 to 9.
     level 2: addition and subtraction inside 100, and times tables and exact
     division using factors 2 to 12. Every operation tier 1 has stays available,
     with larger operands.
     opts.ops is the set of enabled operations; opts.digits caps the operand
     width (1, 2 or 3 digits). Both default to the shipped behaviour. */
  function makeProblem(level, rng, opts) {
    var o = opts || {};
    var lvl = Math.floor(Number(level) || 0);
    if (lvl < 0) lvl = 0;
    if (lvl > 2) lvl = 2;
    var digits = Math.floor(Number(o.digits) || 2);
    if (digits < 1) digits = 1;
    if (digits > 3) digits = 3;
    var cap = Math.pow(10, digits) - 1;
    var enabled = (Array.isArray(o.ops) && o.ops.length) ? o.ops : ["+", "-", "*", "/"];
    var allowed = lvl === 0 ? ["+", "-"] : ["+", "-", "*", "/"];
    var kinds = enabled.filter(function (x) { return allowed.indexOf(x) >= 0; });
    /* A user who turns off every operation the level allows still gets the ones
       they kept, rather than an empty draw. */
    if (!kinds.length) kinds = enabled.slice();
    var op = pick(rng, kinds);
    /* Three digit operands have to reach three digits even at the default
       level, otherwise the setting does nothing until level 2. Below that, the
       level still holds addition inside 30 and subtraction inside 30. */
    var wide = lvl >= 2 || digits >= 3;
    if (op === "+") {
      var hi = wide ? cap : Math.min(cap, 29);
      hi = Math.max(1, hi);
      var a = 1 + randInt(rng, hi), b = 1 + randInt(rng, hi + 1 - a);
      return problem(lvl, "+", a, b, a + b);
    }
    if (op === "-") {
      var capMinus = wide ? cap : Math.min(cap, 30);
      capMinus = Math.max(1, capMinus);
      var c = 1 + randInt(rng, capMinus), d = 1 + randInt(rng, capMinus);
      return problem(lvl, "-", c, d, c - d);
    }
    var hiF = Math.max(2, Math.min(lvl >= 2 ? 12 : 9, cap));
    if (op === "*") {
      var f = 2 + randInt(rng, hiF - 1), g = 2 + randInt(rng, hiF - 1);
      return problem(lvl, "*", f, g, f * g);
    }
    var q = 2 + randInt(rng, hiF - 1), m = 2 + randInt(rng, hiF - 1);
    return problem(lvl, "/", q * m, m, q);
  }

  /* Tolerant numeric parse: surrounding and inner whitespace, a leading + or -,
     nothing else. Never shows a minus-sign convention to learn. */
  function checkAnswer(input, expected) {
    if (input == null) return false;
    var s = String(input).replace(/\s+/g, "");
    if (!s) return false;
    var sign = 1;
    var first = s.charAt(0);
    if (first === "+" || first === "-") {
      if (first === "-") sign = -1;
      s = s.slice(1);
    }
    if (!/^[0-9]+$/.test(s)) return false;
    return sign * parseInt(s, 10) === expected;
  }

  var DrillsExtraCore = {
    silenceAudio: silenceAudio,
    mulberry32: mulberry32,
    randInt: randInt,
    pick: pick,
    median: median,
    medianRt: median,
    scoreSart: scoreSart,
    sartDigit: sartDigit,
    pickChoice: pickChoice,
    crtForeperiod: crtForeperiod,
    laneLabels: laneLabels,
    crtIsCatch: crtIsCatch,
    makeProblem: makeProblem,
    checkAnswer: checkAnswer,
    SART_TARGET: SART_TARGET
  };

  /* ---------- scoped styles (theme tokens only) ---------- */

  var STYLE_ID = "nb-extra-drill-styles";

  function injectStyles() {
    if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = [
      ".nx-digit{display:flex;align-items:center;justify-content:center;min-height:118px;padding:16px 8px;border-radius:var(--r);border:1px solid var(--line2);background:var(--panel2);color:var(--ink);font-size:clamp(54px,15vw,92px);font-weight:600;line-height:1;transition:opacity .12s linear,border-color .12s linear,background-color .12s linear}",
      ".nx-digit.ok{border-color:var(--lime-edge);background:var(--lime-soft);color:var(--lime)}",
      ".nx-digit.warn{border-color:var(--warn);color:var(--warn)}",
      ".nx-cue{min-height:20px;font-family:var(--mono);font-size:12.5px;color:var(--muted)}",
      ".nx-press{min-height:48px;flex:1;max-width:230px}",
      ".nx-lanes{display:grid;gap:10px}",
      ".nx-lane{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-height:64px;padding:8px 4px;border-radius:var(--r);border:1px solid var(--line2);background:var(--panel2);color:var(--ink);font-size:17px;font-weight:600;cursor:pointer;transition:opacity .1s linear,border-color .1s linear,background-color .1s linear}",
      ".nx-lane .k{font-family:var(--mono);font-size:10.5px;color:var(--dim)}",
      ".nx-lane.lit{border-color:var(--lime-edge);background:var(--lime-soft);color:var(--lime)}",
      ".nx-lane.lit .k{color:var(--lime)}",
      ".nx-lane.miss{border-color:var(--warn);color:var(--warn)}",
      ".nx-lane.miss .k{color:var(--warn)}",
      ".nx-math{display:flex;flex-direction:column;gap:12px}",
      ".nx-problem{font-family:var(--mono);font-size:clamp(26px,8vw,38px);font-weight:600;text-align:center;letter-spacing:.04em;min-height:42px;overflow-wrap:anywhere}",
      ".nx-row{display:flex;gap:10px;flex-wrap:wrap;align-items:stretch}",
      ".nx-in{flex:1;min-width:110px;min-height:48px;padding:10px 12px;border-radius:8px;border:1px solid var(--line2);background:var(--panel2);color:var(--ink);font:inherit;font-family:var(--mono);font-size:19px;text-align:center}",
      ".nx-in:focus{outline:2px solid var(--lime-edge);outline-offset:1px}",
      ".nx-pad{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-width:320px}",
      ".nx-key{min-height:48px;border-radius:8px;border:1px solid var(--line2);background:var(--panel2);color:var(--ink);font-family:var(--mono);font-size:18px;cursor:pointer}",
      ".nx-key:focus-visible{outline:2px solid var(--lime-edge);outline-offset:1px}",
      ".nx-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}",
      "@media(max-width:420px){.nx-lane{font-size:15px;min-height:58px}.nx-press{max-width:none}}",
      "@media(prefers-reduced-motion:reduce){.nx-digit,.nx-lane{transition:opacity .12s linear}}"
    ].join("");
    document.head.appendChild(s);
  }

  /* ---------- shared DOM helpers ---------- */

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

  function playSfx(name) {
    var A = globalThis.CortexAudio;
    if (A && A.playSfx) { try { A.playSfx(name); } catch (e) {} }
  }

  /* Web Audio has no per clip stop, so a stopped drill suspends the shared
     context. The next drill resumes it on its first cue, which cuts anything
     still sounding without a change to app/ui/audio.js. Same tool n-back uses. */
  function silenceAudio() {
    var A = globalThis.CortexAudio;
    if (!A || !A.ctx || typeof A.ctx.suspend !== "function") return;
    if (A.ctx.state === "running") { try { A.ctx.suspend(); } catch (e) {} }
  }

  /* The host-side endless helpers live on DrillsCore. An endless run banks its
     partial only when the focus stage is down (End Session), deferred a tick so
     the host finishes stopping the set first, exactly like n-back. Fall back to a
     direct call if core is not loaded. */
  function focusStageUp() {
    var D = globalThis.Drills && globalThis.Drills.DrillsCore;
    return !!(D && typeof D.focusStageUp === "function" && D.focusStageUp());
  }
  function reportEndlessPartial(opts, rec) {
    var D = globalThis.Drills && globalThis.Drills.DrillsCore;
    if (D && typeof D.reportEndlessPartial === "function") return D.reportEndlessPartial(opts, rec);
    if (opts && typeof opts.onComplete === "function") opts.onComplete(rec);
  }

  /* One teardown for every drill here: clear the clock, drop both listeners, and
     usually go quiet. Both exit paths call it, so no way out of a drill can leave
     a timer running or a key bound. A finished set passes silent, the same
     choice n-back makes, so the final feedback clip is allowed to ring out. */
  function makeTeardown(clock, unbindVis, unbindKey) {
    var done = false;
    return function (silent) {
      if (done) return;
      done = true;
      if (clock && clock.clearAll) clock.clearAll();
      if (typeof unbindVis === "function") unbindVis();
      if (typeof unbindKey === "function") unbindKey();
      if (silent !== false) silenceAudio();
    };
  }

  /* One clock per drill. Holds at most one pending timeout, freezes it while the
     tab is hidden, and reports the hidden milliseconds so reaction times stay clean. */
  function makeClock() {
    var items = {}, seq = 0, hidden = false, hiddenMs = 0, hideAt = 0;
    function arm(id) {
      var it = items[id];
      if (!it || hidden) return;
      it.at = Date.now();
      it.handle = setTimeout(function () {
        var fn = items[id] ? items[id].fn : null;
        delete items[id];
        if (fn) fn();
      }, Math.max(0, it.remaining));
    }
    return {
      set: function (fn, delay) {
        var id = ++seq;
        items[id] = { fn: fn, remaining: delay, handle: null };
        arm(id);
        return id;
      },
      clear: function (id) {
        var it = items[id];
        if (!it) return;
        if (it.handle) clearTimeout(it.handle);
        delete items[id];
      },
      clearAll: function () {
        for (var k in items) if (items[k] && items[k].handle) clearTimeout(items[k].handle);
        items = {};
      },
      hide: function () {
        if (hidden) return;
        hidden = true;
        hideAt = Date.now();
        for (var j in items) {
          var it = items[j];
          if (!it.handle) continue;
          clearTimeout(it.handle);
          it.handle = null;
          it.remaining = Math.max(0, it.remaining - (Date.now() - it.at));
        }
      },
      show: function () {
        if (!hidden) return;
        hidden = false;
        hiddenMs += Date.now() - hideAt;
        for (var m in items) arm(+m);
      },
      hiddenMs: function () { return hiddenMs; }
    };
  }

  /* Freezes the clock while the tab is hidden and while the focus stage's exit
     confirmation is up. The stage dispatches nb:pause on document when the
     dialog opens and nb:resume on Keep Training, so a trial behind the modal
     neither times out nor counts hidden milliseconds. Both signals share one
     frozen state, so a resume with the tab still hidden stays frozen. */
  function bindVisibility(doc, clock) {
    if (!doc || typeof doc.addEventListener !== "function") return function () {};
    var visHidden = false, paused = false;
    function apply() {
      if (visHidden || paused) clock.hide(); else clock.show();
    }
    function onVis() { visHidden = !!doc.hidden; apply(); }
    function onPause() { paused = true; apply(); }
    function onResume() { paused = false; apply(); }
    doc.addEventListener("visibilitychange", onVis);
    doc.addEventListener("nb:pause", onPause);
    doc.addEventListener("nb:resume", onResume);
    return function () {
      doc.removeEventListener("visibilitychange", onVis);
      doc.removeEventListener("nb:pause", onPause);
      doc.removeEventListener("nb:resume", onResume);
    };
  }

  /* Forwards every keydown; each drill filters and calls preventDefault itself.
     Auto-repeat is dropped here, once, rather than in each handler: a held key
     would otherwise answer the next trial before it could be read. */
  function bindKey(doc, fn) {
    if (!doc || typeof doc.addEventListener !== "function") return function () {};
    function handler(e) { if (e.repeat) return; fn(e); }
    doc.addEventListener("keydown", handler);
    return function () { doc.removeEventListener("keydown", handler); };
  }

  function summaryEl(head, note) {
    var s = el("div", "drill-summary");
    s.appendChild(el("div", "drill-state", head));
    s.appendChild(el("div", "drill-note", note));
    return s;
  }

  var doc = typeof document !== "undefined" ? document : null;

  /* ---------- 1. SART, go/no-go sustained attention ---------- */

  var SART_TRIALS = 30;
  var SART_BEAT = 1000;
  var SART_FILLERS = [1, 2, 4, 5, 6, 7, 8, 9];

  function sartDigit(rng, target, rate) {
    var t = target == null ? SART_TARGET : target;
    var r = (typeof rate === "number" && isFinite(rate)) ? rate : 0.2;
    return rng() < r ? t : pick(rng, SART_FILLERS);
  }

  function sart(container, opts) {
    injectStyles();
    var rng = rngFor(opts);
    var clock = makeClock();
    var stopped = false, done = false;
    var i = 0, trials = [], timerId = 0;
    /* Validated by drillOptions: 20 to 60 on a ten step grid. Default 30. Endless
       removes the ceiling: the stream never ends on its own. */
    var endless = !!(opts.options && opts.options.endless);
    var bankPartial = false;
    var total = endless ? Infinity : ((opts.options && typeof opts.options.trials === "number") ? opts.options.trials : SART_TRIALS);
    /* Validated by drillOptions: 1 to 9. The digit the player must withhold on.
       Default 3 is the classic SART target. */
    var targetDigit = (opts.options && typeof opts.options.targetDigit === "number") ? opts.options.targetDigit : SART_TARGET;
    /* Validated by drillOptions: 0.1 to 0.3. How often the target appears. */
    var signalRate = (opts.options && typeof opts.options.signalRate === "number") ? opts.options.signalRate : 0.2;
    /* Validated by drillOptions: off, 800 or 1200 ms. Off keeps the one second
       beat the drill has always used. */
    var responseWindow = (opts.options && typeof opts.options.responseWindow === "number") ? opts.options.responseWindow : 0;
    var windowMs = responseWindow > 0 ? responseWindow : SART_BEAT;
    var curDigit = 0, shownAt = 0, resolved = true;

    var wrap = el("div", "drill drill-sart");
    var stage = el("div", "nx-digit mono", "-");
    var live = el("div", "nx-sr");
    live.setAttribute("aria-live", "polite");
    live.setAttribute("aria-atomic", "true");
    var cue = el("div", "nx-cue", "Press only on the digit " + targetDigit + ".");
    cue.setAttribute("aria-live", "polite");
    var bar = el("div", "drill-bar");
    var pressBtn = button("btn-primary nx-press", "Press on " + targetDigit);
    bar.appendChild(pressBtn);
    var meta = el("div", "nb-meta mono", sartMeta());
    var note = el("div", "drill-note", "A steady stream of digits, one at a time. Press on " + targetDigit + " and hold back on everything else. Trains sustained attention.");
    wrap.appendChild(stage);
    wrap.appendChild(live);
    wrap.appendChild(cue);
    wrap.appendChild(note);
    wrap.appendChild(bar);
    wrap.appendChild(meta);
    container.appendChild(wrap);

    function sartMeta() {
      return (endless ? String(i) : i + " / " + total) + " · " + Math.round(signalRate * 100) + "% signal · " + (responseWindow > 0 ? responseWindow + " ms" : "Off");
    }

    var unbindVis = bindVisibility(doc, clock);
    var unbindKey = bindKey(doc, function (e) {
      var k = e.key;
      if (k !== " " && k !== "Spacebar" && k !== "Enter") return;
      e.preventDefault();
      respond();
    });
    var teardown = makeTeardown(clock, unbindVis, unbindKey);

    function react(rt) {
      resolved = true;
      clock.clear(timerId);
      var target = curDigit === targetDigit;
      trials.push({
        digit: curDigit,
        pressed: true,
        rt: target && typeof rt === "number" ? Math.max(1, Math.round(rt)) : null
      });
      if (target) {
        stage.className = "nx-digit mono ok";
        cue.textContent = "on target";
        playSfx("correct");
      } else {
        stage.className = "nx-digit mono warn";
        cue.textContent = "pressed, and that was not a " + targetDigit;
        playSfx("incorrect");
      }
      live.textContent = cue.textContent;
      clock.set(next, 240);
    }

    function withhold() {
      resolved = true;
      clock.clear(timerId);
      var target = curDigit === targetDigit;
      trials.push({ digit: curDigit, pressed: false, rt: null });
      if (target) {
        stage.className = "nx-digit mono warn";
        cue.textContent = "the " + targetDigit + " went by";
        playSfx("tap");
      } else {
        stage.className = "nx-digit mono ok";
        cue.textContent = "held";
        playSfx("tap");
      }
      live.textContent = cue.textContent;
      clock.set(next, 240);
    }

    function respond() {
      if (stopped || done || resolved) return;
      react(Date.now() - shownAt - clock.hiddenMs());
    }

    function next() {
      if (stopped) return;
      if (i >= total) return finish();
      i++;
      curDigit = sartDigit(rng, targetDigit, signalRate);
      resolved = false;
      shownAt = Date.now();
      stage.className = "nx-digit mono";
      stage.textContent = String(curDigit);
      /* Clear the last trial's outcome, so it does not sit under the new digit. */
      cue.textContent = "";
      live.textContent = "Digit " + curDigit;
      meta.textContent = sartMeta();
      timerId = clock.set(withhold, windowMs);
    }

    function finish() {
      if (done) return;
      done = true;
      stopped = true;
      /* A finished set is not a stopped one, so the final clip is left to play.
         The clock and the listeners still go: nothing should outlive the drill
         just because the last clip is allowed to ring. */
      teardown(false);
      var sc = scoreSart(trials, targetDigit);
      container.appendChild(summaryEl(
        "Set complete",
        sc.correct + " of " + sc.trials + " correct · " +
        sc.omissions + " lapses · " + sc.commissions + " false presses" +
        (sc.rtMedian == null ? "" : " · median press " + sc.rtMedian + " ms")
      ));
      if (opts.onComplete) {
        var rec = {
          drillId: "sart",
          value: sc.correct,
          unit: "correct",
          t: Date.now(),
          meta: {
            trials: sc.trials,
            hits: sc.hits,
            omissions: sc.omissions,
            commissions: sc.commissions,
            accuracy: sc.accuracy,
            rtMedian: sc.rtMedian
          }
        };
        if (bankPartial) reportEndlessPartial(opts, rec); else opts.onComplete(rec);
      }
    }

    pressBtn.addEventListener("click", function () { respond(); });
    timerId = clock.set(next, 900);
    return {
      stop: function () {
        if (endless && trials.length > 0 && !done && !focusStageUp()) { bankPartial = true; finish(); silenceAudio(); return; }
        if (stopped) return;
        stopped = true;
        teardown(true);
      }
    };
  }

  /* ---------- 2. CRT, choice reaction time ---------- */

  var CRT_TRIALS = 20;
  var CRT_WINDOW = 1200;
  var CRT_KEYS = ["1", "2", "3", "4"];

  function crt(container, opts) {
    injectStyles();
    var rng = rngFor(opts);
    var clock = makeClock();
    var stopped = false, done = false;
    var i = 0, choice = 2, hits = 0, misses = 0, catchHits = 0, rts = [];
    /* Validated by drillOptions: 10 to 40 on a ten step grid. Endless removes the
       ceiling: the set never completes on its own. */
    var endless = !!(opts.options && opts.options.endless);
    var bankPartial = false;
    var total = endless ? Infinity : ((opts.options && typeof opts.options.trials === "number") ? opts.options.trials : CRT_TRIALS);
    /* Validated by drillOptions: 2 to 4. The number of lights the set starts on.
       The adaptive rule widens it as reactions speed up, up to the chosen count. */
    var choices = (opts.options && typeof opts.options.choices === "number") ? opts.options.choices : 2;
    var maxLights = Math.max(3, choices);
    choice = choices;
    /* Validated by drillOptions: fixed or random. The wait before a light. */
    var foreperiod = (opts.options && opts.options.foreperiod === "fixed") ? "fixed" : "random";
    /* Validated by drillOptions: whether some trials show no light and require no
       press. */
    var catchTrials = !!(opts.options && opts.options.catchTrials);
    var shownAt = 0, litIdx = -1, targetLane = 0, resolved = true, timerId = 0;
    var isCatch = false;
    var lanes = [], laneEls = [];

    var wrap = el("div", "drill drill-crt");
    var stage = el("div", "nx-lanes");
    var cue = el("div", "nx-cue", "Wait for a light, then press it.");
    cue.setAttribute("aria-live", "polite");
    var note = el("div", "drill-note", crtNote());
    var meta = el("div", "nb-meta mono", crtMeta());
    wrap.appendChild(stage);
    wrap.appendChild(cue);
    wrap.appendChild(note);
    wrap.appendChild(meta);
    container.appendChild(wrap);

    function crtMeta() {
      return (endless ? String(i) : i + " / " + total) + " · " + choice + " lights · " + foreperiod + (catchTrials ? " · catch" : "");
    }
    function crtNote() {
      if (choice >= 4) return "Four lights. Trains simple reaction speed.";
      if (choice === 3) return "Three lights. Trains simple reaction speed.";
      return "Two lights now. Move to three once your median reaction time drops under 350 ms.";
    }

    var unbindVis = bindVisibility(doc, clock);
    var unbindKey = bindKey(doc, function (e) {
      var idx = CRT_KEYS.indexOf(e.key);
      if (idx >= 0) press(idx);
    });
    var teardown = makeTeardown(clock, unbindVis, unbindKey);

    function layout() {
      var labels = laneLabels(choice);
      if (labels.length === lanes.length) return;
      lanes = labels;
      while (stage.firstChild) stage.removeChild(stage.firstChild);
      laneEls = [];
      lanes.forEach(function (label, pos) {
        var b = button("nx-lane", label);
        b.setAttribute("aria-label", label + ", key " + (pos + 1));
        var k = el("span", "k", "key " + (pos + 1));
        b.appendChild(k);
        b.addEventListener("click", function () { press(pos); });
        stage.appendChild(b);
        laneEls.push(b);
      });
      stage.style.gridTemplateColumns = "repeat(" + lanes.length + ",1fr)";
      note.textContent = crtNote();
    }

    function reset() {
      for (var q = 0; q < laneEls.length; q++) laneEls[q].className = "nx-lane";
      litIdx = -1;
    }

    function paintLit() {
      for (var q = 0; q < laneEls.length; q++) {
        laneEls[q].className = laneEls[q].className.replace(" lit", "");
      }
      if (litIdx >= 0) laneEls[litIdx].className = "nx-lane lit";
    }

    /* A short gap after feedback, then the foreperiod, then the light. The two
       timers run in sequence, never at once. */
    function afterAnswer() { timerId = clock.set(schedule, 260); }
    function schedule() {
      if (stopped || done) return;
      timerId = clock.set(light, crtForeperiod(foreperiod, rng));
    }

    function press(pos) {
      if (stopped || done || resolved) return;
      /* On a catch trial there is no light, so any press is an error. */
      if (isCatch) {
        resolved = true;
        clock.clear(timerId);
        misses++;
        cue.textContent = "no light there";
        playSfx("incorrect");
        meta.textContent = crtMeta();
        afterAnswer();
        return;
      }
      if (litIdx < 0 || pos < 0 || pos >= lanes.length) return;
      resolved = true;
      clock.clear(timerId);
      var rt = Math.max(1, Date.now() - shownAt - clock.hiddenMs());
      if (pos === litIdx) {
        hits++;
        rts.push(rt);
        litIdx = -1;
        paintLit();
        cue.textContent = "hit";
        playSfx("correct");
        choice = pickChoice(median(rts), maxLights);
        layout();
      } else {
        misses++;
        litIdx = -1;
        paintLit();
        laneEls[pos].className = "nx-lane miss";
        cue.textContent = "wrong button";
        playSfx("incorrect");
      }
      meta.textContent = crtMeta();
      afterAnswer();
    }

    function timeout() {
      if (stopped || done || resolved) return;
      resolved = true;
      misses++;
      litIdx = -1;
      paintLit();
      cue.textContent = "too slow";
      playSfx("incorrect");
      meta.textContent = crtMeta();
      afterAnswer();
    }

    function catchTimeout() {
      if (stopped || done || resolved) return;
      resolved = true;
      catchHits++;
      cue.textContent = "held";
      playSfx("tap");
      meta.textContent = crtMeta();
      afterAnswer();
    }

    function light() {
      if (stopped) return;
      if (i >= total) return finish();
      i++;
      layout();
      resolved = false;
      reset();
      isCatch = crtIsCatch(catchTrials, rng);
      shownAt = Date.now();
      if (isCatch) {
        litIdx = -1;
        cue.textContent = "hold";
        meta.textContent = crtMeta();
        timerId = clock.set(catchTimeout, CRT_WINDOW);
      } else {
        targetLane = randInt(rng, lanes.length);
        litIdx = targetLane;
        paintLit();
        cue.textContent = "go";
        meta.textContent = crtMeta();
        timerId = clock.set(timeout, CRT_WINDOW);
      }
    }

    function finish() {
      if (done) return;
      done = true;
      stopped = true;
      teardown(false);
      var med = median(rts);
      var fast = rts.length ? Math.min.apply(null, rts) : null;
      var value = med == null ? CRT_WINDOW : Math.round(med);
      /* Every trial lands in exactly one bucket: a hit, a miss (including a
         press on a catch trial), or a correctly held catch trial. Accuracy is
         the correct share, so a run that errs on every catch cannot read the
         same as a clean one. A partial endless run divides by the trials it
         actually attempted. */
      var denom = endless ? i : total;
      var accuracy = denom > 0 ? (hits + catchHits) / denom : 0;
      container.appendChild(summaryEl(
        "Set complete",
        value + " ms median · " + hits + " hits · " + misses + " missed" +
        (catchTrials ? " · " + catchHits + " held" : "") +
        (fast == null ? "" : " · fastest " + Math.round(fast) + " ms")
      ));
      if (opts.onComplete) {
        var rec = {
          drillId: "crt",
          value: value,
          unit: "ms",
          t: Date.now(),
          meta: {
            trials: denom,
            hits: hits,
            misses: misses,
            catchHits: catchHits,
            accuracy: accuracy,
            medianRt: med == null ? null : Math.round(med),
            fastestRt: fast == null ? null : Math.round(fast),
            choice: choices,
            foreperiod: foreperiod,
            catchTrials: catchTrials
          }
        };
        if (bankPartial) reportEndlessPartial(opts, rec); else opts.onComplete(rec);
      }
    }

    layout();
    timerId = clock.set(schedule, 900);
    return {
      stop: function () {
        if (endless && i > 0 && !done && !focusStageUp()) { bankPartial = true; finish(); silenceAudio(); return; }
        if (stopped) return;
        stopped = true;
        teardown(true);
      }
    };
  }

  /* ---------- 3. Mental math sprint ---------- */

  var MATH_TRIALS = 20;
  var MATH_PROBE = 8;
  var MATH_KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "-", "0", "C"];

  function math(container, opts) {
    injectStyles();
    var rng = rngFor(opts);
    var clock = makeClock();
    var stopped = false, done = false;
    var i = 0, level = 0, correct = 0, levelSet = false;
    /* Endless removes the twenty-problem ceiling: the sprint never completes on
       its own and the count has no denominator. */
    var endless = !!(opts.options && opts.options.endless);
    var bankPartial = false;
    var total = endless ? Infinity : MATH_TRIALS;
    /* The panel's starting level maps onto the generator's three tiers: 1 is the
       current default (add and subtract), 2 starts on times tables and division,
       3 starts on the wide-range tier. A start above tier one marks the level as
       already set, so the eight-trial promotion probe cannot pull it back down. */
    var startLevel = (opts.options && typeof opts.options.startLevel === "number") ? opts.options.startLevel : 1;
    level = startLevel - 1;
    levelSet = startLevel > 1;
    /* Validated by drillOptions: the enabled operations, at least one. */
    var ops = (opts.options && Array.isArray(opts.options.ops) && opts.options.ops.length) ? opts.options.ops : ["+", "-", "*", "/"];
    /* Validated by drillOptions: operand width, 1 to 3 digits. Default 2. */
    var digits = (opts.options && typeof opts.options.digits === "number") ? opts.options.digits : 2;
    /* Validated by drillOptions: off, 5, 10 or 15 seconds per problem. Off means
       the problem waits for an answer. */
    var timePerProblem = (opts.options && typeof opts.options.timePerProblem === "number") ? opts.options.timePerProblem : 0;
    var problemMs = timePerProblem > 0 ? timePerProblem * 1000 : 0;
    var cur = null, shownAt = 0, resolved = true, timerId = 0;
    var times = [];

    /* Trial count, running score, the clock and the live operations, on screen. */
    function metaText() {
      return (endless ? String(i) : i + " / " + total) + " · " + correct + " correct · " + (problemMs > 0 ? timePerProblem + " s" : "untimed") + " · " + ops.join("");
    }

    var wrap = el("div", "drill drill-math");
    var prompt = el("div", "nx-problem mono", "");
    var row = el("div", "nx-row");
    var input = document.createElement("input");
    input.type = "text";
    input.className = "nx-in mono";
    input.setAttribute("aria-label", "Your answer");
    input.setAttribute("inputmode", "numeric");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("spellcheck", "false");
    row.appendChild(input);
    /* The keypad stays. inputmode="numeric" hides the minus key on most mobile
       keyboards, and subtraction problems do produce negative answers, so the
       on-screen minus is the only way to enter one there. */
    var pad = el("div", "nx-pad");
    MATH_KEYS.forEach(function (k) {
      var b = button("nx-key", k);
      b.setAttribute("aria-label", k === "C" ? "Clear" : k === "-" ? "Minus sign" : "Digit " + k);
      b.addEventListener("click", function () { tap(k); });
      pad.appendChild(b);
    });
    var meta = el("div", "nb-meta mono", metaText());
    wrap.appendChild(prompt);
    wrap.appendChild(row);
    wrap.appendChild(pad);
    wrap.appendChild(meta);
    container.appendChild(wrap);

    var unbindVis = bindVisibility(doc, clock);

    function tap(k) {
      if (stopped || done || resolved) return;
      if (k === "C") { input.value = ""; return; }
      if (k === "-") {
        input.value = input.value.charAt(0) === "-" ? input.value.slice(1) : "-" + input.value;
        autoSubmit();
        return;
      }
      if (input.value.length < 6) { input.value += k; autoSubmit(); }
    }

    /* Zetamac style: the moment the typed value is exactly the answer, it is
       submitted. Anything else is left alone and waits for the next keystroke, so
       a longer wrong value such as 12 against an answer of 11 does nothing. */
    function autoSubmit() {
      if (stopped || done || resolved || !cur) return;
      if (checkAnswer(input.value, cur.expected)) submit();
    }

    function submit() {
      if (stopped || done || resolved) return;
      resolved = true;
      clock.clear(timerId);
      var ok = checkAnswer(input.value, cur.expected);
      times.push(Date.now() - shownAt - clock.hiddenMs());
      if (ok) {
        correct++;
        playSfx("correct");
      } else {
        playSfx("incorrect");
      }
      i++;
      meta.textContent = metaText();
      input.value = "";
      clock.set(next, 240);
    }

    function timeout() {
      if (stopped || done || resolved) return;
      resolved = true;
      clock.clear(timerId);
      times.push(problemMs);
      playSfx("incorrect");
      i++;
      meta.textContent = metaText();
      clock.set(next, 240);
    }

    function next() {
      if (stopped) return;
      if (i >= total) return finish();
      if (!levelSet && i === MATH_PROBE) {
        levelSet = true;
        if (correct / MATH_PROBE >= 0.75) level = 1;
      }
      cur = makeProblem(level, rng, { ops: ops, digits: digits });
      resolved = false;
      shownAt = Date.now();
      prompt.textContent = cur.text + " =";
      input.value = "";
      try { input.focus(); } catch (e) {}
      if (problemMs > 0) timerId = clock.set(timeout, problemMs);
    }

    function finish() {
      if (done) return;
      done = true;
      stopped = true;
      teardown(false);
      var med = median(times);
      /* A partial endless run scores against the problems it actually attempted. */
      var denom = endless ? i : total;
      container.appendChild(summaryEl(
        "Set complete",
        correct + " of " + denom + " correct" +
        (med == null ? "" : " · median " + Math.round(med) + " ms per problem")
      ));
      if (opts.onComplete) {
        var rec = {
          drillId: "math",
          value: correct,
          unit: "correct",
          t: Date.now(),
          meta: {
            trials: denom,
            correct: correct,
            accuracy: denom > 0 ? correct / denom : 0,
            medianMs: med == null ? null : Math.round(med),
            level: level,
            ops: ops.slice(),
            digits: digits,
            timePerProblem: timePerProblem
          }
        };
        if (bankPartial) reportEndlessPartial(opts, rec); else opts.onComplete(rec);
      }
    }

    function onKey(e) {
      if (e.key === "Enter") { e.preventDefault(); submit(); return; }
      if (e.key === "Backspace") return;
      /* preventDefault stops the browser inserting the character a second time
         after tap() has already put it in, which is what made a typed digit land
         twice. Paste and any other change still reach autoSubmit through the
         input event. */
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); tap(e.key); }
      else if (e.key === "-" || e.key === "+") { e.preventDefault(); tap("-"); }
      else if (e.key === "Delete") { e.preventDefault(); tap("C"); }
    }
    input.addEventListener("keydown", onKey);
    input.addEventListener("input", autoSubmit);

    /* The input's own handlers die with the element, so teardown removes them too
       and the drill leaves nothing bound anywhere. */
    var unbindKey = function () { input.removeEventListener("keydown", onKey); input.removeEventListener("input", autoSubmit); };
    var teardown = makeTeardown(clock, unbindVis, unbindKey);

    timerId = clock.set(next, 800);
    return {
      stop: function () {
        if (endless && i > 0 && !done && !focusStageUp()) { bankPartial = true; finish(); silenceAudio(); }
        else { if (stopped) return; stopped = true; teardown(true); }
        if (input.parentNode) input.parentNode.removeChild(input);
      }
    };
  }

  /* ---------- registration ---------- */

  function attach() {
    var D = globalThis.Drills;
    if (!D || typeof D.register !== "function") return false;
    D.register("sart", sart);
    D.register("crt", crt);
    D.register("math", math);
    return true;
  }

  if (!attach() && typeof globalThis !== "undefined" && typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("load", attach, { once: true });
  }

  var api = { DrillsExtraCore: DrillsExtraCore };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof globalThis !== "undefined") globalThis.DrillsExtraCore = DrillsExtraCore;
})();