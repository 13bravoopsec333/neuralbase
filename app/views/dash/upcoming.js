/* app/views/dash/upcoming.js
   Dashboard section: what spaced retrieval has due, the drills queued for the
   rest of the week with the reason each was picked, which drills still lack a
   first run, and the single best next action.

   build(ctx, data) returns one section node. Every number comes from the data
   the dashboard normalizer hands in; the plan itself comes from Store.dailyPlan,
   the same helper the dashboard's next-up card uses, so no schedule is invented.
   Text is set with textContent (the drill mark is the only markup, via iconEl).
   Scoped CSS only, theme tokens only. No paint on import. */

import {
  h, drillRegistry, metaFor, toState, readStore, dayIndexOf,
  localDate, msOf, dirMap, iconEl
} from '../dashboard.js';

var STYLE_ID = 'nb-upcoming-styles';
var DAY = 86400000;
var PLAN_SIZE = 3;
var DUE_DAYS = 7;
var QUEUE_KEY = 'cortex.train.queue';
var WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ---------------- small date helpers ---------------- */

function startOfDay(ms) {
  var d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/* A card's due stamp. Cards carry `due` in ms; an ISO string is accepted too. */
function dueOf(card) {
  if (!card) return null;
  var d = card.due;
  if (typeof d === 'number' && isFinite(d)) return d;
  var p = Date.parse(d);
  return isNaN(p) ? null : p;
}

function cardsDueBy(cards, endMs) {
  var n = 0;
  for (var i = 0; i < cards.length; i++) {
    var d = dueOf(cards[i]);
    if (d != null && d <= endMs) n++;
  }
  return n;
}

/* ---------------- scoped styles (theme tokens only) ---------------- */

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  var s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = [
    '.up{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:14px;display:flex;flex-direction:column;gap:var(--gap-3);min-width:0}',
    '.up-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}',
    '.up-head h2{margin:0;font-size:16px;font-weight:600;letter-spacing:-.01em}',
    '.up-cap{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}',
    '.up-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--gap-3);min-width:0}',
    '.up-card{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:11px 12px;display:flex;flex-direction:column;gap:9px;min-width:0}',
    '.up-card-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}',
    '.up-card-head h3{margin:0;font-size:13px;font-weight:600}',
    '.up-card-head span{font-size:11px;color:var(--dim)}',
    '.up-empty{margin:0;font-size:12.5px;color:var(--muted);line-height:1.45}',

    /* retrieval due */
    '.up-due{display:flex;flex-direction:column;gap:6px}',
    '.up-row{display:grid;grid-template-columns:54px minmax(0,1fr) auto;gap:9px;align-items:center;min-width:0}',
    '.up-day{font-family:var(--mono);font-size:11px;color:var(--muted)}',
    '.up-bar{height:6px;border-radius:3px;background:var(--line);overflow:hidden}',
    '.up-bar i{display:block;height:100%;background:var(--line2);border-radius:3px}',
    '.up-row.now .up-bar i{background:var(--lime)}',
    '.up-row.now .up-day{color:var(--ink)}',
    '.up-count{font-family:var(--mono);font-size:12px;color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap}',

    /* the week's queue */
    '.up-q{position:relative;display:flex;flex-direction:column;gap:9px;padding-left:17px}',
    '.up-q::before{content:"";position:absolute;left:4px;top:7px;bottom:7px;width:1px;background:var(--line2)}',
    '.up-qrow{position:relative;display:grid;grid-template-columns:52px minmax(0,1fr);gap:10px;align-items:start;min-width:0}',
    '.up-qrow::before{content:"";position:absolute;left:-17px;top:4px;width:8px;height:8px;border-radius:50%;background:var(--panel2);border:2px solid var(--line2)}',
    '.up-qrow.now::before{border-color:var(--lime);background:var(--lime)}',
    '.up-qday{font-family:var(--mono);font-size:11px;color:var(--muted);padding-top:1px}',
    '.up-qbody{display:flex;flex-direction:column;gap:4px;min-width:0}',
    '.up-qline{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;min-width:0}',
    '.up-qname{font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:6px;min-width:0}',
    '.up-qwhy{font-size:11.5px;color:var(--muted);overflow-wrap:anywhere}',
    '.up-pill{font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--lime);background:var(--lime-soft);border:1px solid var(--lime-edge);border-radius:20px;padding:2px 7px;flex:none}',

    /* baselines */
    '.up-bl{display:flex;flex-direction:column;gap:9px}',
    '.up-bl-num{font-family:var(--mono);font-size:15px;color:var(--ink);font-variant-numeric:tabular-nums}',
    '.up-bl-num span{font-family:var(--sans);font-size:12px;color:var(--dim);margin-left:4px}',
    '.up-bl-bar{height:8px;border-radius:4px;background:var(--line);overflow:hidden}',
    '.up-bl-bar i{display:block;height:100%;background:var(--lime)}',
    '.up-bl-sub{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}',
    '.up-chips{display:flex;flex-wrap:wrap;gap:6px}',
    '.up-chip{font-size:11.5px;color:var(--muted);background:var(--panel);border:1px solid var(--line);border-radius:7px;padding:4px 8px;display:inline-flex;align-items:center;gap:6px;overflow-wrap:anywhere}',
    '.up-chip::before{content:"";width:6px;height:6px;border-radius:50%;border:1.5px solid var(--warn);flex:none}',

    /* best next action */
    '.up-next{display:flex;align-items:center;gap:var(--gap-3);background:var(--panel2);border:1px solid var(--lime-edge);border-left:3px solid var(--lime);border-radius:8px;padding:11px 12px;min-width:0}',
    '.up-next .drill-ic{width:34px;height:34px;flex:none;border-radius:8px;background:var(--lime-soft);border:1px solid var(--lime-edge);padding:6px}',
    '.up-next-main{min-width:0;flex:1}',
    '.up-next-label{font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--lime)}',
    '.up-next-name{font-size:16px;font-weight:600;letter-spacing:-.01em;margin-top:4px;overflow-wrap:anywhere}',
    '.up-next-why{margin:3px 0 0;font-size:12.5px;color:var(--muted);line-height:1.4;overflow-wrap:anywhere}',
    '.up-start{flex:none}',

    '@media(max-width:900px){.up-grid{grid-template-columns:minmax(0,1fr)}}',
    '@media(max-width:560px){.up{padding:12px}.up-next{flex-wrap:wrap}.up-start{width:100%}}'
  ].join('');
  document.head.appendChild(s);
}

