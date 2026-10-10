/* Neuralbase view: Stats.
   Reads the same cache and cloud rows the app already saves (cortex.cache.data
   then ctx.db.loadUserData) and draws a plain, typographic stats page: totals, a
   per-drill table, a chart of one drill's results over time, and the most recent
   runs. Every number comes from the stored rows. No cards, no shadows, hairline
   rules only, tabular figures for every number. */

var CACHE_KEY = 'cortex.cache.data';
var DAY = 86400000;
var TREND_DAYS = 14;
var RECENT_LIMIT = 10;
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

var ctxRef = null;

function h(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function svgEl(tag, attrs) {
  var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) {
    for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
    }
  }
  return n;
}

function clear(node) { if (node) node.replaceChildren(); }
function round2(x) { return Math.round(x * 100) / 100; }
function mean(rs) {
  var s = 0;
  for (var i = 0; i < rs.length; i++) s += rs[i].value;
  return rs.length ? s / rs.length : 0;
}

/* ---------- data ---------- */

function readCache() {
  try { var raw = localStorage.getItem(CACHE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}

/* The cache and the cloud both carry the cloud row shape (drill_id, created_at).
   Normalise to the store's record shape so the store helpers apply unchanged. */
function normRun(r) {
  return {
    drillId: r.drill_id || r.drillId,
    value: Number(r.value),
    unit: r.unit || '',
    t: typeof r.t === 'number' ? r.t : (Date.parse(r.created_at || '') || 0)
  };
}
function normSession(s) {
  return {
    t: typeof s.t === 'number' ? s.t : (Date.parse(s.created_at || '') || 0),
    drills: (s.drills || []).slice()
  };
}

function toState(data) {
  var Store = globalThis.Store;
  var records = ((data && data.runs) || []).map(normRun).filter(function (r) { return r.drillId && isFinite(r.value); });
  var sessions = ((data && data.sessions) || []).map(normSession);
  var days = [], seen = {};
  for (var i = 0; i < sessions.length; i++) {
    if (!sessions[i].t) continue;
    var k = Store && Store.iso ? Store.iso(new Date(sessions[i].t)) : '';
    if (k && !seen[k]) { seen[k] = 1; days.push(k); }
  }
  return { records: records, sessions: sessions, days: days };
}

function drillList() { return (globalThis.Content && globalThis.Content.DRILLS) || []; }
function drillById(id) {
  var D = drillList();
  for (var i = 0; i < D.length; i++) if (D[i].id === id) return D[i];
  return { id: id, name: id, direction: 'higher', unit: '' };
}
function directionOf(id) {
  var D = drillList();
  for (var i = 0; i < D.length; i++) if (D[i].id === id) return D[i].direction === 'lower' ? 'lower' : 'higher';
  return 'higher';
}
function runsFor(records, drillId) {
  return records.filter(function (r) { return r.drillId === drillId; });
}

function buildModel(data, now) {
  var state = toState(data);
  var records = state.records;
  var trained = {};
  for (var i = 0; i < records.length; i++) trained[records[i].drillId] = 1;
  return {
    state: state,
    records: records,
    sessions: state.sessions,
    now: now || Date.now(),
    trainedCount: Object.keys(trained).length
  };
}

/* ---------- formatting ---------- */

function fmtNum(v) {
  if (v == null || !isFinite(v)) return '';
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
  return String(Math.round(v * 10) / 10);
}
function dateLabel(ms) {
  var d = new Date(ms);
  return MONTHS[d.getMonth()] + ' ' + d.getDate();
}
function relTime(t, now) {
  if (!t) return 'unknown time';
  var d = now - t;
  if (d < 45000) return 'just now';
  var m = Math.floor(d / 60000);
  if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
  var hrs = Math.floor(d / 3600000);
  if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
  var days = Math.floor(d / DAY);
  if (days < 30) return days + (days === 1 ? ' day ago' : ' days ago');
  var mo = Math.floor(days / 30);
  return mo + (mo === 1 ? ' month ago' : ' months ago');
}

/* ---------- derivations ---------- */

/* Direction of travel over the last two weeks. The recent window is split into
   an older half and a newer half; the newer mean is read against the older one,
   respecting whether the drill scores lower or higher as better. Null means the
   window holds fewer than two runs, so nothing can be said. */
export function trendOf(records, drillId, direction, now) {
  var nowT = now == null ? Date.now() : now;
  var cut = nowT - TREND_DAYS * DAY;
  var rs = records.filter(function (r) { return r.drillId === drillId && r.t >= cut; })
    .sort(function (a, b) { return a.t - b.t; });
  if (rs.length < 2) return null;
  var mid = Math.floor(rs.length / 2);
  var older = rs.slice(0, mid), newer = rs.slice(mid);
  if (!older.length || !newer.length) return null;
  var a = mean(older), b = mean(newer);
  if (Math.abs(b - a) < 1e-9) return 'steady';
  var lower = direction === 'lower';
  return (lower ? b < a : b > a) ? 'improving' : 'declining';
}

function trendText(records, drillId, direction, now) {
  var cut = now - TREND_DAYS * DAY;
  var recent = 0;
  for (var i = 0; i < records.length; i++) {
    if (records[i].drillId === drillId && records[i].t >= cut) recent++;
  }
  if (!recent) return 'No recent runs';
  var t = trendOf(records, drillId, direction, now);
  if (t === null) return 'Not enough data';
  return t === 'improving' ? 'Improving' : t === 'declining' ? 'Declining' : 'Steady';
}

/* Points for one drill's results, in an SVG box of w by h with pad around it.
   X is real time across the span, so gaps show as gaps. Null when there are no
   runs, so the caller can say so plainly rather than draw an empty box. */
export function buildChart(runs, w, h, pad) {
  w = w || 640; h = h || 200; pad = pad == null ? 30 : pad;
  var rs = runs.slice().sort(function (a, b) { return a.t - b.t; });
  if (!rs.length) return null;
  var tmin = rs[0].t, tmax = rs[rs.length - 1].t;
  var vmin = rs[0].value, vmax = rs[0].value;
  for (var i = 1; i < rs.length; i++) {
    if (rs[i].value < vmin) vmin = rs[i].value;
    if (rs[i].value > vmax) vmax = rs[i].value;
  }
  var x0 = pad, x1 = w - pad, y0 = h - pad, y1 = pad;
  var spanT = tmax - tmin, spanV = vmax - vmin;
  function xOf(t) { return spanT ? x0 + (t - tmin) / spanT * (x1 - x0) : (x0 + x1) / 2; }
  function yOf(v) { return spanV ? y0 - (v - vmin) / spanV * (y0 - y1) : (y0 + y1) / 2; }
  var points = rs.map(function (r) { return { x: xOf(r.t), y: yOf(r.value), v: r.value, t: r.t }; });
  var d = points.map(function (p, i) { return (i ? 'L' : 'M') + round2(p.x) + ' ' + round2(p.y); }).join(' ');
  return { d: d, points: points, vmin: vmin, vmax: vmax, tmin: tmin, tmax: tmax, w: w, h: h, pad: pad };
}

/* ---------- styles ---------- */

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById('nb-stats-styles')) return;
  var s = document.createElement('style');
  s.id = 'nb-stats-styles';
  s.textContent = [
    '.st-view{display:flex;flex-direction:column;gap:var(--gap-6,32px);width:100%;max-width:none;margin-inline:0;flex:1 1 auto;min-height:0;justify-content:flex-start;padding-block:var(--gap-4,16px)}',
    '.st-section{display:flex;flex-direction:column;gap:var(--gap-3,12px)}',
    '.st-h{margin:0;font-family:var(--mono,ui-monospace,monospace);font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim,#5E6673);font-weight:500}',
    '.st-summary{display:flex;flex-wrap:wrap;gap:var(--gap-5,24px) var(--gap-6,32px)}',
    '.st-stat{display:flex;flex-direction:column;gap:2px;min-width:0}',
    '.st-stat-label{font-size:12px;color:var(--muted,#8B93A1)}',
    '.st-stat-value{font-family:var(--mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;font-size:26px;font-weight:600;line-height:1.1;color:var(--ink,#E7EAEF)}',
    '.st-stat-unit{font-size:13px;font-weight:500;color:var(--muted,#8B93A1);margin-left:5px}',
    '.st-table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}',
    '.st-table th{font-family:var(--mono,ui-monospace,monospace);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim,#5E6673);font-weight:500;text-align:right;padding:0 10px 8px;border-bottom:1px solid var(--line2,#343A45);white-space:nowrap}',
    '.st-table th:first-child{text-align:left}',
    '.st-table td{padding:10px;border-bottom:1px solid var(--line,#2A2F38);text-align:right;font-family:var(--mono,ui-monospace,monospace);color:var(--ink,#E7EAEF)}',
    '.st-table td:first-child{text-align:left;font-family:var(--sans,system-ui,sans-serif)}',
    '.st-name{color:var(--ink,#E7EAEF)}',
    '.st-unit{font-family:var(--mono,ui-monospace,monospace);font-size:11px;color:var(--dim,#5E6673);margin-left:7px}',
    '.st-none{color:var(--dim,#5E6673);font-family:var(--sans,system-ui,sans-serif)}',
    '.st-table td.st-none{text-align:left}',
    '.st-cell-label{display:none}',
    '.st-chart-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:var(--gap-2,8px) var(--gap-4,16px)}',
    '.st-chips{display:flex;flex-wrap:wrap;gap:2px 14px}',
    '.st-chip{background:none;border:0;padding:2px 0;font:inherit;font-size:13px;color:var(--muted,#8B93A1);cursor:pointer;transition:color .12s ease}',
    '.st-chip:hover{color:var(--ink,#E7EAEF)}',
    '.st-chip[aria-pressed="true"]{color:var(--lime,#B6E24A)}',
    '.st-chart-host{min-height:120px}',
    '.st-chart{display:block;width:100%;max-width:720px;height:auto;aspect-ratio:16/5;color:var(--muted,#8B93A1)}',
    '.st-chart .st-axis{stroke:var(--line2,#343A45);stroke-width:1}',
    '.st-chart .st-line{fill:none;stroke:var(--lime,#B6E24A);stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round}',
    '.st-chart .st-dot{fill:var(--lime,#B6E24A)}',
    '.st-chart .st-tick{fill:var(--dim,#5E6673);font-family:var(--mono,ui-monospace,monospace);font-size:10px}',
    '.st-recent{display:flex;flex-direction:column}',
    '.st-run{display:flex;align-items:baseline;justify-content:space-between;gap:var(--gap-3,12px);padding:9px 0;border-bottom:1px solid var(--line,#2A2F38)}',
    '.st-run-name{color:var(--ink,#E7EAEF);font-size:13px;min-width:0}',
    '.st-run-right{display:flex;align-items:baseline;gap:var(--gap-3,12px);flex:none}',
    '.st-run-val{font-family:var(--mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;font-size:13px;color:var(--ink,#E7EAEF);white-space:nowrap}',
    '.st-run-when{font-size:12px;color:var(--dim,#5E6673);white-space:nowrap}',
    '.st-empty{display:flex;flex-direction:column;gap:var(--gap-3,12px);max-width:52ch;color:var(--muted,#8B93A1)}',
    '.st-empty p{margin:0;font-size:14px;line-height:1.55}',
    '.st-empty .st-h{color:var(--dim,#5E6673)}',
    '.st-chip:focus-visible{outline:2px solid var(--accent,var(--lime,#B6E24A));outline-offset:2px;border-radius:4px}',
    '@media (max-width:600px){',
    '.st-table thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    '.st-table,.st-table tbody,.st-table tr,.st-table td{display:block;width:auto}',
    '.st-table tr{border-bottom:1px solid var(--line,#2A2F38);padding:10px 0}',
    '.st-table td{border:0;padding:2px 0;text-align:left;display:flex;justify-content:space-between;gap:12px;align-items:baseline}',
    '.st-table td:first-child{padding-bottom:7px}',
    '.st-table td.st-none{justify-content:flex-start}',
    '.st-cell-label{display:inline;color:var(--dim,#5E6673);font-family:var(--mono,ui-monospace,monospace);font-size:11px;letter-spacing:.06em;text-transform:uppercase}',
    '.st-summary{gap:var(--gap-4,16px) var(--gap-5,24px)}',
    '.st-stat-value{font-size:21px}',
    '}',
    '@media (prefers-reduced-motion:reduce){.st-chip{transition:none}}'
  ].join('');
  document.head.appendChild(s);
}

