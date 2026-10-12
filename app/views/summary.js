/* Neuralbase view: Summary.

   The end-of-run readout, in the instrument-panel language of the X1 layouts:
   tabular mono figures, small-caps labels, hairline rules, one accent. The run
   hands its result over through app/lib/lastrun.js. peek, not take, so a reload
   of #summary still shows the run.

   Every figure is meant to be read without decoding: real units named in words,
   plain labels, and the words "not measured" wherever a value was never taken.
   Nothing is invented. A part with no time reads as not measured; a warm-up is
   marked warm-up, never wrong.

   One payload serves two kinds of run, and they are read in the words that are
   true for each: a drill scores trials (correct, incorrect, warm-up), while a
   circuit runs steps that either completed or produced no run at all. Same
   contract, the honest vocabulary for it.

   Tokens only, from styles.css, so every theme holds. No gradients on text, no
   shadows, no purple. All user and dynamic text goes through textContent. */

import * as lastrun from '../lib/lastrun.js';

/* Shown where a value was not measured. Words, never a made-up number, so it can
   never be read as a zero or a missing digit. */
const NOT_MEASURED = 'not measured';

/* The headline figure keeps a dash fallback: a run always carries a number, so
   this is only reached by a hand-built payload, and a word cannot fit the
   display size the score sits at. */
const DASH = '\u2013';

let ctxRef = null;