/* ---------------- the week's plan (Store.dailyPlan, not invented) ---------------- */

function planFor(state, ids, dayIdx) {
  if (!ids.length) return [];
  var S = globalThis.Store;
  if (S && typeof S.dailyPlan === 'function') {
    try {
      var out = S.dailyPlan(state, dayIdx, ids, PLAN_SIZE);
      if (out && out.length) return out;
    } catch (e) { /* fall through to the registry order */ }
  }
  return ids.slice(0, PLAN_SIZE);
}

/* Why dailyPlan picked this drill. dailyPlan scores each drill as
   weight * staleness * weakness, so the largest of those three terms is the
   honest answer. A drill with no runs has no history to read, so it is called
   the rotation rather than a re-test. */
function dominantReason(state, reg, id, spacedDue) {
  var S = globalThis.Store;
  var m = metaFor(reg, id);
  if (id === 'spaced' && spacedDue) return 'Its card set is due.';

  var agg = (S && typeof S.aggregate === 'function')
    ? S.aggregate(state, id, m.direction)
    : { best: null, avg: null, attempts: 0 };

  var last = 0;
  var rs = state.records || [];
  for (var i = 0; i < rs.length; i++) {
    if (rs[i].drillId === id && rs[i].t > last) last = rs[i].t;
  }
  var sinceDays = last ? (Date.now() - last) / DAY : 30;
  if (sinceDays < 0) sinceDays = 0;
  if (sinceDays > 30) sinceDays = 30;
  var stale = 1 + sinceDays / 15;

  var gap = 0;
  if (agg.best !== null && Math.abs(agg.best) >= 1e-9) {
    gap = m.direction === 'lower'
      ? (agg.avg - agg.best) / Math.abs(agg.best)
      : (agg.best - agg.avg) / Math.abs(agg.best);
  }
  if (!isFinite(gap) || gap < 0) gap = 0;
  if (gap > 1) gap = 1;
  var weak = 1 + gap;

  var weights = (S && typeof S.goalWeights === 'function')
    ? S.goalWeights(state.goal || 'fresh') : {};
  var w = weights[id] || 1;

  var parts = [
    { v: w - 1, text: 'Fits your goal mix.' },
    { v: stale - 1, text: 'Due for a re-test.' },
    { v: weak - 1, text: 'Your weakest skill.' }
  ];
  parts.sort(function (a, b) { return b.v - a.v; });
  var top = parts[0];
  if (top.v <= 0.001) return 'Next in the rotation.';
  if (!agg.attempts && top.text === 'Due for a re-test.') return 'Next in the rotation.';
  return top.text;
}

/* ---------------- blocks ---------------- */

