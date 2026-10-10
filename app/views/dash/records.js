/* Neuralbase dashboard section: Records.
   build(ctx, data) returns one section node with four blocks:
     1. recent personal bests, with the gain over the previous best and how long ago
     2. per-drill direction, all nine drills, a two-week sparkline and a word
     3. this week against last week, sessions and active days
     4. the most improved drill and the drill that has stalled, and how long flat
   Every number is derived from data (see the shape in dashboard.js buildData). A
   block with nothing to derive is left out; a section with no blocks hides itself,
   so an empty account shows no empty box. Names and units come from the drill
   registry, the same globalThis.Content.DRILLS the rest of the app reads. Text is
   set with textContent. No em dash, no emoji, tokens only. */

import { h, drillRegistry, metaFor, localDate, whenLabel } from '../dashboard.js';

var STYLE_ID = 'nb-dash-records-styles';
var DAY = 86400000;
var SPARK_DAYS = 14;
var BEST_CAP = 5;
var STALL_MIN_RUNS = 3;
var STALL_MIN_DAYS = 2;

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  var s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = [
    '.drc{min-width:0}',
    '.drc-block{margin-top:var(--gap-3);padding-top:var(--gap-3);border-top:1px solid var(--line)}',
    '.drc-block:first-of-type{margin-top:0;padding-top:0;border-top:0}',
    '.drc-h{margin:0 0 var(--gap-2);font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}',

    /* recent bests */
    '.drc-bests{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}',
    '.drc-best{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1px var(--gap-3);align-items:baseline;padding:7px 0;border-bottom:1px solid var(--line)}',
    '.drc-best:last-child{border-bottom:0}',
    '.drc-best-name{font-size:13px;font-weight:600;min-width:0;overflow-wrap:break-word}',
    '.drc-best-val{font-family:var(--mono);font-size:13px;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.drc-best-val .u{color:var(--muted);font-size:12px}',
    '.drc-best-meta{grid-column:1 / -1;font-size:12px;color:var(--muted);line-height:1.4}',
    '.drc-best-meta b{font-family:var(--mono);font-weight:500;color:var(--ink);font-variant-numeric:tabular-nums}',

    /* per-drill direction */
    '.drc-dirs{display:flex;flex-direction:column}',
    '.drc-dir{display:grid;grid-template-columns:minmax(0,1fr) 66px 58px;gap:var(--gap-2);align-items:center;padding:5px 0;border-bottom:1px solid var(--line);min-width:0}',
    '.drc-dir:last-child{border-bottom:0}',
    '.drc-dir-name{font-size:12px;color:var(--ink);min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.drc-spark{display:flex;align-items:flex-end;gap:1px;height:18px}',
    '.drc-spark i{flex:1;min-height:2px;background:var(--bar);border-radius:1px}',
    '.drc-spark i.on{background:var(--accent)}',
    '.drc-word{font-family:var(--mono);font-size:10px;letter-spacing:.04em;text-transform:uppercase;text-align:right;color:var(--dim)}',
    '.drc-word.rising{color:var(--accent)}',
    '.drc-word.slipping{color:var(--warn)}',

    /* week comparison */
    '.drc-weeks{display:flex;flex-direction:column;gap:var(--gap-2)}',
    '.drc-week{display:grid;grid-template-columns:62px minmax(0,1fr);gap:var(--gap-3);align-items:baseline}',
    '.drc-week-k{font-family:var(--mono);font-size:11px;letter-spacing:.03em;color:var(--dim)}',
    '.drc-week-v{font-size:13px;color:var(--ink)}',
    '.drc-week-v b{font-family:var(--mono);font-weight:500;font-variant-numeric:tabular-nums}',
    '.drc-say{margin:0;font-size:12px;color:var(--muted);line-height:1.45}',

    /* moves */
    '.drc-moves{display:flex;flex-direction:column;gap:var(--gap-2)}',
    '.drc-move{display:grid;grid-template-columns:84px minmax(0,1fr);gap:var(--gap-3);align-items:baseline}',
    '.drc-move-k{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim)}',
    '.drc-move-v{font-size:13px;color:var(--ink);line-height:1.45}',
    '.drc-move-v b{font-weight:600}',
    '.drc-move-v .n{font-family:var(--mono);font-variant-numeric:tabular-nums}',

    '@media(max-width:400px){.drc-dir{grid-template-columns:minmax(0,1fr) 54px 52px}.drc-move{grid-template-columns:74px minmax(0,1fr)}}'
  ].join('');
  document.head.appendChild(s);
}