function h(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* ---------- formatting ---------- */

function fmtNum(v) {
  if (v == null || !isFinite(v)) return DASH;
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
  return String(Math.round(v * 100) / 100);
}
function fmtPercent(a) {
  if (a == null || !isFinite(a)) return DASH;
  return Math.round(a * 100) + '%';
}
function fmtDuration(ms) {
  if (ms == null || !isFinite(ms)) return DASH;
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}
function fmtMs(ms) {
  if (ms == null || !isFinite(ms)) return DASH;
  return Math.round(ms) + ' ms';
}
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

/* The unit the app records is a bare token: "correct", "n", "steps". A reader
   needs words, so each token maps to what the value counts, singular and plural.
   A token with no entry is shown as it is rather than hidden. */
const UNIT_WORDS = {
  n: ['level', 'levels'],
  ms: ['ms', 'ms'],
  items: ['item', 'items'],
  correct: ['correct answer', 'correct answers'],
  cards: ['card', 'cards'],
  steps: ['step', 'steps']
};

/* The unit in words for a value. n is the count the unit is counted over: 1 takes
   the singular, anything else (including no count) the plural. */
function unitWord(unit, n) {
  if (!unit) return '';
  const w = UNIT_WORDS[unit];
  if (!w) return String(unit);
  return n === 1 ? w[0] : w[1];
}

/* The words that are true for this kind of run. A drill's unscored part is a
   warm-up; a circuit's step that produced no run is simply a step with no run. */
function isCircuit(p) { return !!(p && p.kind === 'circuit'); }

/* A part's outcome, in plain words. ok true is correct, false is incorrect, and
   anything else was not scored. A circuit step reads as completed or as having no
   run, never as a trial that was right or wrong. */
function outcomeOf(ok, circuit) {
  if (circuit) {
    if (ok === true) return { text: 'Completed', cls: 'sm-out-hit' };
    if (ok === false) return { text: 'Incorrect', cls: 'sm-out-err' };
    return { text: 'No run', cls: 'sm-out-warm' };
  }
  if (ok === true) return { text: 'Correct', cls: 'sm-out-hit' };
  if (ok === false) return { text: 'Incorrect', cls: 'sm-out-err' };
  return { text: 'Warm-up', cls: 'sm-out-warm' };
}

/* A count, or the words for a value that was never taken. */
function fmtCount(v) {
  if (v == null || !isFinite(v)) return NOT_MEASURED;
  return String(v);
}

/* ---------- styles ---------- */

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById('nb-summary-styles')) return;
  const s = document.createElement('style');
  s.id = 'nb-summary-styles';
  s.textContent = [
    /* The page frame. flex-start overrides the shell's safe-center so the readout
       is pinned to the top of the frame like every other data page. */
    '.sm-view{display:flex;flex-direction:column;gap:var(--gap-5,24px);width:100%;max-width:1120px;margin-inline:auto;flex:1 1 auto;min-height:0;justify-content:flex-start;padding-block:20px 44px}',
    '.sm-view:focus{outline:none}',

    /* shared label and heading language */
    '.sm-lab{font-family:var(--mono,ui-monospace,monospace);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim)}',
    '.sm-h{margin:0;font-family:var(--mono,ui-monospace,monospace);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);font-weight:500}',
    '.sm-meta{font-family:var(--mono,ui-monospace,monospace);font-size:10.5px;letter-spacing:.04em;color:var(--dim)}',
    '.sm-none{margin:0;font-size:13px;color:var(--muted)}',
    '.sm-cap{margin:9px 0 0;font-family:var(--mono,ui-monospace,monospace);font-size:10.5px;letter-spacing:.03em;color:var(--dim)}',

    /* headline band: the result over a hairline measurement grid */
    '.sm-band{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:var(--r,8px);background:var(--panel);padding:var(--gap-4,16px) var(--gap-5,24px)}',
    '.sm-band::before{content:"";position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:24px 24px;opacity:.45;-webkit-mask-image:linear-gradient(90deg,#000,#000 58%,transparent);mask-image:linear-gradient(90deg,#000,#000 58%,transparent)}',
    '.sm-band>*{position:relative}',
    '.sm-band-top{display:flex;align-items:flex-end;justify-content:space-between;gap:var(--gap-5,24px);flex-wrap:wrap}',
    '.sm-id{display:flex;flex-direction:column;gap:5px;min-width:0}',
    '.sm-title{margin:2px 0 0;font-size:clamp(19px,2.4vw,24px);font-weight:650;letter-spacing:-.015em;color:var(--ink)}',
    '.sm-sub{font-family:var(--mono,ui-monospace,monospace);font-size:11.5px;letter-spacing:.03em;color:var(--muted);overflow-wrap:anywhere}',
    '.sm-score{display:flex;align-items:baseline;gap:10px}',
    '.sm-val{font-family:var(--mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;font-size:clamp(52px,10vw,96px);font-weight:600;line-height:.85;letter-spacing:-.04em;color:var(--ink)}',
    '.sm-unit{font-family:var(--mono,ui-monospace,monospace);font-size:clamp(18px,2.6vw,26px);color:var(--muted)}',

    /* key figures: plain label over a mono value, one hairline each */
    '.sm-figs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid var(--line2);border-left:1px solid var(--line2);margin-top:var(--gap-4,16px)}',
    '.sm-stat{padding:9px 12px;border-right:1px solid var(--line2);border-bottom:1px solid var(--line2);min-width:0}',
    '.sm-stat .sm-lab{display:block;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.sm-stat .sm-v{font-family:var(--mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;font-size:16px;font-weight:600;color:var(--ink)}',

    /* body: the breakdown beside the totals and history */
    '.sm-body{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:var(--gap-5,24px);align-items:start}',
    '.sm-side{display:flex;flex-direction:column;gap:var(--gap-5,24px);min-width:0}',
    '.sm-section{display:flex;flex-direction:column;min-width:0}',
    '.sm-sec-head{display:flex;align-items:baseline;justify-content:space-between;gap:var(--gap-3,12px);padding-bottom:9px;border-bottom:1px solid var(--line2)}',

    /* the per-part ledger */
    '.sm-parts{display:flex;flex-direction:column}',
    '.sm-prow{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:14px;align-items:baseline;padding:9px 2px;border-bottom:1px solid var(--line)}',
    '.sm-phead{padding:6px 2px;border-bottom:1px solid var(--line2)}',
    '.sm-phead span{font-family:var(--mono,ui-monospace,monospace);font-size:9.5px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--dim)}',
    '.sm-pc-part{min-width:0;font-size:13px;color:var(--ink);overflow-wrap:anywhere}',
    '.sm-pc-out{font-size:12px;letter-spacing:.02em;white-space:nowrap;text-align:right}',
    '.sm-pc-time{font-family:var(--mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;font-size:12.5px;color:var(--ink);text-align:right;white-space:nowrap;min-width:64px}',
    '.sm-out-hit{color:var(--accent,var(--lime))}',
    '.sm-out-err{color:var(--ink)}',
    '.sm-out-warm{color:var(--dim)}',
    '.sm-out-hit::before,.sm-out-err::before{content:"";display:inline-block;width:6px;height:6px;margin-right:7px;vertical-align:1px}',
    '.sm-out-hit::before{background:var(--accent,var(--lime))}',
    '.sm-out-err::before{background:var(--ink)}',

    /* totals */
    '.sm-totals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border-top:1px solid var(--line2);border-left:1px solid var(--line2);margin-top:2px}',

    /* recent history strip */
    '.sm-hist{display:flex;align-items:flex-end;gap:6px;height:76px;margin-top:12px}',
    '.sm-hcol{flex:1 1 0;min-width:0;display:flex;flex-direction:column;justify-content:flex-end;gap:3px;height:100%}',
    '.sm-hval{font-family:var(--mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;font-size:10px;color:var(--muted);text-align:center}',
    '.sm-hbar{width:100%;min-height:3px;background:var(--line2);border-radius:2px 2px 0 0}',
    '.sm-hbar-now{background:var(--accent,var(--lime))}',

    /* actions */
    '.sm-actions{display:flex;flex-wrap:wrap;align-items:center;gap:var(--gap-3,12px);padding-top:var(--gap-4,16px);border-top:1px solid var(--line)}',

    /* empty state */
    '.sm-empty{display:flex;flex-direction:column;gap:var(--gap-3,12px);max-width:52ch}',
    '.sm-empty .sm-title{font-size:22px}',
    '.sm-empty-note{margin:0;font-size:14px;line-height:1.5;color:var(--muted)}',

    /* one staggered entrance, never under reduced motion */
    '@media (prefers-reduced-motion:no-preference){',
    '.sm-view>*{animation:sm-rise .34s cubic-bezier(.3,.9,.3,1) both}',
    '.sm-view>*:nth-child(2){animation-delay:.05s}',
    '.sm-view>*:nth-child(3){animation-delay:.1s}',
    '@keyframes sm-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
    '}',

    /* narrow screens */
    '@media (max-width:900px){.sm-body{grid-template-columns:minmax(0,1fr)}}',
    '@media (max-width:560px){',
    '.sm-view{gap:var(--gap-4,16px);padding-block:14px 32px}',
    '.sm-band{padding:var(--gap-3,12px) var(--gap-4,16px)}',
    '.sm-figs{grid-template-columns:repeat(2,minmax(0,1fr))}',
    '.sm-val{font-size:clamp(46px,15vw,72px)}',
    '.sm-prow{grid-template-columns:minmax(0,1fr) auto;gap:2px 14px}',
    '.sm-pc-part{grid-column:1 / -1}',
    '.sm-phead{display:none}',
    '.sm-pc-time{min-width:0}',
    '}',
    '@media (prefers-reduced-motion:reduce){.sm-view>*{animation:none}}'
  ].join('');
  document.head.appendChild(s);
}