function buildRetrieval(data, now) {
  var card = h('div', 'up-card');
  var head = h('div', 'up-card-head');
  head.appendChild(h('h3', null, 'Retrieval due'));
  head.appendChild(h('span', null, 'cards'));
  card.appendChild(head);

  var cards = (data && data.cards) || [];
  if (!cards.length) {
    card.appendChild(h('p', 'up-empty',
      'No cards in the deck yet. Add cards in Study and they come due here.'));
    return card;
  }

  var today = startOfDay(now);
  var endToday = today + DAY - 1;
  var counts = {};       /* local day key -> card count */
  var todayCount = 0;
  for (var i = 0; i < cards.length; i++) {
    var d = dueOf(cards[i]);
    if (d == null) continue;
    if (d <= endToday) { todayCount++; continue; }
    var k = localDate(d);
    counts[k] = (counts[k] || 0) + 1;
  }

  var rows = [];
  if (todayCount > 0) rows.push({ now: true, label: 'Today', n: todayCount });
  var max = todayCount;
  for (var off = 1; off < DUE_DAYS; off++) {
    var ms = today + off * DAY;
    var key = localDate(ms);
    var n = counts[key] || 0;
    if (!n) continue;
    if (n > max) max = n;
    rows.push({ now: false, label: WD_SHORT[new Date(ms).getDay()], n: n });
  }

  if (!rows.length) {
    card.appendChild(h('p', 'up-empty', 'Nothing due in the next ' + DUE_DAYS + ' days.'));
    return card;
  }

  var list = h('div', 'up-due');
  for (i = 0; i < rows.length; i++) {
    var r = rows[i];
    var row = h('div', 'up-row' + (r.now ? ' now' : ''));
    row.setAttribute('aria-label', r.label + ', ' + r.n + (r.n === 1 ? ' card' : ' cards') + ' due');
    row.appendChild(h('span', 'up-day', r.label));
    var bar = h('span', 'up-bar');
    bar.setAttribute('aria-hidden', 'true');
    var fill = h('i');
    fill.style.width = Math.round((r.n / max) * 100) + '%';
    bar.appendChild(fill);
    row.appendChild(bar);
    row.appendChild(h('span', 'up-count', String(r.n)));
    list.appendChild(row);
  }
  card.appendChild(list);
  card.appendChild(h('p', 'up-empty',
    'Cards come back sooner while recall is shaky, then the gap widens.'));
  return card;
}

function buildQueue(state, reg, data, now) {
  var card = h('div', 'up-card');
  var head = h('div', 'up-card-head');
  head.appendChild(h('h3', null, "This week's queue"));
  head.appendChild(h('span', null, 'why each drill'));
  card.appendChild(head);

  var ids = Object.keys(reg);
  if (!ids.length) {
    card.appendChild(h('p', 'up-empty', 'No drills loaded.'));
    return card;
  }

  var cards = (data && data.cards) || [];
  var today = startOfDay(now);
  var todayIdx = dayIndexOf(now);
  var dow = (new Date(now).getDay() + 6) % 7;   /* Monday is 0 */
  var daysLeft = 7 - dow;                       /* today through Sunday */

  var list = h('div', 'up-q');
  var shown = 0;
  for (var off = 0; off < daysLeft; off++) {
    var ms = today + off * DAY;
    var plan = planFor(state, ids, todayIdx + off).slice();
    var spacedDue = cardsDueBy(cards, ms + DAY - 1) > 0;
    if (spacedDue && plan.indexOf('spaced') === -1) plan = ['spaced'].concat(plan).slice(0, PLAN_SIZE);
    if (!plan.length) continue;
    shown++;

    var row = h('div', 'up-qrow' + (off === 0 ? ' now' : ''));
    row.appendChild(h('span', 'up-qday', off === 0 ? 'Today' : WD_SHORT[new Date(ms).getDay()]));
    var body = h('div', 'up-qbody');
    for (var j = 0; j < plan.length; j++) {
      var id = plan[j];
      var m = metaFor(reg, id);
      var line = h('div', 'up-qline');
      var name = h('span', 'up-qname');
      name.appendChild(iconEl(m.icon));
      name.appendChild(document.createTextNode(m.name));
      line.appendChild(name);
      if (id === 'spaced' && spacedDue) line.appendChild(h('span', 'up-pill', 'due'));
      line.appendChild(h('span', 'up-qwhy', dominantReason(state, reg, id, spacedDue)));
      body.appendChild(line);
    }
    row.appendChild(body);
    list.appendChild(row);
  }

  if (!shown) {
    card.appendChild(h('p', 'up-empty', 'Nothing queued for the rest of the week.'));
    return card;
  }
  card.appendChild(list);
  return card;
}

