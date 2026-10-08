/* Neuralbase view: Progress.
   Reads runs, sessions and your own kudos from ctx.db.loadUserData(), paints from the
   local cache first, then repaints on the network answer. Carries the habit heatmap,
   the records timeline, per-drill bests, and the recent-runs list with kudos notches.

   The normalizers, the date helpers and h() come from dashboard.js, which this view
   imports rather than duplicating. No new shared module, no new file. */

import {
  h, drillRegistry, metaFor, dirMap, iconEl, localDate, msOf,
  whenLabel, toState, readStore, patchStore
} from './dashboard.js';

var STYLE_ID = 'cortex-progress-styles';
var HEAT_WEEKS = 18;
var RECORD_CAP = 12;
var RUN_CAP = 12;
var MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var DAY_LABELS = ['M', '', 'W', '', 'F', '', ''];

/* ---------------- scoped styles (theme tokens only) ---------------- */

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  var s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = [
    /* The heatmap cell size is the one measurement that has to fit 18 weeks at 360px,
       so it is declared once here and every rule reads it. Below 560 it shrinks, and
       the scroll wrapper is the fallback if a theme ever needs more room. */
    /* One stack, one gap. Every section sits in this column and takes its
       vertical space from the same value, so no section invents its own. */
    '.pg{display:flex;flex-direction:column;gap:var(--pg-gap,14px);--pg-gap:14px}',
    /* The heat card is sized by its grid: width:max-content makes the card hug
       the 18 columns, so the grid fills the card edge to edge and no dead strip
       is left on the right. max-width keeps it from overflowing narrow screens. */
    '.pg-heat-card{--pg-cell:20px;--pg-cell-gap:4px;--pg-cell-r:2px;width:max-content;max-width:100%;min-width:0}',

    /* readout strip, the same instrument language as the dashboard */
    '.pg-read{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));background:var(--panel);border:1px solid var(--line);border-radius:var(--r);overflow:hidden}',
    '.pg-read-l{font-family:var(--mono);font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim)}',
    '.nb-readout.pg-read-v{--nb-readout:21px}',
    '.pg-read-c{font-size:13px;color:var(--dim);line-height:1.35}',
    /* Two content-sized cards, one row: the habit grid sets its own width and the
       bests grid fills what is left. Neither can leave a hole under the other,
       because neither is stretched to match a taller neighbour. */
    '.pg-top{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:var(--pg-gap,14px);align-items:start}',

    /* Heat cells scale up on a wide screen. The grid is the page's one large
       surface, so it takes the room the centered column gives it instead of
       sitting as a small block in the corner of a much wider card. */
    '@media(min-width:900px){.pg-heat-card{--pg-cell:26px;--pg-cell-gap:5px;--pg-cell-r:3px}}',
    /* With nothing trained the habit card is alone in the row, and a card sized
       to its own grid pinned to the left edge reads as a leftover. One column,
       centered, so it reads as the one thing the page has to say. The second
       track has to go as well as the alignment: a grid still reserves a 1fr
       column for the card that is not there. */
    '.pg-top-solo{grid-template-columns:minmax(0,max-content);justify-content:center}',

    /* heatmap: columns are weeks, rows are weekdays Monday first */
    '.pg-heat-scroll{flex:1;min-width:0;overflow-x:auto;overflow-y:hidden;padding-bottom:2px}',
    '.pg-heat-inner{width:max-content}',
    '.pg-heat-months{display:grid;grid-auto-flow:column;grid-auto-columns:var(--pg-cell);gap:var(--pg-cell-gap);margin-bottom:5px}',
    /* min-width:0 keeps the label from widening its own track. Without it the item's
       min-content size expands the column past --pg-cell, the month ruler ends up
       wider than the cell grid under it, and the ruler stops lining up. The text
       still overflows visibly, which is what overflow:visible is there for. */
    '.pg-heat-month{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);white-space:nowrap;overflow:visible;min-width:0}',
    '.pg-heat-body{display:flex;gap:9px;align-items:flex-start}',
    '.pg-heat-days{display:grid;grid-template-rows:repeat(7,var(--pg-cell));gap:var(--pg-cell-gap);flex:none}',
    '.pg-heat-day{font-family:var(--mono);font-size:10px;color:var(--dim);line-height:var(--pg-cell);letter-spacing:.04em;text-align:right}',
    '.pg-heat-day.blank{visibility:hidden}',
    '.pg-heat{display:grid;grid-auto-flow:column;grid-auto-columns:var(--pg-cell);grid-template-rows:repeat(7,var(--pg-cell));gap:var(--pg-cell-gap);width:max-content}',
    '.pg-cell{position:relative;width:var(--pg-cell);height:var(--pg-cell);border-radius:var(--pg-cell-r);border:1px solid var(--line);background:var(--panel2);padding:0;display:block}',
    '.pg-cell::after{content:"";position:absolute;inset:1px;border-radius:var(--pg-cell-r);background:var(--accent);opacity:0}',
    '.pg-cell[data-level="1"]::after{opacity:.3}',
    '.pg-cell[data-level="2"]::after{opacity:.52}',
    '.pg-cell[data-level="3"]::after{opacity:.76}',
    '.pg-cell[data-level="4"]::after{opacity:1}',
    '.pg-cell.today{box-shadow:inset 0 0 0 1px var(--muted)}',
    '.pg-cell:hover{border-color:var(--line2)}',
    '.pg-heat-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:11px;padding-top:10px;border-top:1px solid var(--line)}',
    '.pg-legend{display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim)}',
    '.pg-legend .pg-cell{width:11px;height:11px;pointer-events:none}',
    '.pg-heat-note{margin:0;font-size:12px;color:var(--dim);line-height:1.45;max-width:46ch}',

    /* records timeline: a log, newest first */
    '.pg-recs{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}',
    '.pg-rec{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:var(--gap-3);align-items:center;padding:9px 0;border-bottom:1px solid var(--line)}',
    '.pg-rec:last-child{border-bottom:0}',
    '.pg-rec-main{display:flex;flex-direction:column;gap:2px;min-width:0}',
    '.pg-rec-name{font-size:13px;font-weight:600;min-width:0;overflow-wrap:break-word}',
    '.pg-rec-move{font-size:13px;color:var(--muted);line-height:1.4}',
    '.pg-rec-move b{font-family:var(--mono);font-weight:500;color:var(--ink);font-variant-numeric:tabular-nums}',
    '.pg-rec-when{font-family:var(--mono);font-size:10px;color:var(--dim);letter-spacing:.04em;white-space:nowrap}',
    '.pg-rec.is-new .pg-rec-name{color:var(--accent)}',
    '.pg-recs-more{margin:9px 0 0;font-size:13px;color:var(--dim)}',
    '.pg-empty{margin:0;color:var(--dim);font-size:13px;line-height:1.5}',
    /* An empty card is a strip, not a box: the heading and the one line share a
       row, so a card with nothing to show never takes a panel's worth of space. */
    '.pg-strip{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;padding:12px 14px}',
    '.pg-strip .card-head{margin:0;flex:none}',
    '.pg-strip .pg-empty{margin:0}',

    /* per-drill bests */
    '.pg-bests{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:8px}',
    '.pg-best{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:9px 10px;display:flex;flex-direction:column;gap:4px;min-width:0}',
    '.pg-best-top{display:flex;align-items:center;gap:7px;min-width:0}',
    '.pg-best-name{font-size:13px;font-weight:600;min-width:0;overflow-wrap:break-word;line-height:1.25}',
    '.pg-best-v{font-family:var(--mono);font-size:16px;font-weight:500;font-variant-numeric:tabular-nums;line-height:1}',
    '.pg-best-v .u{font-size:12px;color:var(--muted)}',
    '.pg-best-c{font-size:12px;color:var(--dim)}',
    '.pg-best.none .pg-best-v{color:var(--dim)}',

    /* runs with the tally rail */
    '.pg-runs{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}',
    '.pg-run{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto auto;gap:11px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line)}',
    '.pg-run:last-child{border-bottom:0}',
    '.pg-run-name{font-size:13px;min-width:0;overflow-wrap:break-word}',
    '.pg-run-val{font-family:var(--mono);font-size:13px;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.pg-run-when{font-family:var(--mono);font-size:10px;color:var(--dim);letter-spacing:.04em;white-space:nowrap}',
    '.pg-run-count{font-family:var(--mono);font-size:13px;font-variant-numeric:tabular-nums;color:var(--muted);min-width:16px;text-align:right}',
    '.pg-tally{display:flex;align-items:flex-end;background:none;border:1px solid transparent;border-radius:8px;padding:4px 5px;transition:border-color .15s ease,background .15s ease}',
    '.pg-tally:hover{background:var(--hover);border-color:var(--line)}',
    '.pg-tally[disabled]{cursor:default}',
    '.pg-tally[disabled]:hover{background:none;border-color:transparent}',
    '.pg-tally[aria-pressed="true"] .nb-tick{background:var(--accent)}',
    '.pg-tally[aria-pressed="true"] .nb-tick.slot{background:var(--accent-edge)}',
    '.pg-say{margin:9px 0 0;font-size:13px;color:var(--muted);line-height:1.4}',
    '.pg-say:empty{display:none}',
    '.pg-say.bad{color:var(--ink);border-left:2px solid var(--warn);padding-left:9px}',
    '.pg-foot{margin:0;padding-top:11px;border-top:1px solid var(--line);font-size:12px;color:var(--dim);line-height:1.5}',

    /* The habit grid and the bests sit side by side only when the row is wide
       enough to give the bests three columns beside the grid. Below that they
       stack, and the habit card fills the column with the grid centered inside,
       so neither a dead strip nor a floating card appears. */
    '@media(max-width:1279px){.pg-top{grid-template-columns:minmax(0,1fr)}.pg-heat-card{width:100%}.pg-heat-body{justify-content:center}.pg-heat-scroll{flex:0 1 auto}}',
    '@media(max-width:1040px){.pg-read{grid-template-columns:repeat(3,minmax(0,1fr))}.pg-read-cell{border-bottom:1px solid var(--line)}.pg-read-cell:nth-child(3n){border-right:0}.pg-read-cell:nth-last-child(-n+3){border-bottom:0}}',
    '@media(max-width:560px){.pg-heat-card{--pg-cell:11px;--pg-cell-gap:2px;--pg-cell-r:1px}.pg-read{grid-template-columns:1fr 1fr}.pg-read-cell:nth-child(3n){border-right:1px solid var(--line)}.pg-read-cell:nth-child(2n){border-right:0}.pg-read-cell:nth-last-child(-n+3){border-bottom:1px solid var(--line)}.pg-read-cell:last-child{grid-column:1/-1;border-right:0;border-bottom:0}.nb-readout.pg-read-v{--nb-readout:19px}.pg-bests{grid-template-columns:1fr 1fr}.pg-run{gap:8px}}'
  ].join('');
  document.head.appendChild(s);
}