/* ---------- pieces ---------- */

function stat(label, value) {
  const box = h('div', 'sm-stat');
  box.appendChild(h('span', 'sm-lab', label));
  box.appendChild(h('span', 'sm-v', value));
  return box;
}

function buildBand(p) {
  const band = h('section', 'sm-band');
  band.setAttribute('aria-label', 'Run result');

  const top = h('div', 'sm-band-top');
  const id = h('div', 'sm-id');
  id.appendChild(h('span', 'sm-lab', 'Run complete'));
  /* .view-title so the router lands focus on the heading after the swap. */
  id.appendChild(h('h1', 'view-title sm-title', p.title || 'Run'));
  if (p.subtitle) id.appendChild(h('span', 'sm-sub', p.subtitle));
  top.appendChild(id);

  const score = h('div', 'sm-score');
  score.appendChild(h('span', 'sm-val mono', fmtNum(p.value)));
  if (p.unit) {
    score.appendChild(h('span', 'sm-unit mono', unitWord(p.unit, isFinite(p.value) ? p.value : null)));
  }
  top.appendChild(score);
  band.appendChild(top);

  /* Only the figures that were actually measured. A drill with no accuracy shows
     no accuracy cell rather than an empty one. */
  const figs = [];
  if (p.accuracy != null && isFinite(p.accuracy)) figs.push(['Accuracy', fmtPercent(p.accuracy)]);
  if (p.durationMs != null && isFinite(p.durationMs)) figs.push(['Total time', fmtDuration(p.durationMs)]);
  if (p.totals && p.totals.medianMs != null && isFinite(p.totals.medianMs)) figs.push(['Median response', fmtMs(p.totals.medianMs)]);
  if (figs.length) {
    const row = h('div', 'sm-figs');
    figs.forEach((f) => row.appendChild(stat(f[0], f[1])));
    band.appendChild(row);
  }
  return band;
}