/* ---------- sections ---------- */

function statItem(metric, label, value, unit) {
  var box = h('div', 'st-stat');
  box.setAttribute('data-metric', metric);
  box.appendChild(h('span', 'st-stat-label', label));
  var val = h('span', 'st-stat-value', value);
  if (unit) val.appendChild(h('span', 'st-stat-unit', unit));
  box.appendChild(val);
  return box;
}

function buildSummarySection(model) {
  var Store = globalThis.Store;
  var state = model.state;
  var streak = Store && Store.streak ? Store.streak(state, new Date(model.now)) : 0;
  var longest = Store && Store.longestStreak ? Store.longestStreak(state) : 0;
  var section = h('div', 'st-section');
  section.appendChild(h('h2', 'st-h', 'Summary'));
  var strip = h('div', 'st-summary');
  strip.appendChild(statItem('runs', 'Runs', String(model.records.length)));
  strip.appendChild(statItem('sessions', 'Sessions', String(model.sessions.length)));
  strip.appendChild(statItem('streak', 'Current streak', String(streak), 'days'));
  strip.appendChild(statItem('longest', 'Longest streak', String(longest), 'days'));
  strip.appendChild(statItem('drills', 'Drills trained', String(model.trainedCount)));
  section.appendChild(strip);
  return section;
}