/* ---------------- heatmap ---------------- */

function cellLabel(cell) {
  var d = new Date(cell.key + 'T00:00:00');
  var date = d.getDate() + ' ' + MONTH[d.getMonth()] + ' ' + d.getFullYear();
  return date + ', ' + cell.n + (cell.n === 1 ? ' session' : ' sessions');
}

function buildHeatmap(state, now) {
  var data = globalThis.Store.heatmap(state, HEAT_WEEKS, now);
  var card = h('div', 'card pg-heat-card');

  var head = h('div', 'card-head');
  head.appendChild(h('h3', null, 'Habit'));
  head.appendChild(h('span', 'cap', 'Sessions, last ' + HEAT_WEEKS + ' weeks'));
  card.appendChild(head);

  var body = h('div', 'pg-heat-body');

  var days = h('div', 'pg-heat-days');
  days.setAttribute('aria-hidden', 'true');
  for (var d = 0; d < DAY_LABELS.length; d++) {
    days.appendChild(h('span', 'pg-heat-day' + (DAY_LABELS[d] ? '' : ' blank'), DAY_LABELS[d]));
  }
  body.appendChild(days);

  var scroll = h('div', 'pg-heat-scroll');
  var inner = h('div', 'pg-heat-inner');

  /* A month ruler over the columns, so the 18 weeks are readable as dates rather
     than as an abstract block. Only the first column of a month is labelled. */
  var months = h('div', 'pg-heat-months');
  months.setAttribute('aria-hidden', 'true');
  var lastMonth = -1;
  for (var w = 0; w < data.weeks.length; w++) {
    var first = data.weeks[w][0];
    var d = new Date(first.key + 'T00:00:00');
    var m = d.getMonth();
    months.appendChild(h('span', 'pg-heat-month', m !== lastMonth ? MONTH[m] : ''));
    lastMonth = m;
  }
  inner.appendChild(months);

  var grid = h('div', 'pg-heat');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Sessions per day over the last ' + HEAT_WEEKS + ' weeks');

  var cells = [];
  var todayKey = localDate(now);
  var todayIndex = -1;
  for (var w = 0; w < data.weeks.length; w++) {
    var col = data.weeks[w];
    for (var r = 0; r < col.length; r++) {
      var cell = col[r];
      var b = h('button', 'pg-cell');
      b.type = 'button';
      b.setAttribute('data-level', String(cell.level));
      b.setAttribute('aria-label', cellLabel(cell));
      b.title = cellLabel(cell);
      if (cell.key === todayKey) { b.classList.add('today'); todayIndex = cells.length; }
      cells.push(b);
      grid.appendChild(b);
    }
  }

  /* Roving tabindex: one stop for the grid, then arrow keys move inside it. 126
     cells as 126 tab stops would make the page unusable, so the arrows carry the
     keyboard. Week across, weekday down. */
  var start = todayIndex >= 0 ? todayIndex : cells.length - 1;
  for (var i = 0; i < cells.length; i++) cells[i].tabIndex = i === start ? 0 : -1;
  grid.addEventListener('keydown', function (e) {
    var cur = cells.indexOf(document.activeElement);
    if (cur < 0) return;
    var next = -1;
    if (e.key === 'ArrowRight') next = cur + 7;
    else if (e.key === 'ArrowLeft') next = cur - 7;
    else if (e.key === 'ArrowDown') next = cur + 1;
    else if (e.key === 'ArrowUp') next = cur - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = cells.length - 1;
    if (next < 0 || next >= cells.length) return;
    /* Up and down stay inside their week, so they never jump a whole column. */
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && Math.floor(next / 7) !== Math.floor(cur / 7)) return;
    e.preventDefault();
    cells[cur].tabIndex = -1;
    cells[next].tabIndex = 0;
    cells[next].focus();
  });

  inner.appendChild(grid);
  scroll.appendChild(inner);
  body.appendChild(scroll);
  card.appendChild(body);

  var foot = h('div', 'pg-heat-foot');
  var legend = h('div', 'pg-legend');
  legend.appendChild(h('span', null, 'Less'));
  for (var lv = 0; lv <= 4; lv++) {
    var sw = h('span', 'pg-cell');
    sw.setAttribute('data-level', String(lv));
    legend.appendChild(sw);
  }
  legend.appendChild(h('span', null, 'More'));
  foot.appendChild(legend);
  /* The legend is a key for four genuinely distinct levels, so it stays. The
     sentence that used to sit beside it explained the scale instead of showing
     it, and the legend already shows it. */
  if (!data.max) foot.appendChild(h('p', 'pg-heat-note', 'No sessions yet.'));
  card.appendChild(foot);

  return card;
}

