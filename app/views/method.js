/* Neuralbase view: Method.
   The honest-claims surface, and the page a skeptical visitor lands on. It answers
   "does this work or is it marketing" in the first two sentences, then gives one
   row per drill: the skill it trains, what a set actually looks like, and what the
   research found, with the numbers the research gives. The limits are stated once,
   as a position, at the end. Drill copy comes from app/content.js. Static; no data
   reads. */

function h(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* The drill's mark, drawn in currentColor so every theme picks it up. Our own
   static SVG string, never user or data text. */
function iconEl(d) {
  var s = h('span', 'drill-ic');
  s.setAttribute('aria-hidden', 'true');
  if (d && d.icon) s.innerHTML = d.icon;
  return s;
}

/* Scoped styles. Theme tokens only, so all five themes pick them up. Column and
   heading centering come from .view-mid and .mid-head in styles.css.

   One rhythm for the whole page: --mb-sec between sibling sections, --mb-in for
   the gaps inside a section. Every block below reads one of the two, so nothing
   drifts. The topbar owns the view name now, so the opening heading is the
   page's own thesis rather than a repeat of "Method". */
function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById('nb-method-styles')) return;
  var s = document.createElement('style');
  s.id = 'nb-method-styles';
  s.textContent = [
    '.mb{--mb-sec:26px;--mb-in:12px}',
    '.mb-answer{margin:9px 0 0;font-size:16px;line-height:1.55;color:var(--ink);text-wrap:pretty}',
    '.mb-sec{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:var(--mb-sec) 0 0;padding-bottom:8px;border-bottom:1px solid var(--line)}',
    '.mb-sec-n{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);text-align:right}',
    '.mb-list{margin-top:var(--mb-in)}',
    '.mb-row{padding:14px 0;border-bottom:1px solid var(--line)}',
    '.mb-row:last-child{border-bottom:0}',
    '.mb-row-top{display:flex;align-items:center;gap:10px;min-width:0}',
    '.mb-ic{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;flex:none;background:var(--panel2);border:1px solid var(--line);border-radius:8px}',
    '.mb-name{min-width:0;overflow-wrap:break-word}',
    '.mb-dl{display:grid;grid-template-columns:96px 1fr;gap:8px 14px;margin:var(--mb-in) 0 0}',
    '.mb-dt{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);padding-top:3px}',
    '.mb-dd{margin:0;font-size:13px;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}',
    '.mb-ev{color:var(--ink);border-left:2px solid var(--lime-edge);padding-left:10px}',
    '.mb-sources{margin:10px 0 0 42px;font-size:12px;color:var(--muted)}',
    '.mb-sources summary{width:fit-content;cursor:pointer;color:var(--muted)}',
    '.mb-sources summary:focus-visible,.mb-source-link:focus-visible{outline:2px solid var(--lime-edge);outline-offset:3px;border-radius:2px}',
    '.mb-source-list{margin:8px 0 0;padding-left:18px}',
    '.mb-source-list li+li{margin-top:8px}',
    '.mb-source-claim{margin:0 0 2px;line-height:1.5;overflow-wrap:anywhere}',
    '.mb-source-link{color:var(--ink);overflow-wrap:anywhere}',
    '.mb-source-note{margin:8px 0 0;line-height:1.5;overflow-wrap:anywhere}',
    '.mb-limits{margin-top:var(--mb-in);border-left:2px solid var(--lime-edge);padding-left:14px}',
    '.mb-statement{margin:0;font-size:14px;line-height:1.6;color:var(--ink);text-wrap:pretty}',
    '.mb-nc{margin:var(--mb-in) 0 0;padding-top:var(--mb-in);border-top:1px solid var(--line);display:grid;grid-template-columns:96px 1fr;gap:8px 14px}',
    '.mb-note{margin:var(--mb-in) 0 0;font-size:13px;line-height:1.6;color:var(--muted);max-width:62ch;text-wrap:pretty}',
    '@media (max-width:430px){.mb-dl,.mb-nc{grid-template-columns:1fr;gap:2px 0}.mb-dt{padding-top:6px}.mb-limits{padding-left:11px}.mb-ev{padding-left:9px}}'
  ].join('');
  document.head.appendChild(s);
}

/* One row per drill. The evidence line is the reason the page exists, so it gets
   the accent rule and the brighter ink while the other two stay quiet. */
function drillRow(d) {
  var row = h('article', 'mb-row');
  var top = h('div', 'mb-row-top');
  var ic = h('span', 'mb-ic');
  ic.appendChild(iconEl(d));
  top.appendChild(ic);
  top.appendChild(h('h3', 'mb-name h-sub', d.name));
  row.appendChild(top);

  var dl = h('dl', 'mb-dl');
  [['Trains', d.trains, ''], ['In a set', d.works, ''], ['Evidence', d.evidence, ' mb-ev']].forEach(function (pair) {
    dl.appendChild(h('dt', 'mb-dt', pair[0]));
    dl.appendChild(h('dd', 'mb-dd' + pair[2], pair[1]));
  });
  row.appendChild(dl);
  row.appendChild(sourceDisclosure(d));
  return row;
}

