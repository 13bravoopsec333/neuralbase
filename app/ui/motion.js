/* Neuralbase motion: one reduce flag, count-ups, reveals, drill flashes.
   Motion marks state change only. Everything here is transform or opacity,
   except count-up numbers which are text by definition. */
(function () {
  "use strict";

  var KEY = "cortex.motion.reduce";      /* standalone preference */
  var APP_KEY = "cortex.app";            /* app state, holds settings.reduced */
  var MIN_FADE = 70;

  function systemReduced() {
    try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
    catch (e) { return false; }
  }
  function readKey(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function ownReduced() {
    var v = readKey(KEY);
    return v === "1" ? true : v === "0" ? false : null;
  }
  function appReduced() {
    var raw = readKey(APP_KEY);
    if (!raw) return null;
    try {
      var s = JSON.parse(raw);
      if (s && s.settings && typeof s.settings.reduced === "boolean") return s.settings.reduced;
    } catch (e) { /* degrade */ }
    return null;
  }

  /* Explicit setting wins over the system preference. */
  function reduced() {
    var o = ownReduced();
    if (o !== null) return o;
    var a = appReduced();
    if (a !== null) return a;
    return systemReduced();
  }

  function setReduced(b) {
    b = !!b;
    try { localStorage.setItem(KEY, b ? "1" : "0"); } catch (e) { /* degrade */ }
    if (typeof document !== "undefined") document.body.classList.toggle("reduce", b);
    return b;
  }

  /* Keep body.reduce in step with the flag on load and when the OS flips. */
  function sync() {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("reduce", reduced());
  }
  try {
    var mq = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq && mq.addEventListener) mq.addEventListener("change", sync);
    else if (mq && mq.addListener) mq.addListener(sync);
  } catch (e) { /* degrade */ }

  function parseNum(s) {
    var n = parseFloat(String(s == null ? "" : s).replace(/[^0-9.\-]/g, ""));
    return isFinite(n) ? n : 0;
  }
  function raf() {
    return (typeof window !== "undefined" && window.requestAnimationFrame)
      ? window.requestAnimationFrame.bind(window)
      : function (cb) { return setTimeout(function () { cb(Date.now()); }, 16); };
  }

  /* countUp: roll a number from its current text (or opts.from) to `to`.
     Snaps straight to the final value when reduced or duration is zero. */
  function countUp(el, to, opts) {
    if (!el) return;
    opts = opts || {};
    var dur = opts.duration == null ? 400 : opts.duration;
    var dec = opts.decimals == null ? 0 : opts.decimals;
    var pre = opts.prefix || "";
    var suf = opts.suffix || "";
    var toN = Number(to);
    if (!isFinite(toN)) toN = 0;
    var fromN = opts.from == null ? parseNum(el.textContent) : Number(opts.from) || 0;

    function fmt(v) { return pre + v.toFixed(dec) + suf; }

    if (reduced() || dur <= 0) { el.textContent = fmt(toN); return; }
    var start = null;
    var step = raf();
    function frame(t) {
      if (start == null) start = t;
      var p = Math.min(1, (t - start) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(fromN + (toN - fromN) * e);
      if (p < 1) step(frame); else el.textContent = fmt(toN);
    }
    step(frame);
  }

  /* reveal: a short fade plus a small vertical settle. Transform and opacity only. */
  function reveal(el, opts) {
    if (!el) return;
    opts = opts || {};
    var y = opts.y == null ? 6 : opts.y;
    var dur = opts.duration == null ? 180 : opts.duration;
    if (reduced() || dur <= 0) { el.style.opacity = ""; el.style.transform = ""; return; }
    if (el.animate) {
      el.animate(
        [{ opacity: 0, transform: "translateY(" + y + "px)" }, { opacity: 1, transform: "none" }],
        { duration: dur, easing: "cubic-bezier(.3,.9,.3,1)", fill: "backwards" }
      );
      return;
    }
    el.style.transition = "opacity " + dur + "ms, transform " + dur + "ms";
    el.style.opacity = "0";
    el.style.transform = "translateY(" + y + "px)";
    raf()(function () { el.style.opacity = "1"; el.style.transform = "none"; });
  }

  /* flash: drill feedback. correct is a 90ms pulse, incorrect a 120ms 3px shake.
     The color cue stays under reduced motion; only the movement is dropped. */
  function flash(el, kind) {
    if (!el) return;
    var bad = kind === "incorrect" || kind === "warn" || kind === "false";
    var cls = bad ? "flash-incorrect" : "flash-correct";
    el.classList.remove("flash-correct", "flash-incorrect");
    void el.offsetWidth; /* restart the class */
    el.classList.add(cls);

    if (!reduced() && el.animate) {
      var dur = bad ? 120 : 90;
      var frames = bad
        ? [{ transform: "translateX(0)" }, { transform: "translateX(-3px)" },
           { transform: "translateX(3px)" }, { transform: "translateX(0)" }]
        : [{ transform: "scale(1)" }, { transform: "scale(1.03)" }, { transform: "scale(1)" }];
      el.animate(frames, { duration: dur, easing: "ease-out" });
    }

    if (el.__flashT) clearTimeout(el.__flashT);
    el.__flashT = setTimeout(function () { el.classList.remove(cls); }, bad ? 260 : 220);
  }

  var api = {
    reduced: reduced,
    setReduced: setReduced,
    sync: sync,
    countUp: countUp,
    reveal: reveal,
    flash: flash,
    KEY: KEY,
    MIN_FADE: MIN_FADE
  };
  if (typeof globalThis !== "undefined") globalThis.Motion = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document !== "undefined") sync();
})();
