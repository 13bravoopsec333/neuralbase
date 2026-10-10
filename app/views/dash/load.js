/* Neuralbase dashboard section: training load.
   build(ctx, data) -> one <section> with its own heading and its own scoped styles.
   Four blocks, all derived from the shared dashboard data object:
     - load meter: training time in the last seven days against the seven before,
       summed from run meta.duration_ms;
     - skill balance: the two most and two least trained skills by sessions over
       the last 14 days;
     - coverage: all nine skills, sessions over the last 14 days, the ones with no
       session marked neglected;
     - time invested: minutes per skill, all time, and the total.

   Every number comes from data.runs or data.sessions. When no run carries a
   meta.duration_ms the two time blocks are left out and the section says so in
   one line, rather than inventing minutes. All text is set with textContent. */

import { h, drillRegistry, metaFor } from '../dashboard.js';

var DAY = 86400000;
var STYLE_ID = 'cortex-dash-load-styles';
var WINDOW_DAYS = 14;
var WEEK_MS = 7 * DAY;

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  var s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = [
    '.dash-load{display:flex;flex-direction:column;gap:var(--gap-3);min-width:0}',
    '.dl-title{margin:0;font-size:16px;font-weight:600;letter-spacing:-.01em}',
    /* Two columns wide, one on a phone. Coverage is a normal card whose inner
       grid reflows on its own, so no card needs a special span. */
    '.dl-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--gap-3);min-width:0}',
    '.dl-card{min-width:0}',
    '.dl-empty{margin:0;font-size:13px;color:var(--dim);line-height:1.5}',
    '.dl-note{margin:10px 0 0;font-size:12px;color:var(--dim);line-height:1.45}',

    /* load meter */
    '.dl-load-rows{display:flex;flex-direction:column;gap:10px}',
    '.dl-load-row{display:flex;align-items:center;gap:10px;min-width:0}',
    '.dl-load-lab{font-size:12px;color:var(--muted);width:66px;flex:none}',
    '.dl-load-track{flex:1;height:12px;border-radius:6px;background:var(--panel2);border:1px solid var(--line);overflow:hidden;min-width:0}',
    '.dl-load-fill{height:100%;border-radius:6px;background:var(--bar-strong)}',
    '.dl-load-fill.heavy{background:var(--lime)}',
    '.dl-load-val{font-family:var(--mono);font-size:12px;color:var(--ink);width:64px;flex:none;text-align:right;font-variant-numeric:tabular-nums}',
    '.dl-verdict{margin-top:11px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;border:1px solid var(--lime-edge);background:var(--lime-soft);border-radius:8px;padding:8px 10px}',
    '.dl-verdict b{font-size:13px;font-weight:600}',
    '.dl-verdict span{font-size:12px;color:var(--muted)}',

    /* skill balance */
    '.dl-bal{display:flex;flex-direction:column;gap:9px}',
    '.dl-bal-row{display:flex;flex-direction:column;gap:2px}',
    '.dl-bal-names{font-size:13px;color:var(--ink);line-height:1.4}',
    '.dl-bal-names.less{color:var(--muted)}',
    '.dl-bal-names b{font-weight:600}',
    '.dl-bal-names.less b{color:var(--ink)}',
    '.dl-bal-line{margin:2px 0 0;font-size:12px;color:var(--muted);line-height:1.45}',

    /* coverage */
    '.dl-cov-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}',
    '.dl-cov{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:9px 10px;display:flex;flex-direction:column;gap:7px;min-width:0}',
    '.dl-cov-top{display:flex;align-items:baseline;justify-content:space-between;gap:6px}',
    '.dl-cov-name{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.dl-cov-n{font-family:var(--mono);font-size:13px;font-weight:500;color:var(--ink);flex:none;font-variant-numeric:tabular-nums}',
    '.dl-cov-track{height:6px;border-radius:3px;background:var(--panel);border:1px solid var(--line);overflow:hidden}',
    '.dl-cov-fill{height:100%;border-radius:3px;background:var(--lime)}',
    '.dl-cov.low .dl-cov-fill{background:var(--warn)}',
    '.dl-cov-tag{font-family:var(--mono);font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--warn)}',
    '.dl-cov-tag.hidden{visibility:hidden}',

    /* time invested */
    '.dl-time-bar{display:flex;height:16px;border-radius:6px;overflow:hidden;border:1px solid var(--line)}',
    '.dl-time-seg{height:100%;min-width:2px}',
    '.dl-time-seg+.dl-time-seg{box-shadow:inset 1px 0 0 var(--panel)}',
    '.dl-time-legend{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}',
    '.dl-time-legend li{display:flex;align-items:center;gap:9px;font-size:12px;min-width:0}',
    '.dl-time-key{width:9px;height:9px;border-radius:2px;flex:none;border:1px solid var(--line)}',
    '.dl-time-name{color:var(--muted);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dl-time-min{margin-left:auto;font-family:var(--mono);font-size:12px;color:var(--ink);flex:none;font-variant-numeric:tabular-nums}',

    '@media(max-width:640px){.dl-grid{grid-template-columns:minmax(0,1fr)}}',
    '@media(max-width:400px){.dl-load-lab{width:58px}.dl-load-val{width:56px}}'
  ].join('');
  document.head.appendChild(s);
}

