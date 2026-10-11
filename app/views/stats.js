/* Neuralbase view: Stats.
   Reads the same cache and cloud rows the app already saves (cortex.cache.data
   then ctx.db.loadUserData) and draws a plain, typographic stats page: a monthly
   activity calendar beside the totals, a chart of one drill's results over time,
   a per-drill breakdown, and the most recent runs grouped by day. Every number
   comes from the stored rows. No cards, no shadows, no gradients, hairline rules
   only, tabular figures for every number.

   The month grid follows the approach the earlier site used for its habit
   calendar: seven weekday columns, a cell per day shaded by how much was trained
   that day, a ring on today, and roving-tabindex arrow-key navigation. */

var CACHE_KEY = 'cortex.cache.data';
var DAY = 86400000;
var TREND_DAYS = 14;
var RECENT_LIMIT = 12;
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
var CAL_HEADS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* How the trend is measured. "run" is the original behaviour: every saved run is
   its own point. "day" folds a drill's runs on one calendar day into one point
   (their mean, placed at midday). "session" folds a drill's runs into the saved
   session they belong to. */
var MEASURE_MODES = [
  { id: 'run', label: 'By run' },
  { id: 'day', label: 'By day' },
  { id: 'session', label: 'By session' }
];
/* A run joins its nearest saved session only when that session is within this
   window. A run with no session near it stands alone rather than vanishing, so
   the chart never silently drops data. */
var SESSION_WINDOW = 4 * 3600000;

var ctxRef = null;
/* The month the calendar is showing. Kept across repaints, so a data refresh
   does not throw the reader back to the current month. */
var calMonth = null;

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
function pad2(n) { return (n < 10 ? '0' : '') + n; }

/* Local calendar day key, the same one the store uses for streaks and the
   heatmap, so the calendar and the totals never disagree about a day. */