var COLS = ['Best', 'Last', 'Average', 'Runs', 'Trend'];

function cell(label, value) {
  var td = h('td');
  td.appendChild(h('span', 'st-cell-label', label));
  td.appendChild(h('span', 'st-cell-value', value));
  return td;
}

function buildTableSection(model) {
  var Store = globalThis.Store;
  var section = h('div', 'st-section');
  section.appendChild(h('h2', 'st-h', 'By drill'));
  var table = h('table', 'st-table');
  var thead = h('thead');
  var hr = h('tr');
  hr.appendChild(h('th', null, 'Drill'));
  for (var c = 0; c < COLS.length; c++) hr.appendChild(h('th', null, COLS[c]));
  thead.appendChild(hr);
  table.appendChild(thead);

  var tbody = h('tbody');
  var D = drillList();
  for (var i = 0; i < D.length; i++) {
    var d = D[i];
    var dir = directionOf(d.id);
    var tr = h('tr', 'st-row');
    tr.setAttribute('data-drill', d.id);

    var nameTd = h('td');
    nameTd.appendChild(h('span', 'st-name', d.name));
    if (d.unit) nameTd.appendChild(h('span', 'st-unit', d.unit));
    tr.appendChild(nameTd);

    var rs = runsFor(model.records, d.id);
    if (!rs.length) {
      var none = h('td', 'st-none', 'no runs yet');
      none.setAttribute('colspan', String(COLS.length));
      tr.appendChild(none);
    } else {
      var agg = Store.aggregate(model.state, d.id, dir);
      var sorted = rs.slice().sort(function (a, b) { return a.t - b.t; });
      var last = sorted[sorted.length - 1];
      tr.appendChild(cell('Best', fmtNum(agg.best)));
      tr.appendChild(cell('Last', fmtNum(last.value)));
      tr.appendChild(cell('Average', fmtNum(agg.avg)));
      tr.appendChild(cell('Runs', String(agg.attempts)));
      tr.appendChild(cell('Trend', trendText(model.records, d.id, dir, model.now)));
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  section.appendChild(table);
  return section;
}

function appendTick(svg, x, y, text, anchor) {
  var t = svgEl('text', { x: x, y: y, class: 'st-tick', 'text-anchor': anchor });
  t.textContent = text;
  svg.appendChild(t);
}

function chartInto(host, drill, records) {
  clear(host);
  var rs = runsFor(records, drill.id);
  if (!rs.length) {
    host.appendChild(h('p', 'st-none', 'No runs yet for this drill.'));
    return;
  }
  var c = buildChart(rs, 640, 200, 30);
  var svg = svgEl('svg', {
    viewBox: '0 0 ' + c.w + ' ' + c.h,
    preserveAspectRatio: 'xMidYMid meet',
    class: 'st-chart',
    role: 'img',
    'aria-label': drill.name + ' results over time'
  });
  svg.appendChild(svgEl('line', { x1: c.pad, y1: c.h - c.pad, x2: c.w - c.pad, y2: c.h - c.pad, class: 'st-axis' }));
  svg.appendChild(svgEl('line', { x1: c.pad, y1: c.pad, x2: c.pad, y2: c.h - c.pad, class: 'st-axis' }));
  appendTick(svg, c.pad - 6, c.pad + 4, fmtNum(c.vmax) + (drill.unit ? ' ' + drill.unit : ''), 'end');
  appendTick(svg, c.pad - 6, c.h - c.pad, fmtNum(c.vmin), 'end');
  appendTick(svg, c.pad, c.h - c.pad + 15, dateLabel(c.tmin), 'start');
  appendTick(svg, c.w - c.pad, c.h - c.pad + 15, dateLabel(c.tmax), 'end');
  svg.appendChild(svgEl('path', { d: c.d, class: 'st-line' }));
  for (var i = 0; i < c.points.length; i++) {
    svg.appendChild(svgEl('circle', { cx: round2(c.points[i].x), cy: round2(c.points[i].y), r: 2, class: 'st-dot' }));
  }
  host.appendChild(svg);
}

function buildChartSection(model) {
  var section = h('div', 'st-section');
  var head = h('div', 'st-chart-head');
  head.appendChild(h('h2', 'st-h', 'Results over time'));

  var counts = {};
  for (var i = 0; i < model.records.length; i++) {
    counts[model.records[i].drillId] = (counts[model.records[i].drillId] || 0) + 1;
  }
  var D = drillList();
  var selected = D.length ? D[0].id : null;
  var best = -1;
  for (var j = 0; j < D.length; j++) {
    var n = counts[D[j].id] || 0;
    if (n > best) { best = n; selected = D[j].id; }
  }

  var host = h('div', 'st-chart-host');
  var btns = {};
  function renderChart() {
    var d = drillById(selected);
    for (var id in btns) {
      if (Object.prototype.hasOwnProperty.call(btns, id)) btns[id].setAttribute('aria-pressed', id === selected ? 'true' : 'false');
    }
    chartInto(host, d, model.records);
  }

  var chips = h('div', 'st-chips');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'Choose a drill for the chart');
  D.forEach(function (d) {
    var b = h('button', 'st-chip', d.name);
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () { selected = d.id; renderChart(); });
    btns[d.id] = b;
    chips.appendChild(b);
  });
  head.appendChild(chips);

  section.appendChild(head);
  section.appendChild(host);
  renderChart();
  return section;
}

