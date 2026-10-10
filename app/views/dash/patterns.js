/* app/views/dash/patterns.js
   Dashboard section: the milestones that date your history, the weekday you
   train most, the time of day your scores are best, and your rest days.

   build(ctx, data) returns one section node. Every number is derived from the
   sessions and runs the dashboard normalizer hands in. Text is set with
   textContent. Scoped CSS only, theme tokens only. No paint on import. */

import {
  h, drillRegistry, metaFor, toState, readStore, localDate, msOf, dateLabel
} from '../dashboard.js';

var STYLE_ID = 'nb-patterns-styles';
var DAY = 86400000;
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var WD_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
var WD_INIT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
var BANDS = ['Morning', 'Afternoon', 'Evening', 'Night'];
var STRIP_DAYS = 14;

/* ---------------- small date helpers ---------------- */

function startOfDay(ms) {
  var d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/* Local date keys of every day with a session, oldest first. */
function trainedDays(state) {
  var set = {};
  var ss = state.sessions || [];
  for (var i = 0; i < ss.length; i++) set[localDate(msOf(ss[i]))] = 1;
  return Object.keys(set).sort();
}

/* A date range in words, sharing the month or the year where it can. */
function rangeLabel(aMs, bMs) {
  var a = new Date(aMs), b = new Date(bMs);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return '';
  var am = MONTHS[a.getMonth()], bm = MONTHS[b.getMonth()];
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return a.getDate() + ' to ' + b.getDate() + ' ' + am + ' ' + a.getFullYear();
  }
  if (a.getFullYear() === b.getFullYear()) {
    return a.getDate() + ' ' + am + ' to ' + b.getDate() + ' ' + bm + ' ' + a.getFullYear();
  }
  return dateLabel(a.getTime()) + ' to ' + dateLabel(b.getTime());
}

/* ---------------- scoped styles (theme tokens only) ---------------- */

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  var s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = [
    '.pt{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:14px;display:flex;flex-direction:column;gap:var(--gap-3);min-width:0}',
    '.pt-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}',
    '.pt-head h2{margin:0;font-size:16px;font-weight:600;letter-spacing:-.01em}',
    '.pt-cap{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}',
    '.pt-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--gap-3);min-width:0}',
    '.pt-card{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:11px 12px;display:flex;flex-direction:column;gap:9px;min-width:0}',
    '.pt-card h3{margin:0;font-size:13px;font-weight:600}',
    '.pt-empty{margin:0;font-size:12.5px;color:var(--muted);line-height:1.45}',

    /* milestones */
    '.pt-ms{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}',
    '.pt-msrow{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);min-width:0}',
    '.pt-msrow:last-child{border-bottom:0}',
    '.pt-msmark{font-family:var(--mono);font-size:10px;color:var(--dim);letter-spacing:.06em}',
    '.pt-msmain{display:flex;flex-direction:column;gap:1px;min-width:0}',
    '.pt-msname{font-size:13px;font-weight:600}',
    '.pt-mssub{font-size:11.5px;color:var(--muted);overflow-wrap:anywhere}',
    '.pt-msval{font-family:var(--mono);font-size:11.5px;color:var(--ink);white-space:nowrap}',

    /* steadiest weekday */
    '.pt-wdname{margin:0;font-size:15px;font-weight:600}',
    '.pt-wdsub{margin:0;font-size:11.5px;color:var(--dim)}',
    '.pt-wdbars{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;height:66px;border-bottom:1px solid var(--line);padding-bottom:1px}',
    '.pt-wdcol{display:flex;flex-direction:column;gap:5px;height:100%;min-width:0}',
    '.pt-wdbarwrap{flex:1;display:flex;align-items:flex-end}',
    '.pt-wdbar{width:100%;border-radius:4px;background:var(--line2)}',
    '.pt-wdcol.best .pt-wdbar{background:var(--lime)}',
    '.pt-wdlab{font-family:var(--mono);font-size:10px;color:var(--dim);text-align:center}',

    /* time of day */
    '.pt-todlead{margin:0;font-size:13px;color:var(--ink)}',
    '.pt-todlead b{font-weight:600;color:var(--lime)}',
    '.pt-tod{display:flex;flex-direction:column;gap:7px}',
    '.pt-todrow{display:grid;grid-template-columns:66px minmax(0,1fr) 30px;gap:9px;align-items:center;min-width:0}',
    '.pt-todlab{font-size:12px;color:var(--muted)}',
    '.pt-todtrack{height:7px;border-radius:4px;background:var(--line);overflow:hidden}',
    '.pt-todfill{display:block;height:100%;background:var(--line2);border-radius:4px}',
    '.pt-todrow.best .pt-todfill{background:var(--lime)}',
    '.pt-todrow.best .pt-todlab{color:var(--ink)}',
    '.pt-todval{font-family:var(--mono);font-size:12px;color:var(--ink);text-align:right;font-variant-numeric:tabular-nums}',
    '.pt-todsub{margin:0;font-size:11px;color:var(--dim);line-height:1.4}',

    /* rest days */
    '.pt-restline{margin:0}',
    '.pt-restbig{font-family:var(--mono);font-size:24px;color:var(--ink);font-variant-numeric:tabular-nums}',
    '.pt-restlab{font-size:12px;color:var(--muted);margin-left:6px}',
    '.pt-restwhen{margin:0;font-size:11.5px;color:var(--dim)}',
    '.pt-reststrip{display:grid;grid-template-columns:repeat(' + STRIP_DAYS + ',minmax(0,1fr));gap:3px}',
    '.pt-restcell{aspect-ratio:1;border-radius:3px;border:1px solid var(--line);background:var(--lime-soft)}',
    '.pt-restcell.off{background:transparent}',
    '.pt-restcell.today{box-shadow:inset 0 0 0 1px var(--muted)}',
    '.pt-restsub{margin:0;font-size:11px;color:var(--dim);line-height:1.4}',

    '@media(max-width:900px){.pt-grid{grid-template-columns:minmax(0,1fr)}}',
    '@media(max-width:560px){.pt{padding:12px}.pt-todrow{grid-template-columns:58px minmax(0,1fr) 28px;gap:8px}}'
  ].join('');
  document.head.appendChild(s);
}