function sourceDisclosure(d) {
  var details = h('details', 'mb-sources');
  details.appendChild(h('summary', '', 'Sources for ' + d.name));
  var sources = Array.isArray(d.sources) ? d.sources : [];
  if (!sources.length) {
    details.appendChild(h('p', 'mb-source-note', 'No directly matching source is documented for this outcome.'));
    return details;
  }

  var list = h('ul', 'mb-source-list');
  sources.forEach(function (source) {
    var item = h('li');
    item.appendChild(h('p', 'mb-source-claim', source.claim));
    var link = h('a', 'mb-source-link', source.label);
    link.setAttribute('href', 'https://pubmed.ncbi.nlm.nih.gov/' + source.id + '/');
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    item.appendChild(link);
    list.appendChild(item);
  });
  details.appendChild(list);
  return details;
}

function sectionHead(title, note) {
  var head = h('div', 'mb-sec');
  /* The visible label is a span, not a heading: the section itself carries the
     accessible name (see render), so a reader gets the landmark without the
     label competing with the drill names for a heading level. */
  head.appendChild(h('span', 'mb-sec-t h-label', title));
  if (note) head.appendChild(h('span', 'mb-sec-n', note));
  return head;
}

export function render(container, ctx) {
  container.classList.add('view');
  container.setAttribute('aria-label', 'Method');
  container.innerHTML = '';
  injectStyles();

  var COPY = (globalThis.Content && globalThis.Content.COPY) || {};
  var DRILLS = (globalThis.Content && globalThis.Content.DRILLS) || [];

  var col = h('div', 'view-mid mb');
  container.appendChild(col);

  /* The topbar already names the view, so the page opens on its own thesis
     instead of repeating "Method". */
  var head = h('div', 'mid-head');
  var title = h('h2', 'view-title', 'What each drill does, and what the research found');
  title.tabIndex = -1;
  head.appendChild(title);
  /* The near-transfer answer in one sentence, so a skeptical reader gets the claim
     and its limit before any of the rows. The second half of the old lead only
     announced what the rest of the page was about to say. */
   head.appendChild(h('p', 'mb-answer', 'Each drill gives practice on a specific task. Where the allowed research directly matches a drill, we link it; where it does not, we say so.'));
  col.appendChild(head);

  var rows = [];
  var section = h('section');
  section.setAttribute('aria-label', 'The nine drills');
  section.appendChild(sectionHead('The nine drills', 'Working memory to arithmetic'));
  var list = h('div', 'mb-list');
  for (var i = 0; i < DRILLS.length; i++) {
    var row = drillRow(DRILLS[i]);
    rows.push(row);
    list.appendChild(row);
  }
  section.appendChild(list);
  col.appendChild(section);

  /* The limits, stated once. A considered position, so it gets its own block with
     the accent rule rather than a paragraph buried in the middle of the page. */
  var limitsSec = h('section');
  limitsSec.setAttribute('aria-label', 'Where the evidence stops');
  limitsSec.appendChild(sectionHead('Where the evidence stops'));
  var limits = h('div', 'card mb-limits');
  limits.appendChild(h('p', 'mb-statement', COPY.methodHonest || 'The links below concern specific tasks, populations, and outcomes. Neuralbase has run no trials of its own, and those results do not establish broader effects for this product.'));
  var nc = h('dl', 'mb-nc');
  [
    ['Life outcomes', 'The linked sources do not establish effects on grades, test scores, jobs, or income.'],
    ['New research', 'Neuralbase has run no trials of its own, so none of these figures are ours to defend.']
  ].forEach(function (pair) {
    nc.appendChild(h('dt', 'mb-dt', pair[0]));
    nc.appendChild(h('dd', 'mb-dd', pair[1]));
  });
  limits.appendChild(nc);
  limitsSec.appendChild(limits);
  col.appendChild(limitsSec);

  var practiceSec = h('section');
  practiceSec.setAttribute('aria-label', 'Practice');
  practiceSec.appendChild(sectionHead('Practice', 'Spaced and interleaved'));
  /* Three ways to train, which the rail already offers as three buttons. The
     sentence on interleaving and spacing stays, because it is the claim the
     "Practice" heading above it is making. */
  practiceSec.appendChild(h('p', 'mb-note', COPY.methodPractice || 'No directly matching source is documented for this practice statement.'));
  col.appendChild(practiceSec);

  /* Rows arrive in sequence, so they read as a list being walked down rather than
     a wall that appeared. motion.reveal already drops the movement under reduced
     motion, and this skips the timers entirely when it is set. */
  if (ctx && ctx.motion && typeof ctx.motion.reveal === 'function') {
    try {
      var reduced = typeof ctx.motion.reduced === 'function' && ctx.motion.reduced();
      if (!reduced) {
        rows.forEach(function (row, i) {
          setTimeout(function () { ctx.motion.reveal(row, { duration: 260, y: 10 }); }, 60 + i * 55);
        });
      }
    } catch (e) { /* degrade to a still page */ }
  }
}