/* ---------------- records timeline ---------------- */

function buildRecords(reg, state, now) {
  var all = globalThis.Store.personalRecords(state, dirMap(reg));
  var card = h('div', 'card');
  var head = h('div', 'card-head');
  head.appendChild(h('h3', null, 'Records'));
  card.appendChild(head);

  if (!all.length) {
    /* Nothing to show, so show nothing. An empty card carrying an explanation of
       why it is empty is worse than no card. */
    card.hidden = true;
    return card;
  }

  /* Newest first, because the newest one is what the reader came for. */
  var shown = all.slice().reverse();
  var top = Math.min(shown.length, RECORD_CAP);
  var list = h('ul', 'pg-recs');
  for (var i = 0; i < top; i++) {
    var rec = shown[i];
    var m = metaFor(reg, rec.drillId);
    var unit = m.unit || '';
    var delta = Math.abs(rec.best - rec.prev);

    var li = h('li', 'pg-rec' + (i === 0 ? ' is-new' : ''));
    li.appendChild(iconEl(m.icon));

    var main = h('div', 'pg-rec-main');
    main.appendChild(h('span', 'pg-rec-name', m.name));
    var move = h('span', 'pg-rec-move');
    move.appendChild(document.createTextNode((m.direction === 'lower' ? 'Faster by ' : 'Higher by ') + ' '));
    move.appendChild(h('b', null, String(delta) + (unit ? ' ' + unit : '')));
    move.appendChild(document.createTextNode(' on the ' + String(rec.prev) + (unit ? ' ' + unit : '') + ' before it. '));
    main.appendChild(move);
    li.appendChild(main);
    li.appendChild(h('span', 'pg-rec-when', whenLabel(rec.at, now)));
    list.appendChild(li);
  }
  card.appendChild(list);

  if (all.length > top) {
    var more = all.length - top;
    card.appendChild(h('p', 'pg-recs-more',
      more + ' earlier record' + (more === 1 ? '' : 's') + ' not shown.'));
  }
  return card;
}

