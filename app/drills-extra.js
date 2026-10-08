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

  function rngFor(opts) {
    var o = opts || {};
    if (typeof o.rng === "function") return o.rng;
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

  /* SART scoring. A trial is correct when the user held back on a non-target
     digit. targetDigit must be withheld, every other digit must be passed. */
  var SART_TARGET = 3;

  function scoreSart(trials, targetDigit) {
    var target = targetDigit == null ? SART_TARGET : targetDigit;
    var t = trials || [];
    var omissions = 0, commissions = 0, withheld = 0, rts = [];
    for (var i = 0; i < t.length; i++) {
      var tr = t[i] || {};
      var isTarget = Number(tr.digit) === target;
      if (isTarget) {
        if (tr.pressed) {
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
    var med = median(rts);
    return {
      trials: t.length,
      omissions: omissions,
      commissions: commissions,
      correct: withheld,
      accuracy: t.length ? withheld / t.length : 0,
      rtMedian: med == null ? null : Math.round(med)
    };
  }

  function pickChoice(medianRt) {
    return (typeof medianRt === "number" && isFinite(medianRt) && medianRt > 0 && medianRt < 350) ? 3 : 2;
  }

  function problem(level, op, a, b, expected) {
    return { level: level, op: op, a: a, b: b, expected: expected, text: a + " " + op + " " + b };
  }

  /* level 0: addition and subtraction inside 30.
     level 1: adds times tables and exact division by 2 to 9.
     level 2: addition and subtraction inside 100, and times tables and exact
     division using factors 2 to 12. Every operation tier 1 has stays available,
     with larger operands. */
  function makeProblem(level, rng) {
    var lvl = Math.floor(Number(level) || 0);
    if (lvl < 0) lvl = 0;
    if (lvl > 2) lvl = 2;
    var kinds = lvl === 0 ? ["+", "-"] : ["+", "-", "*", "/"];
    var op = pick(rng, kinds);
    if (op === "+") {
      var hi = lvl >= 2 ? 99 : 29;
      var a = 1 + randInt(rng, hi), b = 1 + randInt(rng, hi + 1 - a);
      return problem(lvl, "+", a, b, a + b);
    }
    if (op === "-") {
      var cap = lvl >= 2 ? 100 : 30;
      var c = 1 + randInt(rng, cap), d = 1 + randInt(rng, cap);
      return problem(lvl, "-", c, d, c - d);
    }
    var hiF = lvl >= 2 ? 12 : 9;
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
    pickChoice: pickChoice,
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
      ".nx-go{min-height:48px;flex:1;min-width:96px}",
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

  function bindVisibility(doc, clock) {
    if (!doc || typeof doc.addEventListener !== "function") return function () {};
    function handler() {
      if (doc.hidden) clock.hide(); else clock.show();
    }
    doc.addEventListener("visibilitychange", handler);
    return function () { doc.removeEventListener("visibilitychange", handler); };
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

  function sartDigit(rng, target) {
    var t = target == null ? SART_TARGET : target;
    return randInt(rng, 10) === t ? t : pick(rng, SART_FILLERS);
  }

  function sart(container, opts) {
    injectStyles();
    var rng = rngFor(opts);
    var clock = makeClock();
    var stopped = false, done = false;
    var i = 0, trials = [], timerId = 0;
    /* Validated by drillOptions: 20, 30 or 40. Default keeps the 30-trial set. */
    var total = (opts.options && typeof opts.options.trials === "number") ? opts.options.trials : SART_TRIALS;
    /* Validated by drillOptions: 1 to 9. The digit the player must withhold on.
       Default 3 is the classic SART target. */
    var targetDigit = (opts.options && typeof opts.options.targetDigit === "number") ? opts.options.targetDigit : SART_TARGET;
    var curDigit = 0, shownAt = 0, resolved = true;

    var wrap = el("div", "drill drill-sart");
    var stage = el("div", "nx-digit mono", "-");
    var live = el("div", "nx-sr");
    live.setAttribute("aria-live", "polite");
    live.setAttribute("aria-atomic", "true");
    var cue = el("div", "nx-cue", "Press only on the digit " + targetDigit + ".");
    cue.setAttribute("aria-live", "polite");
    var bar = el("div", "drill-bar");
    var pressBtn = button("btn-primary nx-press", "Press on 3");
    bar.appendChild(pressBtn);
    var meta = el("div", "nb-meta mono", "0 / " + total);
    var note = el("div", "drill-note", "A steady stream of digits, one at a time. Press on 3 and hold back on everything else. Trains sustained attention.");
    wrap.appendChild(stage);
    wrap.appendChild(live);
    wrap.appendChild(cue);
    wrap.appendChild(note);
    wrap.appendChild(bar);
    wrap.appendChild(meta);
    container.appendChild(wrap);

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
        cue.textContent = "pressed, and that was not a 3";
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
        cue.textContent = "the 3 went by";
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
      curDigit = sartDigit(rng, targetDigit);
      resolved = false;
      shownAt = Date.now();
      stage.className = "nx-digit mono";
      stage.textContent = String(curDigit);
      live.textContent = "Digit " + curDigit;
      meta.textContent = i + " / " + total;
      timerId = clock.set(withhold, SART_BEAT);
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
        sc.correct + " of " + sc.trials + " correctly withheld · " +
        sc.omissions + " lapses · " + sc.commissions + " early presses" +
        (sc.rtMedian == null ? "" : " · median press " + sc.rtMedian + " ms")
      ));
      if (opts.onComplete) {
        opts.onComplete({
          drillId: "sart",
          value: sc.correct,
          unit: "correct",
          t: Date.now(),
          meta: {
            trials: sc.trials,
            omissions: sc.omissions,
            commissions: sc.commissions,
            accuracy: sc.accuracy,
            rtMedian: sc.rtMedian
          }
        });
      }
    }

    pressBtn.addEventListener("click", function () { respond(); });
    timerId = clock.set(next, 900);
    return {
      stop: function () {
        if (stopped) return;
        stopped = true;
        teardown(true);
      }
    };
  }

  /* ---------- 2. CRT, choice reaction time ---------- */

  var CRT_TRIALS = 20;
  var CRT_WINDOW = 1200;
  var CRT_LANES = ["Left", "Center", "Right"];
  var CRT_KEYS = ["1", "2", "3"];

  function laneSet(n) { return n >= 3 ? [0, 1, 2] : [0, 2]; }

  function crt(container, opts) {
    injectStyles();
    var rng = rngFor(opts);
    var clock = makeClock();
    var stopped = false, done = false;
    var i = 0, choice = 2, hits = 0, misses = 0, rts = [];
    /* Validated by drillOptions: 10, 20 or 30. Default keeps the 20-trial set. */
    var total = (opts.options && typeof opts.options.trials === "number") ? opts.options.trials : CRT_TRIALS;
    /* Validated by drillOptions: 2 or 3. The number of lights the set starts on.
       The adaptive rule still widens or narrows it after a hit, so this is a
       starting point, not a fixed count. Default 2 keeps the old start. */
    var choices = (opts.options && typeof opts.options.choices === "number") ? opts.options.choices : 2;
    choice = choices;
    var shownAt = 0, litIdx = -1, targetLane = 0, resolved = true, timerId = 0;
    var lanes = [], laneEls = [];

    var wrap = el("div", "drill drill-crt");
    var stage = el("div", "nx-lanes");
    var cue = el("div", "nx-cue", "Wait for a light, then press it.");
    cue.setAttribute("aria-live", "polite");
    var note = el("div", "drill-note", "Two lights, then three once you are quick. Trains simple reaction speed.");
    var meta = el("div", "nb-meta mono", "0 / " + total + " · " + choice + " lights");
    wrap.appendChild(stage);
    wrap.appendChild(cue);
    wrap.appendChild(note);
    wrap.appendChild(meta);
    container.appendChild(wrap);

    var unbindVis = bindVisibility(doc, clock);
    var unbindKey = bindKey(doc, function (e) {
      var idx = CRT_KEYS.indexOf(e.key);
      if (idx >= 0) press(idx);
    });
    var teardown = makeTeardown(clock, unbindVis, unbindKey);

    function layout() {
      var set = laneSet(choice);
      if (set.length === lanes.length) return;
      lanes = set;
      while (stage.firstChild) stage.removeChild(stage.firstChild);
      laneEls = [];
      lanes.forEach(function (idx, pos) {
        var b = button("nx-lane", CRT_LANES[idx]);
        b.setAttribute("aria-label", CRT_LANES[idx] + ", key " + (pos + 1));
        var k = el("span", "k", "key " + (pos + 1));
        b.appendChild(k);
        b.addEventListener("click", function () { press(pos); });
        stage.appendChild(b);
        laneEls.push(b);
      });
      stage.style.gridTemplateColumns = "repeat(" + lanes.length + ",1fr)";
      note.textContent = choice === 3
        ? "Three lights. Trains simple reaction speed."
        : "Two lights now. Move to three once your median reaction time drops under 350 ms.";
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

    function press(pos) {
      if (stopped || done || resolved || litIdx < 0) return;
      if (pos < 0 || pos >= lanes.length) return;
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
        choice = pickChoice(median(rts));
        layout();
      } else {
        misses++;
        litIdx = -1;
        paintLit();
        laneEls[pos].className = "nx-lane miss";
        cue.textContent = "wrong button";
        playSfx("incorrect");
      }
      meta.textContent = i + " / " + total + " · " + choice + " lights";
      clock.set(next, 260);
    }

    function timeout() {
      if (stopped || done || resolved) return;
      resolved = true;
      misses++;
      litIdx = -1;
      paintLit();
      cue.textContent = "too slow";
      playSfx("incorrect");
      meta.textContent = i + " / " + total + " · " + choice + " lights";
      clock.set(next, 260);
    }

    function next() {
      if (stopped) return;
      if (i >= total) return finish();
      i++;
      layout();
      resolved = false;
      reset();
      shownAt = Date.now();
      targetLane = randInt(rng, lanes.length);
      litIdx = targetLane;
      paintLit();
      cue.textContent = "go";
      meta.textContent = i + " / " + total + " · " + choice + " lights";
      timerId = clock.set(timeout, CRT_WINDOW);
    }

    function finish() {
      if (done) return;
      done = true;
      stopped = true;
      teardown(false);
      var med = median(rts);
      var fast = rts.length ? Math.min.apply(null, rts) : null;
      var value = med == null ? CRT_WINDOW : Math.round(med);
      container.appendChild(summaryEl(
        "Set complete",
        value + " ms median · " + hits + " hits · " + misses + " missed" +
        (fast == null ? "" : " · fastest " + Math.round(fast) + " ms")
      ));
      if (opts.onComplete) {
        opts.onComplete({
          drillId: "crt",
          value: value,
          unit: "ms",
          t: Date.now(),
          meta: {
            trials: total,
            hits: hits,
            misses: misses,
            medianRt: med == null ? null : Math.round(med),
            fastestRt: fast == null ? null : Math.round(fast),
            choice: choice
          }
        });
      }
    }

    layout();
    timerId = clock.set(next, 900);
    return {
      stop: function () {
        if (stopped) return;
        stopped = true;
        teardown(true);
      }
    };
  }

  /* ---------- 3. Mental math sprint ---------- */

  var MATH_TRIALS = 20;
  var MATH_MS = 4000;
  var MATH_PROBE = 8;
  var MATH_KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "-", "0", "C"];

  function math(container, opts) {
    injectStyles();
    var rng = rngFor(opts);
    var clock = makeClock();
    var stopped = false, done = false;
    var i = 0, level = 0, correct = 0, levelSet = false;
    /* The panel's starting level maps onto the generator's three tiers: 1 is the
       current default (add and subtract), 2 starts on times tables and division,
       3 starts on the wide-range tier. A start above tier one marks the level as
       already set, so the eight-trial promotion probe cannot pull it back down. */
    var startLevel = (opts.options && typeof opts.options.startLevel === "number") ? opts.options.startLevel : 1;
    level = startLevel - 1;
    levelSet = startLevel > 1;
    /* Validated by drillOptions: 3 to 8 seconds. The per-problem clock. Default 4
       keeps the four second window the drill has always used. */
    var secondsPerProblem = (opts.options && typeof opts.options.secondsPerProblem === "number") ? opts.options.secondsPerProblem : 4;
    var problemMs = secondsPerProblem * 1000;
    var cur = null, shownAt = 0, resolved = true, timerId = 0;
    var times = [];

    /* Trial count, running score and the per-problem clock, on screen. */
    function metaText() {
      return i + " / " + MATH_TRIALS + " · " + correct + " correct · " + secondsPerProblem + " s";
    }

    var wrap = el("div", "drill drill-math");
    var prompt = el("div", "nx-problem mono", "");
    var cue = el("div", "nx-cue", "Type the answer, then press enter.");
    cue.setAttribute("aria-live", "polite");
    var row = el("div", "nx-row");
    var input = document.createElement("input");
    input.type = "text";
    input.className = "nx-in mono";
    input.setAttribute("aria-label", "Your answer");
    input.setAttribute("inputmode", "numeric");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("spellcheck", "false");
    var go = button("btn-primary nx-go", "Enter");
    row.appendChild(input);
    row.appendChild(go);
    var pad = el("div", "nx-pad");
    var padKeys = [];
    MATH_KEYS.forEach(function (k) {
      var b = button("nx-key", k);
      b.setAttribute("aria-label", k === "C" ? "Clear" : k === "-" ? "Minus sign" : "Digit " + k);
      b.addEventListener("click", function () { tap(k); });
      pad.appendChild(b);
      padKeys.push(b);
    });
    var note = el("div", "drill-note", "Small sums first, then times tables. Trains mental arithmetic fluency.");
    var meta = el("div", "nb-meta mono", metaText());
    wrap.appendChild(prompt);
    wrap.appendChild(cue);
    wrap.appendChild(row);
    wrap.appendChild(pad);
    wrap.appendChild(note);
    wrap.appendChild(meta);
    container.appendChild(wrap);

    var unbindVis = bindVisibility(doc, clock);

    function tap(k) {
      if (stopped || done || resolved) return;
      if (k === "C") { input.value = ""; return; }
      if (k === "-") {
        input.value = input.value.charAt(0) === "-" ? input.value.slice(1) : "-" + input.value;
        return;
      }
      if (input.value.length < 6) input.value += k;
    }

    function submit() {
      if (stopped || done || resolved) return;
      resolved = true;
      clock.clear(timerId);
      var ok = checkAnswer(input.value, cur.expected);
      times.push(Date.now() - shownAt - clock.hiddenMs());
      if (ok) {
        correct++;
        cue.textContent = "right";
        playSfx("correct");
      } else {
        cue.textContent = input.value.trim() ? "wrong, it was " + cur.expected : "wrong";
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
      cue.textContent = "time, it was " + cur.expected;
      playSfx("incorrect");
      i++;
      meta.textContent = metaText();
      clock.set(next, 240);
    }

    function next() {
      if (stopped) return;
      if (i >= MATH_TRIALS) return finish();
      if (!levelSet && i === MATH_PROBE) {
        levelSet = true;
        if (correct / MATH_PROBE >= 0.75) {
          level = 1;
          note.textContent = "Times tables and division now. Trains mental arithmetic fluency.";
        }
      }
      cur = makeProblem(level, rng);
      resolved = false;
      shownAt = Date.now();
      prompt.textContent = cur.text + " =";
      cue.textContent = "Type the answer, then press enter.";
      input.value = "";
      try { input.focus(); } catch (e) {}
      timerId = clock.set(timeout, problemMs);
    }

    function finish() {
      if (done) return;
      done = true;
      stopped = true;
      teardown(false);
      var med = median(times);
      container.appendChild(summaryEl(
        "Set complete",
        correct + " of " + MATH_TRIALS + " correct" +
        (med == null ? "" : " · median " + Math.round(med) + " ms per problem")
      ));
      if (opts.onComplete) {
        opts.onComplete({
          drillId: "math",
          value: correct,
          unit: "correct",
          t: Date.now(),
          meta: {
            trials: MATH_TRIALS,
            correct: correct,
            accuracy: correct / MATH_TRIALS,
            medianMs: med == null ? null : Math.round(med),
            level: level
          }
        });
      }
    }

    function onKey(e) {
      if (e.key === "Enter") { e.preventDefault(); submit(); return; }
      if (e.key === "Backspace") return;
      if (/^[0-9]$/.test(e.key)) tap(e.key);
      else if (e.key === "-" || e.key === "+") tap("-");
      else if (e.key === "Delete") tap("C");
    }
    input.addEventListener("keydown", onKey);
    go.addEventListener("click", function () { submit(); });

    /* The input's own handler dies with the element, so teardown removes it too
       and the drill leaves nothing bound anywhere. */
    var unbindKey = function () { input.removeEventListener("keydown", onKey); };
    var teardown = makeTeardown(clock, unbindVis, unbindKey);

    timerId = clock.set(next, 800);
    return {
      stop: function () {
        if (stopped) return;
        stopped = true;
        teardown(true);
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