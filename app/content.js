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

  /* Drill icons: marks from the Neuralbase mark study, each drawn in currentColor
     so every theme picks it up. Sizes are set by .drill-ic in styles.css. */
  var ICON_NBACK = '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="5" aria-hidden="true"><rect x="15" y="15" width="26" height="26" rx="4"/><rect x="47" y="15" width="26" height="26" rx="4"/><rect x="79" y="15" width="26" height="26" rx="4"/><rect x="15" y="47" width="26" height="26" rx="4"/><rect x="79" y="47" width="26" height="26" rx="4"/><rect x="15" y="79" width="26" height="26" rx="4"/><rect x="47" y="79" width="26" height="26" rx="4"/><rect x="79" y="79" width="26" height="26" rx="4"/><rect x="47" y="47" width="26" height="26" rx="4" fill="currentColor"/></svg>';
  var ICON_UFOV = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" aria-hidden="true"><path d="M26 50A12 12 0 0 1 14 38"/><path d="M36 50A22 22 0 0 1 14 28"/><path d="M46 50A32 32 0 0 1 14 18"/><circle cx="14" cy="50" r="4" fill="currentColor" stroke="none"/></svg>';
  var ICON_PALACE = '<svg viewBox="0 0 120 120" fill="currentColor" aria-hidden="true"><circle cx="100" cy="60" r="6"/><circle cx="94.6" cy="80" r="6"/><circle cx="80" cy="94.6" r="6"/><circle cx="60" cy="100" r="6"/><circle cx="40" cy="94.6" r="6"/><circle cx="25.4" cy="80" r="6"/><circle cx="20" cy="60" r="6"/><circle cx="25.4" cy="40" r="6"/><circle cx="40" cy="25.4" r="6"/><circle cx="60" cy="20" r="6"/><circle cx="80" cy="25.4" r="6"/><circle cx="94.6" cy="40" r="6"/></svg>';
  var ICON_REASONING = '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linejoin="round" aria-hidden="true"><path d="M60 34 L48 54 M60 34 L72 54 M48 54 L36 74 M48 54 L60 74 M72 54 L60 74 M72 54 L84 74 M36 74 L24 94 M36 74 L48 94 M60 74 L48 94 M60 74 L72 94 M84 74 L72 94 M84 74 L96 94 M48 54 L72 54 M36 74 L84 74 M24 94 L96 94"/><circle cx="60" cy="34" r="5" fill="currentColor" stroke="none"/><circle cx="48" cy="54" r="5" fill="currentColor" stroke="none"/><circle cx="72" cy="54" r="5" fill="currentColor" stroke="none"/><circle cx="36" cy="74" r="5" fill="currentColor" stroke="none"/><circle cx="60" cy="74" r="5" fill="currentColor" stroke="none"/><circle cx="84" cy="74" r="5" fill="currentColor" stroke="none"/><circle cx="24" cy="94" r="5" fill="currentColor" stroke="none"/><circle cx="48" cy="94" r="5" fill="currentColor" stroke="none"/><circle cx="72" cy="94" r="5" fill="currentColor" stroke="none"/><circle cx="96" cy="94" r="5" fill="currentColor" stroke="none"/></svg>';
  var ICON_SPACED = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" aria-hidden="true"><path d="M44.6 14A22 22 0 1 1 19.4 14"/><circle cx="32" cy="10" r="4.5" fill="currentColor" stroke="none"/></svg>';
  var ICON_SWITCHING = '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><polyline points="24,40 68,40 68,84 96,84"/><rect x="16" y="32" width="16" height="16" rx="3" fill="currentColor" stroke="none"/><rect x="88" y="76" width="16" height="16" rx="3" fill="currentColor" stroke="none"/><circle cx="68" cy="62" r="6" fill="currentColor" stroke="none"/></svg>';

  var ICON_SART = '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round" aria-hidden="true"><path d="M14 60C26 37 42 27 60 27s34 10 46 33c-12 23-28 33-46 33S26 83 14 60Z"/><circle cx="60" cy="60" r="10" fill="currentColor" stroke="none"/></svg>';
  var ICON_CRT = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 24v16M22 18v28M36 32h14"/><path d="M40 20l12 12-12 12"/></svg>';
  var ICON_MATH = '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" aria-hidden="true"><path d="M60 24v36M42 42h36"/><path d="M32 88h56"/></svg>';

  /* N-back modes, in registry order. `dual` is the default and keeps the original
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
    { id: "nback", name: "Executive N-Back", icon: ICON_NBACK, desc: "Track a stream and flag the match n steps back.", trains: "Working memory updating.", works: "Each turn a cue names the rule and a stimulus appears. Flag it when it matches n steps back. Six modes change what counts as a match.", evidence: "One study of executive n-back training reported transfer to Operation Span and task switching, with effects still present at three months.", direction: "higher", unit: "n", modes: ["dual", "visual", "letter", "vowel", "arithmetic", "spatial"] },
    { id: "ufov", name: "Speed of Processing", icon: ICON_UFOV, desc: "Catch a target in the center and one at the edge.", trains: "Processing speed.", works: "Identify the center shape and locate the edge target as exposure shrinks.", evidence: "None of our sources report an outcome for this task.", direction: "lower", unit: "ms" },
    { id: "palace", name: "Memory Palace", icon: ICON_PALACE, desc: "Place items along a route, then recall them in order.", trains: "Memory strategy.", works: "Items drop into loci along a path. Recall the route in order.", evidence: "Six weeks of method-of-loci training changed recall in novices. Another study found the memories lasted longer than rote repetition.", direction: "higher", unit: "items" },
    { id: "reasoning", name: "Relational Reasoning", icon: ICON_REASONING, desc: "Find the relation that two cases share.", trains: "Reasoning.", works: "Two cases share a hidden relation. Pick the option that carries it.", evidence: "We have no source with an outcome for this reasoning task.", direction: "higher", unit: "correct" },
    { id: "spaced", name: "Spaced Retrieval", icon: ICON_SPACED, desc: "Review your own cards at growing intervals.", trains: "Recall.", works: "Add cards, then review each one when it comes due.", evidence: "One study found retrieval practice built stronger memories than restudy.", direction: "higher", unit: "cards" },
    { id: "switching", name: "Task Switching", icon: ICON_SWITCHING, desc: "Shift between two rules without slipping.", trains: "Mental flexibility.", works: "Alternate between judging color and shape as trials switch.", evidence: "No source reports an outcome for this color-and-shape task.", direction: "higher", unit: "correct" },
    { id: "sart", name: "Signal Alert", icon: ICON_SART, desc: "Hold a steady watch for a rare target.", trains: "Sustained attention.", works: "A signal pops up now and then. Catch it without letting your attention drift.", evidence: "Our sources do not report an outcome for this rare-target task.", direction: "higher", unit: "correct" },
    { id: "crt", name: "Simple Reaction", icon: ICON_CRT, desc: "Answer the instant a cue appears.", trains: "Simple reaction speed.", works: "A cue lights up and you tap as fast as you can. Fast taps that guess wrong do not count.", evidence: "No source reports a training outcome for this simple reaction task.", direction: "lower", unit: "ms" },
    { id: "math", name: "Mental Arithmetic", icon: ICON_MATH, desc: "Work out short sums under time.", trains: "Mental arithmetic fluency.", works: "Two numbers appear, you answer with a choice, and the clock keeps moving.", evidence: "A review reports near transfer to calculation and short-term memory spans from abacus and calculation training. Approximate-arithmetic training failed to replicate a transfer to symbolic math in adults, and did not improve symbolic math in third and fourth graders.", direction: "higher", unit: "correct" }
  ];

  var RAIL = ["train"];

  var api = { COPY: COPY, DRILLS: DRILLS, MODES: MODES, RAIL: RAIL };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof globalThis !== "undefined") globalThis.Content = api;
})();