function buildBaselines(state, reg, data) {
  var card = h('div', 'up-card');
  var head = h('div', 'up-card-head');
  head.appendChild(h('h3', null, 'Baselines'));
  head.appendChild(h('span', null, 'first run'));
  card.appendChild(head);

  var ids = Object.keys(reg);
  if (!ids.length) {
    card.appendChild(h('p', 'up-empty', 'No drills loaded.'));
    return card;
  }

  var seen = {};
  var runs = (data && data.runs) || [];
  for (var i = 0; i < runs.length; i++) {
    var id = runs[i].drillId || runs[i].drill_id;
    if (id) seen[id] = 1;
  }
  var recs = (data && data.records) || [];
  for (i = 0; i < recs.length; i++) {
    if (recs[i] && recs[i].drillId) seen[recs[i].drillId] = 1;
  }

  var measured = 0, missing = [];
  for (i = 0; i < ids.length; i++) {
    if (seen[ids[i]]) measured++;
    else missing.push(ids[i]);
  }

  var num = h('div', 'up-bl-num');
  num.appendChild(document.createTextNode(measured + ' of ' + ids.length + ' '));
  num.appendChild(h('span', null, 'drills measured'));
  card.appendChild(num);

  var bar = h('div', 'up-bl-bar');
  bar.setAttribute('aria-hidden', 'true');
  var fill = h('i');
  fill.style.width = Math.round((measured / ids.length) * 100) + '%';
  bar.appendChild(fill);
  card.appendChild(bar);

  if (!missing.length) {
    card.appendChild(h('p', 'up-empty', 'Every drill has a first run on record.'));
    return card;
  }
  card.appendChild(h('span', 'up-bl-sub', 'Needs a first run'));
  var chips = h('div', 'up-chips');
  for (i = 0; i < missing.length; i++) {
    chips.appendChild(h('span', 'up-chip', metaFor(reg, missing[i]).name));
  }
  card.appendChild(chips);
  return card;
}

function buildNext(ctx, state, reg, data, now) {
  var ids = Object.keys(reg);
  if (!ids.length) return null;

  var todayIdx = dayIndexOf(now);
  var plan = planFor(state, ids, todayIdx);
  if (!plan.length) return null;

  /* Prefer the first drill of today's plan not yet run today; otherwise take
     the top of tomorrow's plan. */
  var ranToday = {};
  var sessions = state.sessions || [];
  for (var i = 0; i < sessions.length; i++) {
    if (localDate(msOf(sessions[i])) !== localDate(now)) continue;
    var ds = sessions[i].drills || [];
    for (var j = 0; j < ds.length; j++) ranToday[ds[j]] = 1;
  }
  var pick = null;
  for (i = 0; i < plan.length; i++) {
    if (!ranToday[plan[i]]) { pick = plan[i]; break; }
  }
  if (!pick) {
    var tomorrow = planFor(state, ids, todayIdx + 1);
    pick = tomorrow.length ? tomorrow[0] : plan[0];
  }

  var m = metaFor(reg, pick);
  var spacedDue = cardsDueBy((data && data.cards) || [], startOfDay(now) + DAY - 1) > 0;

  var band = h('div', 'up-next');
  band.appendChild(iconEl(m.icon));
  var main = h('div', 'up-next-main');
  main.appendChild(h('span', 'up-next-label', 'Best next action'));
  main.appendChild(h('div', 'up-next-name', m.name));
  main.appendChild(h('p', 'up-next-why', dominantReason(state, reg, pick, spacedDue)));
  band.appendChild(main);

  var start = h('button', 'btn-primary up-start', 'Start drill');
  start.type = 'button';
  start.setAttribute('aria-label', 'Start ' + m.name);
  start.addEventListener('click', function () {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify({ ids: [pick], interleave: false }));
    } catch (e) { /* degrade to Train's own picker */ }
    if (ctx && typeof ctx.navigate === 'function') ctx.navigate('train');
  });
  band.appendChild(start);
  return band;
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

  var section = h('section', 'up');
  section.setAttribute('aria-label', 'Upcoming');

  var head = h('div', 'up-head');
  head.appendChild(h('h2', null, 'Upcoming'));
  head.appendChild(h('span', 'up-cap', 'due and next'));
  section.appendChild(head);

  var grid = h('div', 'up-grid');
  grid.appendChild(buildRetrieval(data, now));
  grid.appendChild(buildBaselines(state, reg, data));
  section.appendChild(grid);

  section.appendChild(buildQueue(state, reg, data, now));

  var next = buildNext(ctx, state, reg, data, now);
  if (next) section.appendChild(next);

  return section;
}