/* ---------------- per-drill bests ---------------- */

/* Only drills with runs get a tile. Nine tiles reading "--" and "not trained" is
   noise, not information: an untrained drill has no best, so it has nothing to
   say here. The untrained case is one line under the heading instead. */
function buildBests(reg, state, ctx) {
  var S = globalThis.Store;
  var card = h('div', 'card');
  var head = h('div', 'card-head');
  head.appendChild(h('h3', null, 'Best per drill'));
  card.appendChild(head);

  var ids = Object.keys(reg);
  if (!ids.length) {
    card.appendChild(h('p', 'pg-empty', 'No drills loaded.'));
    return card;
  }

  var trained = [];
  for (var i = 0; i < ids.length; i++) {
    var m = reg[ids[i]];
    var agg = S.aggregate(state, m.id, m.direction);
    if (agg.best != null) trained.push({ m: m, agg: agg });
  }

  if (!trained.length) {
    card.classList.add('pg-strip');
    card.appendChild(h('p', 'pg-empty',
      'No drills trained yet. Finish a run and your best appears here.'));
    if (!state.sessions.length && !state.records.length) {
      var start = h('button', 'btn-primary', 'Start a drill');
      start.type = 'button';
      start.addEventListener('click', function () {
        if (ctx && typeof ctx.navigate === 'function') ctx.navigate('train');
      });
      card.appendChild(start);
    }
    return card;
  }

  var grid = h('div', 'pg-bests');
  for (var t = 0; t < trained.length; t++) {
    var m2 = trained[t].m;
    var agg2 = trained[t].agg;
    var box = h('div', 'pg-best');
    var top = h('div', 'pg-best-top');
    top.appendChild(iconEl(m2.icon));
    top.appendChild(h('span', 'pg-best-name', m2.name));
    box.appendChild(top);
    var v = h('span', 'pg-best-v');
    v.appendChild(document.createTextNode(String(agg2.best)));
    if (m2.unit) v.appendChild(h('span', 'u', ' ' + m2.unit));
    box.appendChild(v);
    box.appendChild(h('span', 'pg-best-c', agg2.attempts
      ? agg2.attempts + (agg2.attempts === 1 ? ' run' : ' runs')
      : 'not trained'));
    grid.appendChild(box);
  }
  card.appendChild(grid);
  return card;
}