function dayKeyOf(t) {
  var Store = globalThis.Store;
  if (Store && Store.iso) return Store.iso(new Date(t));
  var d = new Date(t);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
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

/* Runs per local day, with session-only days folded in at their own count, so a
   day trained without a saved run still shows up rather than reading as empty. */
function dayActivity(state, records) {
  var counts = {};
  for (var i = 0; i < records.length; i++) {
    var k = dayKeyOf(records[i].t);
    if (k) counts[k] = (counts[k] || 0) + 1;
  }
  var Store = globalThis.Store;
  var sess = Store && Store.dayCounts ? Store.dayCounts(state) : {};
  for (var key in sess) {
    if (Object.prototype.hasOwnProperty.call(sess, key) && !counts[key]) counts[key] = sess[key];
  }
  return counts;
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
function dayLabel(key, now) {
  if (key === dayKeyOf(now)) return 'Today';
  if (key === dayKeyOf(now - DAY)) return 'Yesterday';
  var d = new Date(key + 'T12:00:00');
  return MONTHS[d.getMonth()] + ' ' + d.getDate();
}
/* Clock time for a feed row, so a day header carries the date and the row the
   time. Plain 24 hour, zero padded. */
function clockOf(t) {
  var d = new Date(t);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

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
function trendKind(records, drillId, direction, now) {
  var t = trendOf(records, drillId, direction, now);
  return t === 'improving' || t === 'declining' || t === 'steady' ? t : 'none';
}

/* Points for one drill's results, in an SVG box of w by h with pad around it.
   X is real time across the span, so gaps show as gaps. Null when there are no
   runs, so the caller can say so plainly rather than draw an empty box.
   opts.padL / padR / padT / padB override the single pad per side, so the value
   gutter can be wider than the rest without moving the plot. */
export function buildChart(runs, w, h, pad, opts) {
  w = w || 640; h = h || 200; pad = pad == null ? 30 : pad;
  opts = opts || {};
  var padL = opts.padL == null ? pad : opts.padL;
  var padR = opts.padR == null ? pad : opts.padR;
  var padT = opts.padT == null ? pad : opts.padT;
  var padB = opts.padB == null ? pad : opts.padB;
  var rs = runs.slice().sort(function (a, b) { return a.t - b.t; });
  if (!rs.length) return null;
  var tmin = rs[0].t, tmax = rs[rs.length - 1].t;
  var vmin = rs[0].value, vmax = rs[0].value;
  for (var i = 1; i < rs.length; i++) {
    if (rs[i].value < vmin) vmin = rs[i].value;
    if (rs[i].value > vmax) vmax = rs[i].value;
  }
  var x0 = padL, x1 = w - padR, y0 = h - padB, y1 = padT;
  var spanT = tmax - tmin, spanV = vmax - vmin;
  function xOf(t) { return spanT ? x0 + (t - tmin) / spanT * (x1 - x0) : (x0 + x1) / 2; }
  function yOf(v) { return spanV ? y0 - (v - vmin) / spanV * (y0 - y1) : (y0 + y1) / 2; }
  var points = rs.map(function (r) {
    return { x: xOf(r.t), y: yOf(r.value), v: r.value, t: r.t, n: r.n || 1 };
  });
  var d = points.map(function (p, i) { return (i ? 'L' : 'M') + round2(p.x) + ' ' + round2(p.y); }).join(' ');
  return { d: d, points: points, vmin: vmin, vmax: vmax, tmin: tmin, tmax: tmax, w: w, h: h, pad: pad,
           padL: padL, padR: padR, padT: padT, padB: padB };
}

/* One drill's runs folded to the chosen measure. Returns [{value, t, n}] sorted
   by time. "run" is one point per run; "day" one point per calendar day (mean,
   at midday); "session" one point per saved session (mean of the runs that fall
   nearest it), with any run that has no session near it kept as its own point. */
export function aggregatePoints(runs, mode, sessions) {
  var rs = (runs || []).slice().sort(function (a, b) { return a.t - b.t; });
  if (mode !== 'day' && mode !== 'session') {
    return rs.map(function (r) { return { value: r.value, t: r.t, n: 1 }; });
  }
  if (mode === 'day') {
    var by = {};
    for (var i = 0; i < rs.length; i++) {
      var k = dayKeyOf(rs[i].t);
      (by[k] = by[k] || []).push(rs[i]);
    }
    return Object.keys(by).sort().map(function (key) {
      var list = by[key];
      return { value: mean(list), t: new Date(key + 'T12:00:00').getTime(), n: list.length };
    });
  }
  var ss = (sessions || []).filter(function (s) { return s && s.t; });
  var buckets = {}, orphans = [];
  for (var j = 0; j < rs.length; j++) {
    var r = rs[j], best = null, gap = Infinity;
    for (var m = 0; m < ss.length; m++) {
      var d = Math.abs(ss[m].t - r.t);
      if (d < gap) { gap = d; best = ss[m]; }
    }
    if (best && gap <= SESSION_WINDOW) (buckets[best.t] = buckets[best.t] || []).push(r);
    else orphans.push(r);
  }
  var out = [];
  Object.keys(buckets).forEach(function (key) {
    out.push({ value: mean(buckets[key]), t: Number(key), n: buckets[key].length });
  });
  for (var o = 0; o < orphans.length; o++) out.push({ value: orphans[o].value, t: orphans[o].t, n: 1 });
  out.sort(function (a, b) { return a.t - b.t; });
  return out;
}

/* ---------- styles ---------- */

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById('nb-stats-styles')) return;
  var s = document.createElement('style');
  s.id = 'nb-stats-styles';
  s.textContent = [
    '.st-view{display:flex;flex-direction:column;gap:var(--gap-6,32px);width:100%;max-width:1120px;margin-inline:auto;flex:1 1 auto;min-height:0;justify-content:flex-start;padding-block:20px 44px}',

    /* page head */
    '.st-head{display:flex;flex-direction:column;gap:6px;padding-bottom:var(--gap-4,16px);border-bottom:1px solid var(--line2)}',
    '.st-title{margin:0;font-size:24px;font-weight:600;letter-spacing:-.02em;color:var(--ink)}',
    '.st-sub{margin:0;font-size:13px;color:var(--muted)}',

    /* shared section language */
    '.st-section{display:flex;flex-direction:column;gap:var(--gap-3,12px)}',
    '.st-sec-head{display:flex;align-items:baseline;justify-content:space-between;gap:var(--gap-3,12px) var(--gap-4,16px);flex-wrap:wrap;padding-bottom:10px;border-bottom:1px solid var(--line)}',
    '.st-h{margin:0;font-family:var(--mono,ui-monospace,monospace);font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);font-weight:500}',
    '.st-sec-note{font-family:var(--mono,ui-monospace,monospace);font-size:11px;letter-spacing:.03em;color:var(--dim)}',

    /* top band: calendar beside the totals */
    '.st-top{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:var(--gap-6,32px);align-items:start}',

    /* totals */
    '.st-totals{display:flex;flex-direction:column}',
    '.st-stat{display:flex;align-items:baseline;justify-content:space-between;gap:var(--gap-3,12px);padding:13px 0;border-bottom:1px solid var(--line);min-width:0}',
    '.st-stat:first-child{border-top:1px solid var(--line2)}',
    '.st-stat-label{font-family:var(--mono,ui-monospace,monospace);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim)}',
    '.st-stat-value{font-family:var(--mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;font-size:30px;font-weight:600;line-height:1;color:var(--ink)}',
    '.st-stat-unit{font-size:13px;font-weight:500;color:var(--muted);margin-left:5px}',

    /* calendar */
    '.st-cal{display:flex;flex-direction:column;gap:var(--gap-3,12px);border:1px solid var(--line);border-radius:var(--r,8px);background:var(--panel);padding:var(--gap-4,16px);max-width:620px}',
    '.st-cal-top{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--gap-3,12px);flex-wrap:wrap}',
    '.st-cal-title{display:flex;flex-direction:column;gap:4px;min-width:0}',
    '.st-cal-month{margin:0;font-size:19px;font-weight:600;letter-spacing:-.015em;color:var(--ink)}',
    '.st-cal-sub{margin:0;font-family:var(--mono,ui-monospace,monospace);font-size:12px;color:var(--muted)}',
    '.st-cal-tools{display:flex;align-items:center;gap:6px}',
    '.st-cal-icon{width:30px;height:30px;flex:none;border:1px solid var(--line2);border-radius:var(--r,8px);background:transparent;color:var(--muted);display:grid;place-items:center;cursor:pointer;transition:border-color .12s ease,color .12s ease}',
    '.st-cal-icon:hover{border-color:var(--accent-edge,var(--lime-edge));color:var(--accent,var(--lime))}',
    '.st-cal-icon svg{width:15px;height:15px;display:block}',
    '.st-cal-chev{fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}',
    '.st-cal-today{border:1px solid var(--line2);background:transparent;color:var(--ink);border-radius:var(--r,8px);padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;transition:border-color .12s ease,color .12s ease}',
    '.st-cal-today:hover{border-color:var(--accent-edge,var(--lime-edge));color:var(--accent,var(--lime))}',
    '.st-cal-icon:focus-visible,.st-cal-today:focus-visible{outline:2px solid var(--accent,var(--lime));outline-offset:2px}',
    '.st-cal-wd{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}',
    '.st-cal-wd span{font-family:var(--mono,ui-monospace,monospace);font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--dim);text-align:center}',
    '.st-cal-wd .st-we{opacity:.55}',
    '.st-cal-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}',
    '.st-cal-cell{position:relative;height:36px;border:1px solid var(--line);border-radius:5px;background:var(--panel2);padding:4px 6px;display:flex;flex-direction:column;justify-content:space-between;min-width:0;overflow:hidden;transition:border-color .12s ease}',
    '.st-cal-cell:hover{border-color:var(--line2)}',
    '.st-cal-fill{position:absolute;inset:0;background:var(--accent,var(--lime));opacity:0;transition:opacity .12s ease}',
    '.st-cal-cell[data-level="1"] .st-cal-fill{opacity:.20}',
    '.st-cal-cell[data-level="2"] .st-cal-fill{opacity:.38}',
    '.st-cal-cell[data-level="3"] .st-cal-fill{opacity:.58}',
    '.st-cal-cell[data-level="4"] .st-cal-fill{opacity:.82}',
    '.st-cal-d{position:relative;font-family:var(--mono,ui-monospace,monospace);font-size:12px;font-weight:500;line-height:1;color:var(--muted);font-variant-numeric:tabular-nums}',
    '.st-cal-n{position:relative;align-self:flex-end;font-family:var(--mono,ui-monospace,monospace);font-size:12px;font-weight:600;line-height:1;color:var(--ink);font-variant-numeric:tabular-nums}',
    '.st-cal-cell[data-level="3"] .st-cal-d,.st-cal-cell[data-level="4"] .st-cal-d,.st-cal-cell[data-level="3"] .st-cal-n,.st-cal-cell[data-level="4"] .st-cal-n{color:var(--bg)}',
    '.st-cal-cell.st-adj{opacity:.4;background:transparent;border-style:dashed}',
    '.st-cal-cell.st-adj .st-cal-fill{display:none}',
    '.st-cal-cell.st-today{border-color:var(--accent,var(--lime))}',
    '.st-cal-cell.st-today .st-cal-d{color:var(--accent,var(--lime));font-weight:600}',
    '.st-cal-cell:focus-visible{outline:2px solid var(--accent,var(--lime));outline-offset:1px}',
    '.st-cal-foot{display:flex;align-items:center;justify-content:space-between;gap:var(--gap-3,12px);flex-wrap:wrap;border-top:1px solid var(--line);padding-top:11px}',
    '.st-cal-legend{display:flex;align-items:center;gap:5px}',
    '.st-cal-leg-label{font-family:var(--mono,ui-monospace,monospace);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim)}',
    '.st-cal-sw{position:relative;width:12px;height:12px;border-radius:3px;border:1px solid var(--line);background:var(--panel2);overflow:hidden}',
    '.st-cal-sw::after{content:"";position:absolute;inset:0;background:var(--accent,var(--lime));opacity:0}',
    '.st-cal-sw[data-level="1"]::after{opacity:.20}',
    '.st-cal-sw[data-level="2"]::after{opacity:.38}',
    '.st-cal-sw[data-level="3"]::after{opacity:.58}',
    '.st-cal-sw[data-level="4"]::after{opacity:.82}',
    '.st-cal-sum{font-family:var(--mono,ui-monospace,monospace);font-size:11px;letter-spacing:.02em;color:var(--muted)}',
    '.st-cal-sum b{color:var(--ink);font-weight:600}',
    '.st-cal-empty{margin:0;font-size:13px;line-height:1.5;color:var(--muted)}',

    /* chart */
    '.st-chips{display:flex;flex-wrap:wrap;gap:4px 16px}',
    '.st-chip{background:none;border:0;padding:2px 0;font:inherit;font-size:13px;color:var(--muted);cursor:pointer;transition:color .12s ease}',
    '.st-chip:hover{color:var(--ink)}',
    '.st-chip[aria-pressed="true"]{color:var(--accent,var(--lime))}',
    '.st-chip:focus-visible{outline:2px solid var(--accent,var(--lime));outline-offset:2px;border-radius:4px}',
    '.st-measure{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 14px}',
    '.st-measure-label{font-family:var(--mono,ui-monospace,monospace);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}',
    '.st-chart-host{position:relative;min-height:140px}',
    '.st-chart{display:block;width:100%;max-width:100%;height:auto;color:var(--muted)}',
    '.st-chart .st-grid{stroke:var(--line);stroke-width:1}',
    '.st-chart .st-axis{stroke:var(--line2);stroke-width:1}',
    '.st-chart .st-line{fill:none;stroke:var(--accent,var(--lime));stroke-width:1.75;stroke-linejoin:round;stroke-linecap:round}',
    '.st-chart .st-dot{fill:var(--accent,var(--lime))}',
    '.st-chart .st-hit{fill:transparent;stroke:none;cursor:pointer;outline:none}',
    '.st-chart .st-hit:focus-visible{fill:var(--accent-soft,rgba(184,224,74,.12));stroke:var(--accent,var(--lime));stroke-width:1.5}',
    '.st-chart .st-tick{fill:var(--dim);font-family:var(--mono,ui-monospace,monospace);font-size:10px}',
    '.st-chart .st-tick-val{fill:var(--muted)}',
    '.st-chart .st-axis-unit{fill:var(--dim);letter-spacing:.08em}',
    /* tooltip: plain panel, hairline border, no shadow */
    '.st-tip{position:absolute;z-index:3;display:none;flex-direction:column;gap:2px;padding:7px 9px;border:1px solid var(--line2);border-radius:var(--r,8px);background:var(--panel);pointer-events:none;transform:translate(-50%,calc(-100% - 12px));max-width:220px}',
    '.st-tip.is-on{display:flex}',
    '.st-tip.is-below{transform:translate(-50%,14px)}',
    '.st-tip-name{font-size:12px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.st-tip-val{font-family:var(--mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;font-size:13px;font-weight:600;color:var(--ink)}',
    '.st-tip-when{font-family:var(--mono,ui-monospace,monospace);font-size:11px;color:var(--dim);white-space:nowrap}',

    /* lower band: the table beside the recent list */
    '.st-cols{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:var(--gap-6,32px);align-items:start}',

    /* by drill: a boxed, gridded table so it reads as a data block */
    '.st-panel{border:1px solid var(--line);border-radius:var(--r,8px);background:var(--panel);padding:var(--gap-4,16px);gap:0}',
    '.st-panel .st-sec-head{padding-bottom:var(--gap-3,12px)}',
    '.st-table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums;margin-top:12px}',
    '.st-table th{font-family:var(--mono,ui-monospace,monospace);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);font-weight:500;text-align:right;padding:7px 12px;background:var(--panel2);border-bottom:1px solid var(--line2);white-space:nowrap}',
    '.st-table th:first-child{text-align:left;border-top-left-radius:5px;border-bottom-left-radius:5px}',
    '.st-table th:last-child{border-top-right-radius:5px;border-bottom-right-radius:5px}',
    '.st-table td{padding:11px 12px;border-bottom:1px solid var(--line);text-align:right;font-family:var(--mono,ui-monospace,monospace);color:var(--ink)}',
    '.st-table td:first-child{text-align:left;font-family:var(--sans,system-ui,sans-serif)}',
    '.st-table tbody tr:last-child td{border-bottom:0}',
    '.st-row:hover td{background:var(--hover,rgba(255,255,255,.04))}',
    '.st-name{color:var(--ink);font-weight:500}',
    '.st-unit{font-family:var(--mono,ui-monospace,monospace);font-size:11px;color:var(--dim);margin-left:7px}',
    '.st-none{color:var(--dim);font-family:var(--sans,system-ui,sans-serif)}',
    '.st-table td.st-none{text-align:left}',
    '.st-cell-label{display:none}',
    '.st-trend-v{display:inline-flex;align-items:center;gap:7px}',
    '.st-trend-dot{width:7px;height:7px;border-radius:50%;background:var(--dim);flex:none}',
    '.st-trend[data-trend="improving"]{color:var(--accent,var(--lime))}',
    '.st-trend[data-trend="improving"] .st-trend-dot{background:var(--accent,var(--lime))}',
    '.st-trend[data-trend="declining"]{color:var(--warn)}',
    '.st-trend[data-trend="declining"] .st-trend-dot{background:var(--warn)}',
    '.st-trend[data-trend="steady"]{color:var(--muted)}',
    '.st-trend[data-trend="steady"] .st-trend-dot{background:var(--line2)}',
    '.st-trend[data-trend="none"]{color:var(--dim)}',
    '.st-trend[data-trend="none"] .st-trend-dot{background:transparent;border:1px solid var(--line2)}',
    '.st-trend{font-family:var(--mono,ui-monospace,monospace);font-size:11px;letter-spacing:.03em}',

    /* recent runs: an open, chronological feed, deliberately unlike the table */
    '.st-feed{display:flex;flex-direction:column}',
    '.st-feed-list{display:flex;flex-direction:column}',
    '.st-feed-day{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-top:18px;padding-top:10px;border-top:1px solid var(--line2)}',
    '.st-feed .st-feed-day:first-child{margin-top:0;padding-top:0;border-top:0}',
    '.st-feed-day-label{font-family:var(--mono,ui-monospace,monospace);font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim)}',
    '.st-feed-day-n{font-family:var(--mono,ui-monospace,monospace);font-size:10px;letter-spacing:.03em;color:var(--dim)}',
    '.st-feed-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line)}',
    '.st-feed .st-feed-row:last-child{border-bottom:0}',
    '.st-feed-item{display:flex;flex-direction:column;gap:2px;min-width:0}',
    '.st-feed-name{color:var(--ink);font-size:13px;overflow-wrap:break-word}',
    '.st-feed-when{font-family:var(--mono,ui-monospace,monospace);font-size:11px;color:var(--dim)}',
    '.st-feed-val{font-family:var(--mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;font-size:16px;font-weight:600;color:var(--ink);white-space:nowrap}',

    /* empty state */
    '.st-empty{display:flex;flex-direction:column;gap:var(--gap-3,12px);max-width:52ch;color:var(--muted)}',
    '.st-empty p{margin:0;font-size:14px;line-height:1.55}',
    '.st-empty .st-h{color:var(--dim)}',

    /* one orchestrated entrance, staggered, never under reduced motion */
    '@media (prefers-reduced-motion:no-preference){',
    '.st-view>*{animation:st-rise .38s cubic-bezier(.3,.9,.3,1) both}',
    '.st-view>*:nth-child(2){animation-delay:.05s}',
    '.st-view>*:nth-child(3){animation-delay:.1s}',
    '.st-view>*:nth-child(4){animation-delay:.15s}',
    '.st-view>*:nth-child(5){animation-delay:.2s}',
    '@keyframes st-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
    '}',

    /* narrow screens */
    '@media (max-width:900px){.st-top,.st-cols{grid-template-columns:minmax(0,1fr)}}',
    '@media (max-width:600px){',
    '.st-view{gap:var(--gap-5,24px);padding-block:16px 32px}',
    '.st-title{font-size:21px}',
    '.st-stat-value{font-size:24px}',
    '.st-cal{padding:var(--gap-3,12px)}',
    '.st-cal-month{font-size:17px}',
    '.st-cal-cell{height:30px;padding:3px 4px}',
    '.st-cal-d{font-size:11px}',
    '.st-cal-n{font-size:11px}',
    '.st-panel{padding:var(--gap-3,12px)}',
    '.st-table thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    '.st-table,.st-table tbody,.st-table tr,.st-table td{display:block;width:auto}',
    '.st-table tr{border-bottom:1px solid var(--line);padding:11px 0}',
    '.st-table td{border:0;padding:2px 0;text-align:left;display:flex;justify-content:space-between;gap:12px;align-items:baseline}',
    '.st-table td:first-child{padding-bottom:7px}',
    '.st-table td.st-none{justify-content:flex-start}',
    '.st-cell-label{display:inline;color:var(--dim);font-family:var(--mono,ui-monospace,monospace);font-size:11px;letter-spacing:.06em;text-transform:uppercase}',
    '}',
    '@media (prefers-reduced-motion:reduce){.st-chip,.st-cal-icon,.st-cal-today,.st-cal-cell,.st-cal-fill{transition:none}}'
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

function buildHeader(model) {
  var head = h('header', 'st-head');
  head.appendChild(h('h1', 'st-title', 'Stats'));
  var earliest = 0;
  for (var i = 0; i < model.records.length; i++) {
    if (!earliest || model.records[i].t < earliest) earliest = model.records[i].t;
  }
  var bits = [plural(model.records.length, 'run', 'runs'), plural(model.trainedCount, 'drill', 'drills')];
  if (earliest) bits.push('since ' + dateLabel(earliest));
  head.appendChild(h('p', 'st-sub', bits.join('  ·  ')));
  return head;
}

function buildTotalsSection(model) {
  var Store = globalThis.Store;
  var state = model.state;
  var streak = Store && Store.streak ? Store.streak(state, new Date(model.now)) : 0;
  var longest = Store && Store.longestStreak ? Store.longestStreak(state) : 0;
  var activeDays = Object.keys(dayActivity(state, model.records)).length;
  var section = h('section', 'st-section');
  var head = h('div', 'st-sec-head');
  head.appendChild(h('h2', 'st-h', 'Totals'));
  section.appendChild(head);
  var list = h('div', 'st-totals');
  list.appendChild(statItem('runs', 'Runs', String(model.records.length)));
  list.appendChild(statItem('days', 'Days', String(activeDays)));
  list.appendChild(statItem('streak', 'Current streak', String(streak), 'days'));
  list.appendChild(statItem('longest', 'Longest streak', String(longest), 'days'));
  list.appendChild(statItem('drills', 'Drills trained', String(model.trainedCount)));
  section.appendChild(list);
  return section;
}

/* ---------- calendar ---------- */

function monthStart(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }

function chevron(kind) {
  var svg = svgEl('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' });
  var d = kind === 'prev' ? 'M10 3 L5 8 L10 13' : 'M6 3 L11 8 L6 13';
  svg.appendChild(svgEl('path', { d: d, class: 'st-cal-chev' }));
  return svg;
}

function buildCalendar(model) {
  var S = globalThis.Store;
  var counts = dayActivity(model.state, model.records);
  var now = new Date(model.now);
  var todayKey = dayKeyOf(model.now);
  var current = calMonth ? monthStart(calMonth) : monthStart(now);
  calMonth = current;
  var section = h('section', 'st-cal');

  function draw() {
    clear(section);
    var y = current.getFullYear(), mo = current.getMonth();
    var monthName = MONTHS_FULL[mo] + ' ' + y;
    section.setAttribute('aria-label', 'Activity calendar for ' + monthName);

    var daysInMonth = new Date(y, mo + 1, 0).getDate();
    var lead = (new Date(y, mo, 1).getDay() + 6) % 7;
    var prevDays = new Date(y, mo, 0).getDate();
    var totalCells = Math.ceil((lead + daysInMonth) / 7) * 7;

    var monthRuns = 0, activeDays = 0, bestDay = 0, maxN = 0, day;
    for (day = 1; day <= daysInMonth; day++) {
      var kn = counts[dayKeyOf(new Date(y, mo, day, 12).getTime())] || 0;
      monthRuns += kn;
      if (kn > 0) activeDays++;
      if (kn > bestDay) bestDay = kn;
      if (kn > maxN) maxN = kn;
    }

    var top = h('div', 'st-cal-top');
    var titleWrap = h('div', 'st-cal-title');
    titleWrap.appendChild(h('h2', 'st-cal-month', monthName));
    titleWrap.appendChild(h('p', 'st-cal-sub',
      plural(monthRuns, 'run', 'runs') + '  ·  ' + plural(activeDays, 'active day', 'active days')));
    top.appendChild(titleWrap);

    var tools = h('div', 'st-cal-tools');
    var prev = h('button', 'st-cal-icon');
    prev.type = 'button';
    prev.setAttribute('aria-label', 'Previous month');
    prev.appendChild(chevron('prev'));
    prev.addEventListener('click', function () { current = addMonths(current, -1); calMonth = current; draw(); });
    var todayBtn = h('button', 'st-cal-today', 'Today');
    todayBtn.type = 'button';
    todayBtn.addEventListener('click', function () { current = monthStart(new Date()); calMonth = current; draw(); });
    var next = h('button', 'st-cal-icon');
    next.type = 'button';
    next.setAttribute('aria-label', 'Next month');
    next.appendChild(chevron('next'));
    next.addEventListener('click', function () { current = addMonths(current, 1); calMonth = current; draw(); });
    tools.appendChild(prev);
    tools.appendChild(todayBtn);
    tools.appendChild(next);
    top.appendChild(tools);
    section.appendChild(top);

    var wd = h('div', 'st-cal-wd');
    wd.setAttribute('aria-hidden', 'true');
    for (var wi = 0; wi < CAL_HEADS.length; wi++) wd.appendChild(h('span', wi >= 5 ? 'st-we' : null, CAL_HEADS[wi]));
    section.appendChild(wd);

    var grid = h('div', 'st-cal-grid');
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', monthName + ', runs per day');
    var cells = [];
    var todayIndex = -1;
    for (var i = 0; i < totalCells; i++) {
      var dayNum, cellDate, inMonth;
      if (i < lead) {
        dayNum = prevDays - lead + 1 + i;
        cellDate = new Date(y, mo - 1, dayNum, 12);
        inMonth = false;
      } else if (i >= lead + daysInMonth) {
        dayNum = i - (lead + daysInMonth) + 1;
        cellDate = new Date(y, mo + 1, dayNum, 12);
        inMonth = false;
      } else {
        dayNum = i - lead + 1;
        cellDate = new Date(y, mo, dayNum, 12);
        inMonth = true;
      }
      var k = dayKeyOf(cellDate.getTime());
      var n = inMonth ? (counts[k] || 0) : 0;
      var level = S && S.heatmapBuckets ? S.heatmapBuckets(n, maxN) : 0;
      var isToday = k === todayKey;

      var cell = h('div', 'st-cal-cell' + (inMonth ? '' : ' st-adj') + (isToday ? ' st-today' : ''));
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('data-level', String(level));
      cell.setAttribute('data-day', k);
      var label = WEEKDAYS[(cellDate.getDay() + 6) % 7] + ' ' + dayNum + ' ' + MONTHS_FULL[cellDate.getMonth()] + ', ' +
        (n === 0 ? 'no runs' : plural(n, 'run', 'runs')) + (isToday ? ', today' : '');
      cell.setAttribute('aria-label', label);
      cell.title = label;
      if (isToday) cell.setAttribute('aria-current', 'date');
      cell.tabIndex = -1;

      var fill = h('span', 'st-cal-fill');
      fill.setAttribute('aria-hidden', 'true');
      cell.appendChild(fill);
      cell.appendChild(h('span', 'st-cal-d', String(dayNum)));
      if (n > 0 && inMonth) cell.appendChild(h('span', 'st-cal-n', String(n)));
      if (isToday) todayIndex = cells.length;
      cells.push(cell);
      grid.appendChild(cell);
    }

    /* Roving tabindex: one tab stop for the whole grid, arrows move inside it.
       Rows are weeks, so left/right step a day and up/down step a week. */
    var startIndex = todayIndex >= 0 ? todayIndex : Math.min(lead, cells.length - 1);
    if (startIndex < 0) startIndex = 0;
    for (var c = 0; c < cells.length; c++) cells[c].tabIndex = c === startIndex ? 0 : -1;
    grid.addEventListener('keydown', function (e) {
      var cur = cells.indexOf(document.activeElement);
      if (cur < 0) return;
      var next = -1;
      var rowStart = cur - (cur % 7);
      if (e.key === 'ArrowRight') next = cur + 1 <= rowStart + 6 ? cur + 1 : -1;
      else if (e.key === 'ArrowLeft') next = cur - 1 >= rowStart ? cur - 1 : -1;
      else if (e.key === 'ArrowDown') next = cur + 7;
      else if (e.key === 'ArrowUp') next = cur - 7;
      else if (e.key === 'Home') next = rowStart;
      else if (e.key === 'End') next = rowStart + 6;
      else return;
      if (next < 0 || next >= cells.length) return;
      e.preventDefault();
      cells[cur].tabIndex = -1;
      cells[next].tabIndex = 0;
      cells[next].focus();
    });
    section.appendChild(grid);

    var foot = h('div', 'st-cal-foot');
    var legend = h('div', 'st-cal-legend');
    legend.appendChild(h('span', 'st-cal-leg-label', 'Less'));
    for (var lv = 0; lv <= 4; lv++) {
      var sw = h('span', 'st-cal-sw');
      sw.setAttribute('data-level', String(lv));
      legend.appendChild(sw);
    }
    legend.appendChild(h('span', 'st-cal-leg-label', 'More'));
    foot.appendChild(legend);

    var streak = S && S.streak ? S.streak(model.state, now) : 0;
    var sum = h('div', 'st-cal-sum');
    sum.appendChild(h('span', null, 'Best day '));
    sum.appendChild(h('b', null, String(bestDay)));
    sum.appendChild(h('span', null, '  ·  streak ' + plural(streak, 'day', 'days')));
    foot.appendChild(sum);
    section.appendChild(foot);

    if (!monthRuns) {
      section.appendChild(h('p', 'st-cal-empty',
        'No runs in ' + monthName + ' yet. Pick another month, or start a drill to fill this one in.'));
    }
  }

  draw();
  return section;
}

/* ---------- chart ---------- */

function appendTick(svg, x, y, text, anchor, cls) {
  var t = svgEl('text', { x: x, y: y, class: 'st-tick' + (cls ? ' ' + cls : ''), 'text-anchor': anchor });
  t.textContent = text;
  svg.appendChild(t);
}

function whenLabel(t, mode) {
  var d = new Date(t);
  var base = MONTHS[d.getMonth()] + ' ' + d.getDate();
  if (mode === 'day') return base;
  return base + ', ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/* The tooltip for one point: the drill, its value with unit, and when it
   happened. A folded point also says how many runs it stands for. */
function tipFor(drill, p, mode) {
  var unit = drill.unit || '';
  var val = fmtNum(p.v) + (unit ? ' ' + unit : '');
  var when = whenLabel(p.t, mode);
  var extra = mode === 'day' && p.n > 1 ? p.n + ' runs, average'
    : mode === 'session' && p.n > 1 ? p.n + ' runs in this session'
    : '';
  return {
    name: drill.name, val: val, when: when, extra: extra,
    aria: drill.name + ', ' + val + ', ' + when + (extra ? ', ' + extra : '')
  };
}

function chartInto(host, drill, model, mode) {
  clear(host);
  var runs = runsFor(model.records, drill.id);
  var series = aggregatePoints(runs, mode, model.sessions);
  if (!series.length) {
    host.appendChild(h('p', 'st-none', 'No runs yet for this drill.'));
    return;
  }
  var usedW = 0;
  /* Drawn twice: once now so the tree is never empty, then again on the next
     frame at the host's real width, so the viewBox matches the rendered box and
     text is never stretched. */
  function draw() {
    clear(host);
    var w = Math.round(host.clientWidth || 0) || 640;
    w = Math.max(300, Math.min(w, 1400));
    usedW = w;
    var compact = w < 560;
    var hh = compact ? Math.round(w * 0.64) : Math.round(w * 0.42);
    var c = buildChart(series, w, hh, 0, {
      padL: compact ? 30 : 42, padR: 14, padT: 20, padB: 26
    });
    if (!c) return;
    var svg = svgEl('svg', {
      viewBox: '0 0 ' + c.w + ' ' + c.h,
      preserveAspectRatio: 'none',
      class: 'st-chart',
      role: 'group',
      'aria-label': drill.name + ' results over time, ' + c.points.length +
        (c.points.length === 1 ? ' point' : ' points')
    });
    /* Three hairline guides behind the line, so the eye can read a value off the
       height without a full grid. */
    var mid = (c.vmin + c.vmax) / 2;
    var guides = [c.vmax, mid, c.vmin];
    for (var g = 0; g < guides.length; g++) {
      var gy = round2(c.h - c.padB - (guides[g] - c.vmin) / (c.vmax - c.vmin || 1) * (c.h - c.padT - c.padB));
      svg.appendChild(svgEl('line', { x1: c.padL, y1: gy, x2: c.w - c.padR, y2: gy, class: 'st-grid' }));
    }
    svg.appendChild(svgEl('line', { x1: c.padL, y1: c.h - c.padB, x2: c.w - c.padR, y2: c.h - c.padB, class: 'st-axis' }));
    svg.appendChild(svgEl('line', { x1: c.padL, y1: c.padT, x2: c.padL, y2: c.h - c.padB, class: 'st-axis' }));
    /* Bare value ticks. The unit is not glued to a number; it is the axis label. */
    appendTick(svg, c.padL - 6, c.padT + 4, fmtNum(c.vmax), 'end', 'st-tick-val');
    appendTick(svg, c.padL - 6, c.h - c.padB + 4, fmtNum(c.vmin), 'end');
    appendTick(svg, c.padL, c.h - c.padB + 15, dateLabel(c.tmin), 'start');
    appendTick(svg, c.w - c.padR, c.h - c.padB + 15, dateLabel(c.tmax), 'end');
    if (drill.unit) {
      var u = svgEl('text', { x: c.padL, y: c.padT - 8, class: 'st-tick st-axis-unit', 'text-anchor': 'start' });
      u.textContent = drill.unit;
      svg.appendChild(u);
    }
    svg.appendChild(svgEl('path', { d: c.d, class: 'st-line' }));

    var tip = h('div', 'st-tip');
    for (var i = 0; i < c.points.length; i++) {
      var p = c.points[i];
      svg.appendChild(svgEl('circle', { cx: round2(p.x), cy: round2(p.y), r: 2.4, class: 'st-dot' }));
      var hit = svgEl('circle', {
        cx: round2(p.x), cy: round2(p.y), r: 9, class: 'st-hit',
        tabindex: '0', focusable: 'true', role: 'img', 'aria-label': tipFor(drill, p, mode).aria
      });
      /* Closure per point so each keeps its own coordinates. */
      (function (pt) {
        function show() {
          var info = tipFor(drill, pt, mode);
          tip.replaceChildren();
          tip.appendChild(h('span', 'st-tip-name', info.name));
          tip.appendChild(h('span', 'st-tip-val', info.val));
          tip.appendChild(h('span', 'st-tip-when', info.when + (info.extra ? '  ·  ' + info.extra : '')));
          tip.style.left = round2(pt.x) + 'px';
          tip.style.top = round2(pt.y) + 'px';
          tip.classList.toggle('is-below', pt.y < 70);
          tip.classList.add('is-on');
          /* Keep the box inside the chart: centre it on the point, then pull it
             back by half its own width when it would cross either edge. */
          var half = (tip.offsetWidth || 0) / 2;
          var cx = Math.min(Math.max(pt.x, half + 2), w - half - 2);
          tip.style.left = round2(cx) + 'px';
        }
        function hide() { tip.classList.remove('is-on'); }
        hit.addEventListener('mouseenter', show);
        hit.addEventListener('mouseleave', hide);
        hit.addEventListener('focus', show);
        hit.addEventListener('blur', hide);
      })(p);
      svg.appendChild(hit);
    }
    host.appendChild(svg);
    host.appendChild(tip);
  }
  draw();
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(function () {
      if (typeof document === 'undefined' || !host.isConnected) return;
      if (Math.round(host.clientWidth || 0) !== usedW) draw();
    });
  }
}

function buildChartSection(model) {
  var section = h('section', 'st-section');
  var head = h('div', 'st-sec-head');
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
  var mode = 'run';
  var drillBtns = {};
  var modeBtns = {};
  function renderChart() {
    var d = drillById(selected);
    for (var id in drillBtns) {
      if (Object.prototype.hasOwnProperty.call(drillBtns, id)) drillBtns[id].setAttribute('aria-pressed', id === selected ? 'true' : 'false');
    }
    for (var m in modeBtns) {
      if (Object.prototype.hasOwnProperty.call(modeBtns, m)) modeBtns[m].setAttribute('aria-pressed', m === mode ? 'true' : 'false');
    }
    chartInto(host, d, model, mode);
  }

  var chips = h('div', 'st-chips');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'Choose a drill for the chart');
  D.forEach(function (d) {
    var b = h('button', 'st-chip', d.name);
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () { selected = d.id; renderChart(); });
    drillBtns[d.id] = b;
    chips.appendChild(b);
  });
  head.appendChild(chips);
  section.appendChild(head);

  var measure = h('div', 'st-measure');
  measure.setAttribute('role', 'group');
  measure.setAttribute('aria-label', 'Measure the trend by');
  measure.appendChild(h('span', 'st-measure-label', 'Measure'));
  MEASURE_MODES.forEach(function (m) {
    var b = h('button', 'st-chip', m.label);
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () { mode = m.id; renderChart(); });
    modeBtns[m.id] = b;
    measure.appendChild(b);
  });
  section.appendChild(measure);

  section.appendChild(host);
  renderChart();
  return section;
}

