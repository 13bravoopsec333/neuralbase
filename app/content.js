/* Neuralbase content: canonical copy and the studied drill registry. */
(function () {
  "use strict";

  var COPY = {
    brand: "Neuralbase",
    today: "Today",
    startSession: "Start session",
    trainTitle: "Drills",
    footer: "Neuralbase, a little training every day.",
    copyright: "© 2026 Neuralbase"
  };

  /* Drill icons: one coherent line set. Every mark is a 64x64 viewBox drawn in
     currentColor with the same stroke width, round caps and round joins, so the
     nine read as a family at 20px in the rail and at 44px on the stage. Fills are
     used only as a single small accent (the marked n-back cell, the eye's pupil).
     Sizes are set by .drill-ic in styles.css. */
  var ICON_NBACK = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="14" height="14" rx="3.5"/><rect x="25" y="8" width="14" height="14" rx="3.5"/><rect x="42" y="8" width="14" height="14" rx="3.5"/><rect x="8" y="25" width="14" height="14" rx="3.5"/><rect x="25" y="25" width="14" height="14" rx="3.5" fill="currentColor" stroke="none"/><rect x="42" y="25" width="14" height="14" rx="3.5"/><rect x="8" y="42" width="14" height="14" rx="3.5"/><rect x="25" y="42" width="14" height="14" rx="3.5"/><rect x="42" y="42" width="14" height="14" rx="3.5"/></svg>';
  var ICON_UFOV = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 38 A12 12 0 0 1 26 50"/><path d="M14 26 A24 24 0 0 1 38 50"/><path d="M14 14 A36 36 0 0 1 50 50"/><circle cx="14" cy="50" r="3.5"/></svg>';
  var ICON_PALACE = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 51 L 33 41 L 51 13"/><circle cx="13" cy="51" r="5"/><circle cx="33" cy="41" r="5"/><circle cx="51" cy="13" r="5"/></svg>';
  var ICON_REASONING = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M32 13 L 51 47 L 13 47 Z"/><circle cx="32" cy="13" r="4"/><circle cx="51" cy="47" r="4"/><circle cx="13" cy="47" r="4"/></svg>';
  var ICON_SPACED = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="32" cy="32" r="21"/><path d="M32 19 V 33 L 43 39"/></svg>';
  var ICON_SWITCHING = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 23 H 46"/><path d="M38 15 L 46 23 L 38 31"/><path d="M52 41 H 18"/><path d="M26 33 L 18 41 L 26 49"/></svg>';

  var ICON_SART = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 32 C 16 17 48 17 58 32 C 48 47 16 47 6 32 Z"/><circle cx="32" cy="32" r="8"/><circle cx="32" cy="32" r="2.6" fill="currentColor" stroke="none"/></svg>';
  var ICON_CRT = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M37 7 L 18 35 H 30 L 27 57 L 46 29 H 34 Z"/></svg>';
  var ICON_MATH = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M32 10 V 30"/><path d="M22 20 H 42"/><path d="M20 46 H 44"/></svg>';

  /* N-back variants, in registry order. `dual` is the default and keeps the original
     rule-cued behaviour. Mode ids are mirrored in app/engine.js, which cannot import
     this file, so the two lists have to be kept in sync by hand. */
  var MODES = [
    { id: "dual", name: "Dual n-back", blurb: "A cue names which rule is live, and the rule changes mid-set." },
    { id: "visual", name: "Visual", blurb: "A target is a repeated position. A repeated letter is a trap." },
    { id: "letter", name: "Letter", blurb: "A target is a repeated letter. A repeated position is a trap." },
    { id: "vowel", name: "Vowel", blurb: "Count a match only when the repeated letter is a vowel." },
    { id: "arithmetic", name: "Arithmetic", blurb: "Two digits appear and their sum is the stimulus. Flag a repeated sum." },
    { id: "spatial", name: "Spatial", blurb: "A shape appears in one cell. Flag a repeated place, whatever the shape." }
  ];

  var DRILLS = [
    { id: "nback", name: "N-Back", icon: ICON_NBACK, desc: "Track a stream and flag the match n steps back.", trains: "Working memory updating.", works: "Each turn a cue names the rule and a stimulus appears. Flag it when it matches n steps back. Six modes change what counts as a match.", evidence: "One study of executive n-back training reported transfer to Operation Span and task switching, with effects still present at three months.", direction: "higher", unit: "n", modes: ["dual", "visual", "letter", "vowel", "arithmetic", "spatial"] },
    { id: "ufov", name: "Speed of Processing", icon: ICON_UFOV, desc: "Catch a target in the center and one at the edge.", trains: "Processing speed.", works: "Identify the center shape and locate the edge target as exposure shrinks.", evidence: "None of our sources report an outcome for this task.", direction: "lower", unit: "ms" },
    { id: "palace", name: "Memory Palace", icon: ICON_PALACE, desc: "Place items along a route, then recall them in order.", trains: "Memory strategy.", works: "Items drop into loci along a path. Recall the route in order.", evidence: "Six weeks of method-of-loci training changed recall in novices. Another study found the memories lasted longer than rote repetition.", direction: "higher", unit: "items" },
    { id: "reasoning", name: "Relational Reasoning", icon: ICON_REASONING, desc: "Find the relation that two cases share.", trains: "Reasoning.", works: "Two cases share a hidden relation. Pick the option that carries it.", evidence: "We have no source with an outcome for this reasoning task.", direction: "higher", unit: "correct" },
    { id: "spaced", name: "Spaced Retrieval", icon: ICON_SPACED, desc: "Review your own cards at growing intervals.", trains: "Recall.", works: "Add cards, then review each one when it comes due.", evidence: "One study found retrieval practice built stronger memories than restudy.", direction: "higher", unit: "cards" },
    { id: "switching", name: "Task Switching", icon: ICON_SWITCHING, desc: "Shift between two rules without slipping.", trains: "Mental flexibility.", works: "Alternate between judging color and shape as trials switch.", evidence: "No source reports an outcome for this color-and-shape task.", direction: "higher", unit: "correct" },
    { id: "sart", name: "Signal Alert", icon: ICON_SART, desc: "Hold a steady watch for a rare target.", trains: "Sustained attention.", works: "A signal pops up now and then. Catch it without letting your attention drift.", evidence: "Our sources do not report an outcome for this rare-target task.", direction: "higher", unit: "correct" },
    { id: "crt", name: "Simple Reaction", icon: ICON_CRT, desc: "Answer the instant a cue appears.", trains: "Simple reaction speed.", works: "A cue lights up and you tap as fast as you can. Fast taps that guess wrong do not count.", evidence: "No source reports a training outcome for this simple reaction task.", direction: "lower", unit: "ms" },
    { id: "math", name: "Mental Arithmetic", icon: ICON_MATH, desc: "Work out short sums under time.", trains: "Mental arithmetic fluency.", works: "Two numbers appear, you type the answer, and the clock keeps moving.", evidence: "A review reports near transfer to calculation and short-term memory spans from abacus and calculation training. Approximate-arithmetic training failed to replicate a transfer to symbolic math in adults, and did not improve symbolic math in third and fourth graders.", direction: "higher", unit: "correct" }
  ];

  var RAIL = ["train"];

  var api = { COPY: COPY, DRILLS: DRILLS, MODES: MODES, RAIL: RAIL };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof globalThis !== "undefined") globalThis.Content = api;
})();