/* ---------------- kudos tally ---------------- */

/* Notches grouped in fives with the diagonal strike, the way a tally is kept on
   paper. Not a heart and not a thumb: a mark cut into a log. */
function buildTally(count) {
  var rail = h('span', 'nb-track notch pg-rail');
  rail.setAttribute('aria-hidden', 'true');
  var n = Math.max(0, count);
  if (n === 0) {
    /* Faint slots, so you can see where the tap lands before you land it. */
    for (var s = 0; s < 5; s++) rail.appendChild(h('span', 'nb-tick slot'));
    return rail;
  }
  /* Cap the drawn notches, so a busy run cannot push the row apart. The number
     beside the rail carries the true count. */
  var full = Math.floor(Math.min(n, 20) / 5);
  var rest = Math.min(n, 20) % 5;
  for (var g = 0; g < full; g++) {
    var group = h('span', 'nb-group');
    for (var i = 0; i < 4; i++) group.appendChild(h('span', 'nb-tick'));
    group.appendChild(h('span', 'nb-tick diag'));
    rail.appendChild(group);
  }
  if (rest) {
    var tail = h('span', 'nb-group');
    for (var j = 0; j < rest; j++) tail.appendChild(h('span', 'nb-tick'));
    rail.appendChild(tail);
  }
  return rail;
}