/* ---------------- small helpers ---------------- */

function better(a, b, dir) { return dir === 'lower' ? a < b : a > b; }

function bestOf(values, dir) {
  var best = null;
  for (var i = 0; i < values.length; i++) {
    if (values[i] == null) continue;
    if (best === null || better(values[i], best, dir)) best = values[i];
  }
  return best;
}

/* Runs grouped by drill, in the order they arrive (newest last from the shell). */
function runsByDrill(runs) {
  var out = {};
  for (var i = 0; i < runs.length; i++) {
    var r = runs[i];
    if (!r || !r.drillId || !isFinite(r.value)) continue;
    (out[r.drillId] || (out[r.drillId] = [])).push(r);
  }
  return out;
}

/* The best value per local day over the last SPARK_DAYS days, oldest first. A day
   with no run is null. Lower is better for ms drills, higher for the rest. */
function dailyBests(list, dir, now) {
  var byDay = {};
  for (var i = 0; i < list.length; i++) {
    var k = localDate(list[i].t);
    var v = list[i].value;
    if (byDay[k] == null || better(v, byDay[k], dir)) byDay[k] = v;
  }
  var end = new Date(now);
  end.setHours(0, 0, 0, 0);
  var out = [];
  for (var j = SPARK_DAYS - 1; j >= 0; j--) {
    var key = localDate(new Date(end.getTime() - j * DAY).getTime());
    out.push(byDay[key] == null ? null : byDay[key]);
  }
  return out;
}

/* A bar per day. Taller means better, so an ms drill's faster day is the tall bar
   and the strip reads the same way for every drill. A day with no run is a faint
   stub, never a fabricated value. */
function sparkEl(values, dir) {
  var spark = h('div', 'drc-spark');
  spark.setAttribute('aria-hidden', 'true');
  var present = [];
  for (var i = 0; i < values.length; i++) if (values[i] != null) present.push(values[i]);
  var min = present.length ? Math.min.apply(null, present) : 0;
  var max = present.length ? Math.max.apply(null, present) : 0;
  var span = max - min;
  for (var j = 0; j < values.length; j++) {
    var v = values[j];
    var bar = h('i');
    if (v == null) {
      bar.style.height = '14%';
    } else if (span <= 0) {
      bar.classList.add('on');
      bar.style.height = '70%';
    } else {
      var frac = dir === 'lower' ? (max - v) / span : (v - min) / span;
      bar.classList.add('on');
      bar.style.height = Math.round(20 + frac * 80) + '%';
    }
    spark.appendChild(bar);
  }
  return spark;
}

/* The direction word, from the first week against the second inside the window.
   A threshold keeps a tiny wobble from reading as a trend: two percent for a
   timed drill, half a unit for a counted one. */
function dirWord(m, older, recent) {
  if (older == null || recent == null) return null;
  var thr = m.unit === 'ms' ? Math.abs(older) * 0.02 : 0.5;
  var imp = m.direction === 'lower' ? (older - recent) : (recent - older);
  if (imp > thr) return 'rising';
  if (imp < -thr) return 'slipping';
  return 'steady';
}

/* ---------------- block 1: recent personal bests ---------------- */