function buildLedger(parts, circuit) {
  const section = h('section', 'sm-section');
  const noun = circuit ? ['step', 'steps'] : ['part', 'parts'];
  const head = h('div', 'sm-sec-head');
  head.appendChild(h('h2', 'sm-h', 'Run breakdown'));
  head.appendChild(h('span', 'sm-meta mono', plural(parts.length, noun[0], noun[1])));
  section.appendChild(head);

  if (!parts.length) {
    section.appendChild(h('p', 'sm-none', circuit ? 'No steps recorded for this run.' : 'No parts recorded for this run.'));
    return section;
  }

  const list = h('div', 'sm-parts');
  const hrow = h('div', 'sm-prow sm-phead');
  hrow.setAttribute('aria-hidden', 'true');
  hrow.appendChild(h('span', 'sm-pc-part', circuit ? 'Step' : 'Part'));
  hrow.appendChild(h('span', 'sm-pc-out', 'Result'));
  hrow.appendChild(h('span', 'sm-pc-time', 'Time'));
  list.appendChild(hrow);

  let warm = 0;
  parts.forEach((part) => {
    const ok = part ? part.ok : null;
    const out = outcomeOf(ok, circuit);
    if (ok !== true && ok !== false) warm++;
    const row = h('div', 'sm-prow');
    row.appendChild(h('span', 'sm-pc-part', part && part.label != null ? String(part.label) : ''));
    row.appendChild(h('span', 'sm-pc-out sm-out ' + out.cls, out.text));
    /* No measured time reads as not measured, never as a fabricated one. */
    const ms = part ? part.ms : null;
    row.appendChild(h('span', 'sm-pc-time mono', ms == null || !isFinite(ms) ? NOT_MEASURED : Math.round(ms) + ' ms'));
    list.appendChild(row);
  });
  section.appendChild(list);
  if (warm) {
    section.appendChild(h('p', 'sm-cap', circuit
      ? 'Steps with no completed run are not scored.'
      : 'Warm-up parts are not scored.'));
  }
  return section;
}

function buildTotals(t, circuit) {
  const totals = t || {};
  const section = h('section', 'sm-section');
  const head = h('div', 'sm-sec-head');
  head.appendChild(h('h2', 'sm-h', 'Totals'));
  section.appendChild(head);
  const grid = h('div', 'sm-totals');
  grid.appendChild(stat(circuit ? 'Steps' : 'Parts', fmtCount(totals.parts)));
  grid.appendChild(stat(circuit ? 'Completed' : 'Correct', fmtCount(totals.correct)));
  if (circuit) {
    /* A circuit scores nothing wrong: a step either completed or produced no run.
       The no-run count is the steps that were planned and did not complete. */
    const noRun = (isFinite(totals.parts) && isFinite(totals.correct)) ? totals.parts - totals.correct : null;
    grid.appendChild(stat('No run', fmtCount(noRun)));
  } else {
    grid.appendChild(stat('Wrong', fmtCount(totals.wrong)));
  }
  grid.appendChild(stat('Median response', totals.medianMs == null || !isFinite(totals.medianMs) ? NOT_MEASURED : fmtMs(totals.medianMs)));
  section.appendChild(grid);
  return section;
}