function paintKudos(btn, count, isGiven) {
  btn.setAttribute('aria-pressed', isGiven ? 'true' : 'false');
  var label = btn.getAttribute('data-name') || 'this run';
  btn.setAttribute('aria-label', (isGiven ? 'Remove your kudos from ' : 'Add kudos to ') + label);
  var old = btn.querySelector('.pg-track');
  var next = buildTally(count);
  if (old) btn.replaceChild(next, old); else btn.appendChild(next);
  var num = btn.parentNode ? btn.parentNode.querySelector('.pg-run-count') : null;
  if (num) num.textContent = String(count);
}

/* Optimistic toggle: the notch moves on tap, the server answer settles it, and a
   failure rolls the notch back and says so in words. */
function onKudos(ctx, btn, say, id, given, counts) {
  if (!ctx.db || typeof ctx.db.toggleKudos !== 'function') return;
  var wasGiven = !!given[id];
  var before = counts[id] || 0;
  var optimistic = wasGiven ? -1 : 1;

  if (wasGiven) delete given[id]; else given[id] = true;
  counts[id] = Math.max(0, before + optimistic);
  paintKudos(btn, counts[id], !wasGiven);
  say.textContent = wasGiven ? 'Taking your notch back off.' : 'Notching it.';
  say.className = 'pg-say';

  Promise.resolve()
    .then(function () { return ctx.db.toggleKudos(id); })
    .then(function (res) {
      if (!res || res.ok === false) throw res;
      var nowGiven = typeof res.given === 'boolean' ? res.given : !wasGiven;
      if (nowGiven) given[id] = true; else delete given[id];
      counts[id] = typeof res.count === 'number' ? res.count : Math.max(0, counts[id]);
      saveGiven(given);
      paintKudos(btn, counts[id], nowGiven);
      say.textContent = nowGiven ? 'Notch added and saved.' : 'Notch removed.';
    })
    .catch(function () {
      if (wasGiven) given[id] = true; else delete given[id];
      counts[id] = before;
      paintKudos(btn, before, wasGiven);
      say.textContent = 'That notch did not save. Tap again to retry.';
      say.className = 'pg-say bad';
    });
}

/* The given tally lives in Store state, so a reload cannot count the same run twice. */
function saveGiven(given) {
  patchStore({ kudosGiven: Object.keys(given) });
}