/* ---------------- blocks ---------------- */

function buildMilestones(state, reg) {
  var card = h('div', 'pt-card');
  card.appendChild(h('h3', null, 'Milestones'));

  var ss = state.sessions || [];
  if (!ss.length) {
    card.appendChild(h('p', 'pt-empty',
      'No sessions yet. Your first one becomes a milestone here.'));
    return card;
  }

  var list = h('ul', 'pt-ms');
  var mark = 0;
  function addRow(name, sub, val) {
    mark++;
    var li = h('li', 'pt-msrow');
    li.appendChild(h('span', 'pt-msmark', (mark < 10 ? '0' : '') + mark));
    var main = h('div', 'pt-msmain');
    main.appendChild(h('span', 'pt-msname', name));
    main.appendChild(h('span', 'pt-mssub', sub));
    li.appendChild(main);
    li.appendChild(h('span', 'pt-msval', val));
    list.appendChild(li);
  }

  /* first session */
  var first = ss[0];
  var firstDrills = [];
  var fd = first.drills || [];
  for (var i = 0; i < fd.length; i++) {
    var nm = metaFor(reg, fd[i]).name;
    if (nm) firstDrills.push(nm);
  }
  addRow('First session',
    dateLabel(msOf(first)),
    firstDrills.length ? 'Started with ' + firstDrills.join(', ') : 'The day it began');

  /* longest run: the longest stretch of consecutive days with a session */
  var days = trainedDays(state);
  var bestLen = 1, bestStart = days[0], bestEnd = days[0];
  var runLen = 1, runStart = days[0];
  for (i = 1; i < days.length; i++) {
    var gap = Math.round((Date.parse(days[i] + 'T00:00:00') - Date.parse(days[i - 1] + 'T00:00:00')) / DAY);
    if (gap === 1) runLen++;
    else { runLen = 1; runStart = days[i]; }
    if (runLen > bestLen) { bestLen = runLen; bestStart = runStart; bestEnd = days[i]; }
  }
  var runSub = bestLen > 1
    ? rangeLabel(Date.parse(bestStart + 'T00:00:00'), Date.parse(bestEnd + 'T00:00:00'))
    : dateLabel(Date.parse(bestStart + 'T00:00:00'));
  addRow('Longest run', runSub, bestLen + (bestLen === 1 ? ' day' : ' days'));

  /* total sessions */
  addRow('Total sessions', 'All time', String(ss.length));

  /* best day */
  var counts = {};
  for (i = 0; i < ss.length; i++) {
    var k = localDate(msOf(ss[i]));
    counts[k] = (counts[k] || 0) + 1;
  }
  var bestKey = null, bestN = 0;
  var keys = Object.keys(counts);
  for (i = 0; i < keys.length; i++) {
    if (counts[keys[i]] > bestN) { bestN = counts[keys[i]]; bestKey = keys[i]; }
  }
  addRow('Best day', dateLabel(Date.parse(bestKey + 'T00:00:00')),
    bestN + (bestN === 1 ? ' session' : ' sessions'));

  card.appendChild(list);
  return card;
}