/* ---------------- small normalizers ---------------- */

function runT(r) {
  if (!r) return 0;
  var x = r.t;
  if (typeof x === 'number' && isFinite(x)) return x;
  var p = Date.parse(r.created_at || '');
  return isNaN(p) ? 0 : p;
}

function drillOf(r) {
  return r ? (r.drillId || r.drill_id || null) : null;
}

/* The one measurement this file trusts for time: the run's own duration. */
function durationOf(r) {
  var m = r && r.meta;
  if (!m || typeof m !== 'object') return null;
  var d = m.duration_ms;
  return (typeof d === 'number' && isFinite(d) && d > 0) ? d : null;
}

function sessionT(s) {
  if (!s) return 0;
  var x = s.t;
  if (typeof x === 'number' && isFinite(x)) return x;
  var p = Date.parse(s.created_at || '');
  return isNaN(p) ? 0 : p;
}

/* Sessions per drill over the last `days` local days, counted from the session
   rows the dashboard already normalized. One session counts once per drill. */
function sessionCounts(sessions, now, days) {
  var cutoff = now - days * DAY;
  var out = {};
  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i];
    var t = sessionT(s);
    if (!t || t <= cutoff) continue;
    var ds = (s && s.drills) || [];
    for (var j = 0; j < ds.length; j++) {
      var id = ds[j];
      if (!id) continue;
      out[id] = (out[id] || 0) + 1;
    }
  }
  return out;
}

/* Whole minutes for a span that is at least a minute, otherwise a plain marker.
   Never rounds a real span down to a misleading "0 min". */
function minLabel(ms) {
  if (ms >= 60000) return Math.round(ms / 60000) + ' min';
  return 'under 1 min';
}

/* ---------------- blocks ---------------- */

function card(title, cap) {
  var c = h('div', 'card dl-card');
  var head = h('div', 'card-head');
  head.appendChild(h('h3', null, title));
  if (cap) head.appendChild(h('span', 'cap', cap));
  c.appendChild(head);
  return c;
}

function loadRow(label, min, max, heavy) {
  var row = h('div', 'dl-load-row');
  row.appendChild(h('span', 'dl-load-lab', label));
  var track = h('div', 'dl-load-track');
  track.setAttribute('aria-hidden', 'true');
  var fill = h('div', 'dl-load-fill' + (heavy ? ' heavy' : ''));
  fill.style.width = (max > 0 ? Math.round((min / max) * 100) : 0) + '%';
  track.appendChild(fill);
  row.appendChild(track);
  row.appendChild(h('span', 'dl-load-val', min + ' min'));
  return row;
}

function loadMeter(runs, now) {
  var c = card('Load meter', 'last 7 days against the 7 before');
  var thisMs = 0, lastMs = 0;
  for (var i = 0; i < runs.length; i++) {
    var t = runT(runs[i]);
    if (!t) continue;
    var d = durationOf(runs[i]);
    if (d == null) continue;
    if (t > now - WEEK_MS) thisMs += d;
    else if (t > now - 2 * WEEK_MS) lastMs += d;
  }
  var thisMin = Math.round(thisMs / 60000);
  var lastMin = Math.round(lastMs / 60000);
  if (!thisMs && !lastMs) {
    c.appendChild(h('p', 'dl-empty', 'No training logged in the last two weeks.'));
    return c;
  }
  var max = Math.max(thisMin, lastMin, 1);
  var rows = h('div', 'dl-load-rows');
  rows.appendChild(loadRow('This week', thisMin, max, true));
  rows.appendChild(loadRow('Last week', lastMin, max, false));
  c.appendChild(rows);

  var verdict = thisMin > lastMin
    ? ['Heavier', 'you trained more than the week before']
    : thisMin < lastMin
      ? ['Lighter', 'you trained less than the week before']
      : ['Steady', 'the same as the week before'];
  var v = h('div', 'dl-verdict');
  v.appendChild(h('b', null, verdict[0]));
  v.appendChild(h('span', null, verdict[1]));
  c.appendChild(v);
  return c;
}

function skillBalance(reg, counts) {
  var c = card('Skill balance', 'last two weeks');
  var ids = Object.keys(reg);
  var order = {};
  for (var i = 0; i < ids.length; i++) order[ids[i]] = i;
  var ranked = ids.slice().sort(function (a, b) {
    var d = (counts[b] || 0) - (counts[a] || 0);
    return d !== 0 ? d : order[a] - order[b];
  });
  if (!(counts[ranked[0]] || 0)) {
    c.appendChild(h('p', 'dl-empty', 'No sessions in the last ' + WINDOW_DAYS + ' days.'));
    return c;
  }
  var most = ranked.slice(0, 2);
  var least = ranked.slice(-2);
  var box = h('div', 'dl-bal');
  box.appendChild(balRow('Most trained', most, false, reg));
  box.appendChild(balRow('Least trained', least, true, reg));
  box.appendChild(h('p', 'dl-bal-line', 'Add a run of each of the two light skills this week to even the load out.'));
  c.appendChild(box);
  return c;
}