function renderRuns(ctx, reg, runs, given, counts, now) {
  var card = h('div', 'card');
  var head = h('div', 'card-head');
  head.appendChild(h('h3', null, 'Recent runs'));
  card.appendChild(head);

  if (!runs.length) {
    card.hidden = true;
    return card;
  }

  var say = h('p', 'pg-say');
  say.setAttribute('role', 'status');
  say.setAttribute('aria-live', 'polite');

  var list = h('ul', 'pg-runs');

  var sorted = runs.slice().sort(function (a, b) { return msOf(b) - msOf(a); }).slice(0, RUN_CAP);
  for (var i = 0; i < sorted.length; i++) {
    var run = sorted[i];
    var id = run.client_id || run.clientId || null;
    var m = metaFor(reg, run.drill_id || run.drillId);
    var unit = run.unit || m.unit;
    var count = id && counts[id] != null ? counts[id] : 0;
    var isGiven = !!(id && given[id]);

    var li = h('li', 'pg-run');
    li.appendChild(iconEl(m.icon));
    li.appendChild(h('span', 'pg-run-name', m.name));
    li.appendChild(h('span', 'pg-run-val', String(run.value) + (unit ? ' ' + unit : '')));

    var btn = h('button', 'pg-tally');
    btn.type = 'button';
    btn.setAttribute('data-run', id || '');
    btn.setAttribute('data-name', m.name + ' run');
    if (!id) {
      /* No client id means there is no addressable run row, so nothing to tap. */
      btn.disabled = true;
      btn.setAttribute('aria-label', 'Kudos unavailable, this run was saved without an id');
    } else {
      btn.setAttribute('aria-pressed', isGiven ? 'true' : 'false');
      btn.setAttribute('aria-label', (isGiven ? 'Remove your kudos from ' : 'Add kudos to ') + m.name + ' run');
      btn.addEventListener('click', (function (runId, button) {
        return function () { onKudos(ctx, button, say, runId, given, counts); };
      })(id, btn));
    }
    btn.appendChild(buildTally(count));
    li.appendChild(btn);

    var num = h('span', 'pg-run-count');
    num.setAttribute('aria-live', 'polite');
    num.textContent = String(count);
    li.appendChild(num);

    li.appendChild(h('span', 'pg-run-when', whenLabel(msOf(run), now)));
    list.appendChild(li);
  }

  card.appendChild(list);
  card.appendChild(say);
  return card;
}

/* Repaint only the numbers, so server counts land without a second fetch and
   without the rows losing focus or their place in the tab order. */
function repaintCounts(container, counts, given) {
  var rows = container.querySelectorAll('.pg-run');
  for (var i = 0; i < rows.length; i++) {
    var btn = rows[i].querySelector('.pg-tally');
    if (!btn || btn.disabled) continue;
    var key = btn.getAttribute('data-run');
    if (!key || counts[key] == null) continue;
    paintKudos(btn, counts[key], !!given[key]);
  }
}

/* ---------------- render ---------------- */

function countTrained(reg, state) {
  var S = globalThis.Store;
  var ids = Object.keys(reg);
  var n = 0;
  for (var i = 0; i < ids.length; i++) {
    if (S.aggregate(state, ids[i], reg[ids[i]].direction).attempts > 0) n++;
  }
  return n;
}