function buildWeekday(state) {
  var card = h('div', 'pt-card');
  card.appendChild(h('h3', null, 'Steadiest weekday'));

  var ss = state.sessions || [];
  if (!ss.length) {
    card.appendChild(h('p', 'pt-empty', 'No sessions yet.'));
    return card;
  }

  var counts = [0, 0, 0, 0, 0, 0, 0];   /* Monday first */
  for (var i = 0; i < ss.length; i++) {
    var d = new Date(msOf(ss[i]));
    counts[(d.getDay() + 6) % 7]++;
  }
  var max = 0, best = 0;
  for (i = 0; i < 7; i++) {
    if (counts[i] > max) { max = counts[i]; best = i; }
  }

  card.appendChild(h('p', 'pt-wdname', WD_FULL[best]));
  card.appendChild(h('p', 'pt-wdsub', 'Sessions by weekday, all time.'));

  var bars = h('div', 'pt-wdbars');
  bars.setAttribute('role', 'img');
  var parts = [];
  for (i = 0; i < 7; i++) parts.push(WD_FULL[i] + ' ' + counts[i]);
  bars.setAttribute('aria-label', 'Sessions by weekday. ' + parts.join(', ') + '.');
  for (i = 0; i < 7; i++) {
    var col = h('div', 'pt-wdcol' + (i === best ? ' best' : ''));
    var wrap = h('div', 'pt-wdbarwrap');
    var bar = h('i', 'pt-wdbar');
    bar.style.height = counts[i] ? Math.max(10, Math.round((counts[i] / max) * 100)) + '%' : '0';
    wrap.appendChild(bar);
    col.appendChild(wrap);
    col.appendChild(h('span', 'pt-wdlab', WD_INIT[i]));
    bars.appendChild(col);
  }
  card.appendChild(bars);
  return card;
}

function buildTimeOfDay(state, reg) {
  var card = h('div', 'pt-card');
  card.appendChild(h('h3', null, 'Score by time of day'));

  var rs = state.records || [];
  if (!rs.length) {
    card.appendChild(h('p', 'pt-empty', 'No runs yet.'));
    return card;
  }

  var best = {};
  for (var i = 0; i < rs.length; i++) {
    var id = rs[i].drillId;
    if (!id) continue;
    var dir = metaFor(reg, id).direction;
    if (!(id in best)) best[id] = rs[i].value;
    else if (dir === 'lower' ? rs[i].value < best[id] : rs[i].value > best[id]) best[id] = rs[i].value;
  }

  var sums = [0, 0, 0, 0], ns = [0, 0, 0, 0];
  for (i = 0; i < rs.length; i++) {
    var rid = rs[i].drillId;
    var b = best[rid];
    if (!b) continue;
    var dir2 = metaFor(reg, rid).direction;
    var idx = dir2 === 'lower' ? (b / rs[i].value) : (rs[i].value / b);
    if (!isFinite(idx) || idx < 0) continue;
    if (idx > 1) idx = 1;
    var hh = new Date(rs[i].t).getHours();
    var bi = (hh >= 5 && hh < 12) ? 0 : (hh >= 12 && hh < 17) ? 1 : (hh >= 17 && hh < 22) ? 2 : 3;
    sums[bi] += idx;
    ns[bi]++;
  }

  var avg = [null, null, null, null];
  for (i = 0; i < 4; i++) if (ns[i]) avg[i] = Math.round((sums[i] / ns[i]) * 100);

  var present = [];
  for (i = 0; i < 4; i++) if (avg[i] != null) present.push(i);
  if (present.length < 2) {
    card.appendChild(h('p', 'pt-empty', 'Not enough runs across the day to compare yet.'));
    return card;
  }

  var bestBand = present[0];
  for (i = 1; i < present.length; i++) {
    if (avg[present[i]] > avg[bestBand]) bestBand = present[i];
  }
  var top = avg[bestBand];
  var tied = present.filter(function (b) { return avg[b] === top; });

  var lead = h('p', 'pt-todlead');
  if (tied.length === 1) {
    lead.appendChild(document.createTextNode('Your best scores land in the '));
    lead.appendChild(h('b', null, BANDS[bestBand].toLowerCase()));
    lead.appendChild(document.createTextNode('.'));
  } else {
    lead.appendChild(document.createTextNode('Your scores are about level across the day.'));
  }
  card.appendChild(lead);

  var rows = h('div', 'pt-tod');
  for (i = 0; i < 4; i++) {
    if (avg[i] == null) continue;
    var row = h('div', 'pt-todrow' + (avg[i] === top ? ' best' : ''));
    row.setAttribute('aria-label', BANDS[i] + ', average score ' + avg[i]);
    row.appendChild(h('span', 'pt-todlab', BANDS[i]));
    var track = h('span', 'pt-todtrack');
    track.setAttribute('aria-hidden', 'true');
    var fill = h('i', 'pt-todfill');
    fill.style.width = avg[i] + '%';
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(h('span', 'pt-todval', String(avg[i])));
    rows.appendChild(row);
  }
  card.appendChild(rows);
  card.appendChild(h('p', 'pt-todsub',
    'Each run is indexed to your best run in that drill, then averaged per band.'));
  return card;
}