function blockBests(reg, data) {
  var recs = (data.records || []).filter(function (r) {
    return r && r.drillId && isFinite(r.best) && isFinite(r.prev);
  });
  if (!recs.length) return null;
  recs.sort(function (a, b) { return b.at - a.at; });

  var block = h('div', 'drc-block');
  block.appendChild(h('h4', 'drc-h', 'Recent bests'));
  var list = h('ul', 'drc-bests');
  var shown = recs.slice(0, BEST_CAP);
  for (var i = 0; i < shown.length; i++) {
    var rec = shown[i];
    var m = metaFor(reg, rec.drillId);
    var unit = m.unit || '';
    var gain = Math.abs(rec.best - rec.prev);

    var li = h('li', 'drc-best');
    li.appendChild(h('span', 'drc-best-name', m.name));
    var val = h('span', 'drc-best-val');
    val.appendChild(document.createTextNode(String(rec.best)));
    if (unit) val.appendChild(h('span', 'u', ' ' + unit));
    li.appendChild(val);

    var meta = h('span', 'drc-best-meta');
    meta.appendChild(document.createTextNode(m.direction === 'lower' ? 'Faster by ' : 'Higher by '));
    meta.appendChild(h('b', null, String(gain) + (unit ? ' ' + unit : '')));
    meta.appendChild(document.createTextNode(' on the ' + String(rec.prev) + (unit ? ' ' + unit : '') + ' before it. '));
    meta.appendChild(document.createTextNode(whenLabel(rec.at, data.now) + '.'));
    li.appendChild(meta);
    list.appendChild(li);
  }
  block.appendChild(list);

  if (recs.length > shown.length) {
    var more = recs.length - shown.length;
    block.appendChild(h('p', 'drc-say', more + ' earlier best' + (more === 1 ? '' : 's') + ' not shown.'));
  }
  return block;
}

/* ---------------- block 2: per-drill direction ---------------- */

function blockDirection(reg, data) {
  var runs = data.runs || [];
  if (!runs.length) return null;
  var cutoff = data.now - SPARK_DAYS * DAY;
  var byDrill = runsByDrill(runs);
  var ids = Object.keys(reg);
  if (!ids.length) return null;

  var block = h('div', 'drc-block');
  block.appendChild(h('h4', 'drc-h', 'Direction, last two weeks'));
  var grid = h('div', 'drc-dirs');
  var any = false;

  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    var m = reg[id];
    var win = (byDrill[id] || []).filter(function (r) { return r.t >= cutoff; });
    if (win.length) any = true;
    var days = dailyBests(win, m.direction, data.now);
    var older = bestOf(days.slice(0, 7), m.direction);
    var recent = bestOf(days.slice(7), m.direction);
    var word = dirWord(m, older, recent);

    var row = h('div', 'drc-dir');
    var name = h('span', 'drc-dir-name', m.name);
    name.title = m.name;
    row.appendChild(name);
    row.appendChild(sparkEl(days, m.direction));
    row.appendChild(h('span', 'drc-word' + (word ? ' ' + word : ''), word || ''));
    grid.appendChild(row);
  }
  if (!any) return null;
  block.appendChild(grid);
  return block;
}

/* ---------------- block 3: this week against last week ---------------- */

function weekStart(now) {
  var d = new Date(now);
  d.setHours(0, 0, 0, 0);
  var dow = (d.getDay() + 6) % 7; /* Monday is 0 */
  return new Date(d.getTime() - dow * DAY);
}

function blockWeeks(data) {
  var sessions = data.sessions || [];
  if (!sessions.length) return null;
  var thisMon = weekStart(data.now);
  var lastMon = new Date(thisMon.getTime() - 7 * DAY);

  var tw = 0, lw = 0, twd = {}, lwd = {};
  for (var i = 0; i < sessions.length; i++) {
    var t = sessions[i].t;
    if (t >= thisMon.getTime()) { tw++; twd[localDate(t)] = 1; }
    else if (t >= lastMon.getTime()) { lw++; lwd[localDate(t)] = 1; }
  }
  var twDays = Object.keys(twd).length;
  var lwDays = Object.keys(lwd).length;

  var block = h('div', 'drc-block');
  block.appendChild(h('h4', 'drc-h', 'This week against last week'));

  var weeks = h('div', 'drc-weeks');
  weeks.appendChild(weekRow('This week', tw, twDays));
  weeks.appendChild(weekRow('Last week', lw, lwDays));
  block.appendChild(weeks);

  var diff = tw - lw;
  var say;
  if (diff === 0) say = 'Same number of sessions as last week.';
  else if (diff > 0) say = diff + ' more session' + (diff === 1 ? '' : 's') + ' than last week.';
  else say = Math.abs(diff) + ' fewer session' + (diff === -1 ? '' : 's') + ' than last week.';
  block.appendChild(h('p', 'drc-say', say));
  return block;
}

function weekRow(label, sessions, days) {
  var row = h('div', 'drc-week');
  row.appendChild(h('span', 'drc-week-k', label));
  var v = h('span', 'drc-week-v');
  v.appendChild(h('b', null, String(sessions)));
  v.appendChild(document.createTextNode(' session' + (sessions === 1 ? '' : 's') + ', '));
  v.appendChild(h('b', null, String(days)));
  v.appendChild(document.createTextNode(' active day' + (days === 1 ? '' : 's')));
  row.appendChild(v);
  return row;
}