/* ---------- per-drill table ---------- */

var COLS = ['Best', 'Last', 'Average', 'Runs', 'Trend'];

function cell(label, value) {
  var td = h('td');
  td.appendChild(h('span', 'st-cell-label', label));
  td.appendChild(h('span', 'st-cell-value', value));
  return td;
}

function buildTableSection(model) {
  var Store = globalThis.Store;
  var section = h('section', 'st-section st-panel');
  var head = h('div', 'st-sec-head');
  head.appendChild(h('h2', 'st-h', 'By drill'));
  head.appendChild(h('span', 'st-sec-note', plural(drillList().length, 'drill', 'drills')));
  section.appendChild(head);

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
      var trendTd = h('td');
      trendTd.appendChild(h('span', 'st-cell-label', 'Trend'));
      var kind = trendKind(model.records, d.id, dir, model.now);
      var wrap = h('span', 'st-trend');
      wrap.setAttribute('data-trend', kind);
      var dot = h('span', 'st-trend-dot');
      dot.setAttribute('aria-hidden', 'true');
      var txt = h('span', 'st-trend-v');
      txt.appendChild(dot);
      txt.appendChild(h('span', null, trendText(model.records, d.id, dir, model.now)));
      wrap.appendChild(txt);
      trendTd.appendChild(wrap);
      tr.appendChild(trendTd);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  section.appendChild(table);
  return section;
}