function readCache() {
  try {
    var raw = localStorage.getItem('cortex.cache.data');
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

export async function render(container, ctx) {
  if (!container) return;
  ctx = ctx || {};
  injectStyles();

  var reg = drillRegistry();
  var now = Date.now();

  var paint = function (data) {
    var S = globalThis.Store;
    var state = toState(data, ctx.profile, readStore());
    var runs = ((data && data.runs) || []).filter(function (r) {
      return (r.drill_id || r.drillId) && isFinite(Number(r.value));
    });

    /* Own kudos rows are the reload-safe source of what this account already gave,
       unioned with the stored tally so a cache paint is never empty-handed. */
    var given = {};
    var stored = readStore();
    var storedIds = (stored && Array.isArray(stored.kudosGiven)) ? stored.kudosGiven : [];
    for (var g = 0; g < storedIds.length; g++) {
      if (typeof storedIds[g] === 'string') given[storedIds[g]] = true;
    }
    var rows = (data && data.kudos) || [];
    for (var k = 0; k < rows.length; k++) {
      var rid = rows[k] && (rows[k].run_client_id || rows[k].runClientId);
      if (typeof rid === 'string') given[rid] = true;
    }
    state.kudosGiven = Object.keys(given);
    if (rows.length) saveGiven(given);

    container.textContent = "";

    var root = h('div', 'pg');

    /* The topbar already names the view and gives its one-line summary, so the
       view does not repeat either on screen. The heading stays in the tree as a
       screen-reader-only landmark, which is also what the router focuses after a
       nav change. */
    var title = h('h2', 'view-title sr', 'Progress');
    title.tabIndex = -1;
    root.appendChild(title);

    /* Quiet readout strip, then the loud content below it. */
    var base = S.baselineIndex(state, dirMap(reg));
    var cells = [
      ['Sessions', state.sessions.length, 'completed'],
      ['Runs', state.records.length, 'logged'],
      ['Drills', countTrained(reg, state), 'of ' + Object.keys(reg).length + ' trained'],
      ['Longest run', S.longestStreak(state), 'days, best run'],
      ['Baseline', base, base == null ? 'needs three drills with history' : 'own best against own average']
    ];
    var read = h('div', 'pg-read');
    for (var c = 0; c < cells.length; c++) {
      var cell = h('div', 'nb-readout-cell pg-read-cell');
      cell.appendChild(h('span', 'pg-read-l', cells[c][0]));
      var v = h('span', 'nb-readout pg-read-v');
      if (typeof cells[c][1] === 'number') {
        if (ctx.motion && typeof ctx.motion.countUp === 'function') {
          ctx.motion.countUp(v, cells[c][1], { duration: 400 });
        } else {
          v.textContent = String(cells[c][1]);
        }
      } else {
        v.textContent = '--';
      }
      cell.appendChild(v);
      cell.appendChild(h('span', 'pg-read-c', cells[c][2]));
      read.appendChild(cell);
    }
    root.appendChild(read);

    /* Two content-sized cards share the top row: the habit grid and the per-drill
       bests. The record moments and the runs then run the full width below them,
       so nothing short is left sitting beside something tall. With nothing
       trained the bests card is a one line strip, and a strip beside the tall
       habit grid would leave a hole, so it drops to the full width row below. */
    var bests = buildBests(reg, state, ctx);
    var strip = bests.classList.contains('pg-strip');
    var top = h('div', 'pg-top' + (strip ? ' pg-top-solo' : ''));
    top.appendChild(buildHeatmap(state, now));
    if (!strip) top.appendChild(bests);
    root.appendChild(top);
    if (strip) root.appendChild(bests);

    root.appendChild(buildRecords(reg, state, now));

    var counts = {};
    root.appendChild(renderRuns(ctx, reg, runs, given, counts, now));
    root.appendChild(h('p', 'pg-foot',
      'Kudos are a mark of recognition on a run you can see. They carry no score and change nothing you train.'));

    container.appendChild(root);

    if (ctx.db && typeof ctx.db.kudosCounts === 'function') {
      var ids = runs.map(function (r) { return r.client_id || r.clientId; })
        .filter(function (x) { return typeof x === 'string'; });
      if (!ids.length) return;
      Promise.resolve(ctx.db.kudosCounts(ids)).then(function (res) {
        if (!container.isConnected || !res || res.ok === false || !res.data) return;
        for (var key in res.data) {
          if (Object.prototype.hasOwnProperty.call(res.data, key)) counts[key] = res.data[key];
        }
        repaintCounts(container, counts, given);
      }).catch(function () { /* counts stay where they are, the notches still tap */ });
    }
  };

  paint(readCache());

  if (ctx.db && typeof ctx.db.loadUserData === 'function') {
    try {
      var res = await ctx.db.loadUserData();
      if (container.isConnected && res && res.ok && res.data) paint(res.data);
    } catch (e) { /* keep the cached paint */ }
  }
}