/* ---------------- block 4: most improved and stalled ---------------- */

function blockMoves(reg, data) {
  var runs = data.runs || [];
  if (!runs.length) return null;
  var cutoff = data.now - SPARK_DAYS * DAY;
  var byDrill = runsByDrill(runs);
  var ids = Object.keys(reg);

  var lastBest = {};
  var recs = data.records || [];
  for (var i = 0; i < recs.length; i++) {
    var rid = recs[i].drillId;
    if (!rid) continue;
    if (lastBest[rid] == null || recs[i].at > lastBest[rid]) lastBest[rid] = recs[i].at;
  }

  var improved = null;
  var stalled = null;

  for (var j = 0; j < ids.length; j++) {
    var id = ids[j];
    var m = reg[id];
    var list = byDrill[id] || [];
    if (list.length < 2) continue;

    var win = list.filter(function (r) { return r.t >= cutoff; });
    var days = dailyBests(win, m.direction, data.now);
    var older = bestOf(days.slice(0, 7), m.direction);
    var recent = bestOf(days.slice(7), m.direction);
    if (older != null && recent != null && Math.abs(older) > 0) {
      var imp = m.direction === 'lower' ? (older - recent) : (recent - older);
      var pct = imp / Math.abs(older);
      if (improved === null || pct > improved.pct) {
        improved = { m: m, pct: pct, older: older, recent: recent };
      }
    }

    if (list.length >= STALL_MIN_RUNS) {
      var since = lastBest[id];
      if (since == null) since = list[1].t; /* never improved: flat since the second run */
      var flat = Math.floor((data.now - since) / DAY);
      if (flat >= STALL_MIN_DAYS && (stalled === null || flat > stalled.days)) {
        stalled = { m: m, days: flat };
      }
    }
  }

  /* A drill cannot be both the improver and the one that stalled. */
  if (improved && improved.pct <= 0) improved = null;
  if (improved && stalled && improved.m.id === stalled.m.id) stalled = null;
  if (!improved && !stalled) return null;

  var block = h('div', 'drc-block');
  block.appendChild(h('h4', 'drc-h', 'Moving and stalled'));
  var moves = h('div', 'drc-moves');

  if (improved) {
    var mv = h('div', 'drc-move');
    mv.appendChild(h('span', 'drc-move-k', 'Most improved'));
    var v = h('span', 'drc-move-v');
    v.appendChild(h('b', null, improved.m.name));
    v.appendChild(document.createTextNode(', up '));
    v.appendChild(h('span', 'n', Math.round(improved.pct * 100) + '%'));
    v.appendChild(document.createTextNode(' over two weeks.'));
    mv.appendChild(v);
    moves.appendChild(mv);
  }

  if (stalled) {
    var st = h('div', 'drc-move');
    st.appendChild(h('span', 'drc-move-k', 'Stalled'));
    var sv = h('span', 'drc-move-v');
    sv.appendChild(h('b', null, stalled.m.name));
    sv.appendChild(document.createTextNode(', flat for '));
    sv.appendChild(h('span', 'n', String(stalled.days)));
    sv.appendChild(document.createTextNode(' day' + (stalled.days === 1 ? '' : 's') + '.'));
    st.appendChild(sv);
    moves.appendChild(st);
  }

  block.appendChild(moves);
  return block;
}

/* ---------------- the section ---------------- */

export function build(ctx, data) {
  injectStyles();
  data = data || {};
  var reg = drillRegistry();

  var section = h('section', 'card drc');
  section.setAttribute('aria-label', 'Records');
  var head = h('div', 'card-head');
  head.appendChild(h('h3', null, 'Records'));
  head.appendChild(h('span', 'cap', 'Bests, direction, and pace'));
  section.appendChild(head);

  var blocks = [
    blockBests(reg, data),
    blockDirection(reg, data),
    blockWeeks(data),
    blockMoves(reg, data)
  ];
  var any = false;
  for (var i = 0; i < blocks.length; i++) {
    if (blocks[i]) { section.appendChild(blocks[i]); any = true; }
  }
  if (!any) section.hidden = true;
  return section;
}