/* ---------- recent runs ---------- */

function buildRecentSection(model) {
  var section = h('section', 'st-section st-feed');
  var head = h('div', 'st-sec-head');
  head.appendChild(h('h2', 'st-h', 'Recent runs'));
  var rs = model.records.slice().sort(function (a, b) { return b.t - a.t; }).slice(0, RECENT_LIMIT);
  if (rs.length) head.appendChild(h('span', 'st-sec-note', 'last ' + rs.length));
  section.appendChild(head);

  if (!rs.length) {
    section.appendChild(h('p', 'st-none', 'No runs yet.'));
    return section;
  }
  /* How many of these recent runs fall on each day, so a day header can say. */
  var perDay = {};
  rs.forEach(function (r) {
    var k = dayKeyOf(r.t);
    perDay[k] = (perDay[k] || 0) + 1;
  });
  var list = h('div', 'st-feed-list');
  var lastKey = null;
  rs.forEach(function (r) {
    var key = dayKeyOf(r.t);
    if (key !== lastKey) {
      var dayHead = h('div', 'st-feed-day');
      dayHead.appendChild(h('span', 'st-feed-day-label', dayLabel(key, model.now)));
      dayHead.appendChild(h('span', 'st-feed-day-n', plural(perDay[key], 'run', 'runs')));
      list.appendChild(dayHead);
      lastKey = key;
    }
    var d = drillById(r.drillId);
    var unit = r.unit || d.unit || '';
    var row = h('div', 'st-feed-row');
    var item = h('div', 'st-feed-item');
    item.appendChild(h('span', 'st-feed-name', d.name));
    item.appendChild(h('span', 'st-feed-when', clockOf(r.t)));
    row.appendChild(item);
    row.appendChild(h('span', 'st-feed-val', fmtNum(r.value) + (unit ? ' ' + unit : '')));
    list.appendChild(row);
  });
  section.appendChild(list);
  return section;
}

/* ---------- empty ---------- */

function buildEmpty(ctx) {
  var wrap = h('div', 'st-empty');
  wrap.appendChild(h('h2', 'st-h', 'Stats'));
  wrap.appendChild(h('p', null, 'Nothing to show yet. As you complete drills, your totals, an activity calendar, a per-drill table, and a chart of results over time will appear here.'));
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
  container.appendChild(buildHeader(model));
  var top = h('div', 'st-top');
  top.appendChild(buildCalendar(model));
  top.appendChild(buildTotalsSection(model));
  container.appendChild(top);
  container.appendChild(buildChartSection(model));
  var cols = h('div', 'st-cols');
  cols.appendChild(buildTableSection(model));
  cols.appendChild(buildRecentSection(model));
  container.appendChild(cols);
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