function balRow(label, ids, less, reg) {
  var row = h('div', 'dl-bal-row');
  row.appendChild(h('span', 'h-label', label));
  var names = h('span', 'dl-bal-names' + (less ? ' less' : ''));
  names.appendChild(h('b', null, metaFor(reg, ids[0]).name));
  names.appendChild(document.createTextNode(' and '));
  names.appendChild(h('b', null, metaFor(reg, ids[1]).name));
  row.appendChild(names);
  return row;
}

function coverage(reg, counts) {
  var c = card('Skill coverage', 'sessions, last ' + WINDOW_DAYS + ' days');
  var ids = Object.keys(reg);
  var max = 0, i;
  for (i = 0; i < ids.length; i++) if ((counts[ids[i]] || 0) > max) max = counts[ids[i]];
  var grid = h('div', 'dl-cov-grid');
  for (i = 0; i < ids.length; i++) {
    var m = metaFor(reg, ids[i]);
    var n = counts[ids[i]] || 0;
    var box = h('div', 'dl-cov' + (n === 0 ? ' low' : ''));
    var top = h('div', 'dl-cov-top');
    var name = h('span', 'dl-cov-name', m.name);
    name.title = m.name;
    top.appendChild(name);
    top.appendChild(h('span', 'dl-cov-n', String(n)));
    box.appendChild(top);
    var track = h('div', 'dl-cov-track');
    track.setAttribute('aria-hidden', 'true');
    var fill = h('div', 'dl-cov-fill');
    fill.style.width = (max > 0 ? Math.round((n / max) * 100) : 0) + '%';
    track.appendChild(fill);
    box.appendChild(track);
    box.appendChild(h('span', 'dl-cov-tag' + (n === 0 ? '' : ' hidden'), 'neglected'));
    grid.appendChild(box);
  }
  c.appendChild(grid);
  c.appendChild(h('p', 'dl-note',
    'Skills with no session in the last ' + WINDOW_DAYS + ' days are marked neglected.'));
  return c;
}

function timeInvested(reg, runs) {
  var ms = {}, total = 0;
  for (var i = 0; i < runs.length; i++) {
    var d = durationOf(runs[i]);
    if (d == null) continue;
    var id = drillOf(runs[i]);
    if (!id) continue;
    ms[id] = (ms[id] || 0) + d;
    total += d;
  }
  var c = card('Time invested', minLabel(total) + ' all time');
  var rows = [];
  var ids = Object.keys(ms);
  for (var j = 0; j < ids.length; j++) rows.push({ id: ids[j], ms: ms[ids[j]] });
  rows.sort(function (a, b) { return b.ms - a.ms; });
  if (!rows.length) {
    c.appendChild(h('p', 'dl-empty', 'No training time recorded yet.'));
    return c;
  }

  var bar = h('div', 'dl-time-bar');
  bar.setAttribute('aria-hidden', 'true');
  var legend = h('ul', 'dl-time-legend');
  for (var k = 0; k < rows.length; k++) {
    var row = rows[k];
    var share = total > 0 ? rows[k].ms / total : 0;
    var tone = 'color-mix(in srgb,var(--lime) ' + Math.max(22, Math.round(100 - k * 10)) + '%,var(--panel2))';
    var seg = h('div', 'dl-time-seg');
    seg.style.width = (share * 100) + '%';
    seg.style.background = tone;
    bar.appendChild(seg);

    var li = h('li');
    var key = h('span', 'dl-time-key');
    key.style.background = tone;
    li.appendChild(key);
    li.appendChild(h('span', 'dl-time-name', metaFor(reg, row.id).name));
    li.appendChild(h('span', 'dl-time-min', minLabel(row.ms)));
    legend.appendChild(li);
  }
  c.appendChild(bar);
  c.appendChild(legend);
  return c;
}

/* ---------------- build ---------------- */

export function build(ctx, data) {
  injectStyles();
  var reg = drillRegistry();
  var runs = (data && Array.isArray(data.runs)) ? data.runs : [];
  var sessions = (data && Array.isArray(data.sessions)) ? data.sessions : [];
  var now = (data && typeof data.now === 'number') ? data.now : Date.now();

  var section = h('section', 'dash-load');
  section.setAttribute('aria-label', 'Training load');
  section.appendChild(h('h2', 'dl-title', 'Training load'));

  var withDuration = 0;
  for (var i = 0; i < runs.length; i++) if (durationOf(runs[i]) != null) withDuration++;

  var counts = sessionCounts(sessions, now, WINDOW_DAYS);
  var grid = h('div', 'dl-grid');
  if (withDuration) grid.appendChild(loadMeter(runs, now));
  grid.appendChild(skillBalance(reg, counts));
  grid.appendChild(coverage(reg, counts));
  if (withDuration) {
    grid.appendChild(timeInvested(reg, runs));
  } else {
    var note = card('Time invested');
    note.appendChild(h('p', 'dl-empty',
      'No run has logged a duration yet, so training time cannot be shown.'));
    grid.appendChild(note);
  }
  section.appendChild(grid);
  return section;
}