function buildRecentSection(model) {
  var section = h('div', 'st-section');
  section.appendChild(h('h2', 'st-h', 'Recent runs'));
  var rs = model.records.slice().sort(function (a, b) { return b.t - a.t; }).slice(0, RECENT_LIMIT);
  if (!rs.length) {
    section.appendChild(h('p', 'st-none', 'No runs yet.'));
    return section;
  }
  var list = h('div', 'st-recent');
  rs.forEach(function (r) {
    var d = drillById(r.drillId);
    var row = h('div', 'st-run');
    row.appendChild(h('span', 'st-run-name', d.name));
    var right = h('span', 'st-run-right');
    var unit = r.unit || d.unit || '';
    right.appendChild(h('span', 'st-run-val', fmtNum(r.value) + (unit ? ' ' + unit : '')));
    right.appendChild(h('span', 'st-run-when', relTime(r.t, model.now)));
    row.appendChild(right);
    list.appendChild(row);
  });
  section.appendChild(list);
  return section;
}

function buildEmpty(ctx) {
  var wrap = h('div', 'st-empty');
  wrap.appendChild(h('h2', 'st-h', 'Stats'));
  wrap.appendChild(h('p', null, 'Nothing to show yet. As you complete drills, your totals, a per-drill table, and a chart of results over time will appear here.'));
  var actions = h('div', 'row-actions');
  var go = h('button', 'btn-primary', 'Go to drills');
  go.type = 'button';
  go.addEventListener('click', function () { if (ctxRef && ctxRef.navigate) ctxRef.navigate('train'); });
  actions.appendChild(go);
  wrap.appendChild(actions);
  return wrap;
}

/* ---------- render ---------- */

function paint(container, model, ctx) {
  clear(container);
  if (!model.records.length && !model.sessions.length) {
    container.appendChild(buildEmpty(ctx));
    return;
  }
  container.appendChild(buildSummarySection(model));
  container.appendChild(buildTableSection(model));
  container.appendChild(buildChartSection(model));
  container.appendChild(buildRecentSection(model));
}

export function render(container, ctx) {
  ctxRef = ctx || {};
  container.classList.add('view', 'view-mid-wide', 'st-view');
  container.setAttribute('aria-label', 'Stats');
  injectStyles();

  var cached = readCache() || { runs: [], sessions: [], cards: [] };
  paint(container, buildModel(cached), ctxRef);

  if (ctxRef.db && ctxRef.db.loadUserData) {
    ctxRef.db.loadUserData().then(function (res) {
      if (!container.isConnected) return;
      if (res && res.ok && res.data) paint(container, buildModel(res.data), ctxRef);
    }).catch(function () { /* keep the cached paint */ });
  }

  try { container.focus({ preventScroll: true }); } catch (e) { /* degrade */ }
}