/* The strip is the last few runs of the same drill, oldest first, so the caption
   says exactly that: "Last run" or "Last 5 runs", then the unit the values are
   counted in, named in words. It never states a count the strip does not show. */
function runPhrase(n) { return n === 1 ? 'run' : n + ' runs'; }

function buildHistory(history, unit) {
  const section = h('section', 'sm-section');
  const head = h('div', 'sm-sec-head');
  head.appendChild(h('h2', 'sm-h', 'Recent runs'));
  section.appendChild(head);

  const hist = (history || []).filter((x) => x && isFinite(x.value));
  if (!hist.length) {
    section.appendChild(h('p', 'sm-none', 'No earlier runs yet.'));
    return section;
  }

  const phrase = runPhrase(hist.length);
  const unitWords = unitWord(unit, null);
  let max = 0;
  hist.forEach((x) => { if (x.value > max) max = x.value; });
  const bars = h('div', 'sm-hist');
  bars.setAttribute('role', 'img');
  bars.setAttribute('aria-label', 'Last ' + phrase + ': ' +
    hist.map((x) => fmtNum(x.value)).join(', ') + (unitWords ? ', in ' + unitWords : ''));
  hist.forEach((x, i) => {
    const col = h('div', 'sm-hcol');
    col.appendChild(h('span', 'sm-hval mono', fmtNum(x.value)));
    const bar = h('span', 'sm-hbar' + (i === hist.length - 1 ? ' sm-hbar-now' : ''));
    const px = max > 0 ? Math.max(3, Math.round((x.value / max) * 46)) : 3;
    if (bar.style) bar.style.height = px + 'px';
    col.appendChild(bar);
    bars.appendChild(col);
  });
  section.appendChild(bars);
  section.appendChild(h('p', 'sm-cap', 'Last ' + phrase + (unitWords ? ' \u00b7 ' + unitWords : '')));
  return section;
}

function navigateTo(name) {
  if (ctxRef && typeof ctxRef.navigate === 'function') ctxRef.navigate(name);
}

function buildActions(p) {
  const actions = h('footer', 'sm-actions');
  /* Run again returns to the run's own screen: the drill host, or Circuit. */
  const again = h('button', 'btn-primary', 'Run again');
  again.type = 'button';
  again.addEventListener('click', function () {
    navigateTo(p.kind === 'circuit' ? 'circuit' : 'train');
  });
  actions.appendChild(again);

  const back = p.back || {};
  const backBtn = h('button', 'btn-ghost', back.label || 'Back to Drills');
  backBtn.type = 'button';
  backBtn.addEventListener('click', function () { navigateTo(back.view || 'train'); });
  actions.appendChild(backBtn);
  return actions;
}

function buildEmpty() {
  const wrap = h('div', 'sm-empty');
  wrap.appendChild(h('h1', 'view-title sm-title', 'Summary'));
  wrap.appendChild(h('p', 'sm-empty-note', 'No run to show.'));
  const actions = h('div', 'sm-actions');
  const go = h('button', 'btn-primary', 'Back to Drills');
  go.type = 'button';
  go.addEventListener('click', function () { navigateTo('train'); });
  actions.appendChild(go);
  wrap.appendChild(actions);
  return wrap;
}

/* ---------- render ---------- */

export async function render(section, ctx) {
  ctxRef = ctx || {};
  injectStyles();
  section.classList.add('sm-view');
  section.replaceChildren();

  const p = lastrun.peek();
  if (!p || typeof p !== 'object') {
    section.appendChild(buildEmpty());
    return;
  }

  section.appendChild(buildBand(p));

  const circuit = isCircuit(p);
  const body = h('div', 'sm-body');
  body.appendChild(buildLedger(Array.isArray(p.parts) ? p.parts : [], circuit));
  const side = h('aside', 'sm-side');
  side.appendChild(buildTotals(p.totals, circuit));
  side.appendChild(buildHistory(p.history, p.unit));
  body.appendChild(side);
  section.appendChild(body);

  section.appendChild(buildActions(p));
}

/* The view owns nothing outside its own DOM, so there is nothing to release. */
export function teardown() {
  ctxRef = null;
}