function buildRest(state, now) {
  var card = h('div', 'pt-card');
  card.appendChild(h('h3', null, 'Rest days'));

  var days = trainedDays(state);
  if (!days.length) {
    card.appendChild(h('p', 'pt-empty', 'No sessions yet.'));
    return card;
  }

  var bestGap = 0, gapA = 0, gapB = 0;
  for (var i = 1; i < days.length; i++) {
    var a = Date.parse(days[i - 1] + 'T00:00:00');
    var b = Date.parse(days[i] + 'T00:00:00');
    var gap = Math.round((b - a) / DAY) - 1;
    if (gap > bestGap) { bestGap = gap; gapA = a; gapB = b; }
  }

  if (bestGap > 0) {
    var line = h('p', 'pt-restline');
    line.appendChild(h('span', 'pt-restbig', bestGap + (bestGap === 1 ? ' day' : ' days')));
    line.appendChild(document.createTextNode(' '));
    line.appendChild(h('span', 'pt-restlab', 'longest break'));
    card.appendChild(line);
    card.appendChild(h('p', 'pt-restwhen', rangeLabel(gapA + DAY, gapB - DAY)));
  } else {
    card.appendChild(h('p', 'pt-empty',
      'No break yet. Every day since your first session has a session.'));
  }

  var trained = {};
  for (i = 0; i < days.length; i++) trained[days[i]] = 1;
  var today = startOfDay(now);
  var strip = h('div', 'pt-reststrip');
  strip.setAttribute('role', 'img');
  strip.setAttribute('aria-label', 'Last ' + STRIP_DAYS + ' days. Filled days had a session.');
  for (var k = STRIP_DAYS - 1; k >= 0; k--) {
    var key = localDate(today - k * DAY);
    strip.appendChild(h('span', 'pt-restcell' + (trained[key] ? '' : ' off') + (k === 0 ? ' today' : '')));
  }
  card.appendChild(strip);
  card.appendChild(h('p', 'pt-restsub',
    'Last ' + STRIP_DAYS + ' days. Filled days had a session, hollow days did not.'));
  return card;
}

/* ---------------- render ---------------- */

export function build(ctx, data) {
  injectStyles();
  ctx = ctx || {};
  data = data || {};

  var profile = data.profile || ctx.profile || {};
  var now = (typeof data.now === 'number' && isFinite(data.now)) ? data.now : Date.now();
  var reg = drillRegistry();
  var state = toState(data, profile, readStore());

  var section = h('section', 'pt');
  section.setAttribute('aria-label', 'Patterns');

  var head = h('div', 'pt-head');
  head.appendChild(h('h2', null, 'Patterns'));
  head.appendChild(h('span', 'pt-cap', 'when you train'));
  section.appendChild(head);

  var grid = h('div', 'pt-grid');
  grid.appendChild(buildMilestones(state, reg));
  grid.appendChild(buildWeekday(state));
  grid.appendChild(buildTimeOfDay(state, reg));
  grid.appendChild(buildRest(state, now));
  section.appendChild(grid);

  return section;
}
