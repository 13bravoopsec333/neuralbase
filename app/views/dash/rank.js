/* Neuralbase dashboard section: rank and rivals.
   build(ctx, data) -> one <section> with its own heading and its own scoped styles.
   It reads the per-drill leaderboard through ctx.api.leaderboard, the call in
   app/lib/api.js, and shows:
     - your rank on each drill you have run;
     - the nearest rival: the person one spot above you on the drill where the
       gap to close is smallest, their value, and that gap;
     - your strongest and weakest drills by rank.

   The board returns rank, username, best_value and is_me, and nothing about
   history, so week-over-week movement and the biggest climb cannot be derived.
   Rather than invent them, the rank card says movement is not kept. When the
   leaderboard is not reachable the section says so and shows no ranks. Usernames
   are set with textContent, never innerHTML. */

import { h, drillRegistry, metaFor } from '../dashboard.js';

var STYLE_ID = 'cortex-dash-rank-styles';

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  var s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = [
    '.dash-rank{display:flex;flex-direction:column;gap:var(--gap-3);min-width:0}',
    '.dr-title{margin:0;font-size:16px;font-weight:600;letter-spacing:-.01em}',
    '.dr-body{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:var(--gap-3);align-items:start;min-width:0}',
    '.dr-note{margin:0;font-size:13px;color:var(--dim);line-height:1.5}',
    '.dr-card,.dr-stand{min-width:0}',

    /* rank tiles */
    '.dr-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--gap-2)}',
    '.dr-tile{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:9px 10px;display:flex;flex-direction:column;gap:6px;min-width:0}',
    '.dr-tile-name{font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.dr-tile-rank{font-family:var(--mono);font-size:22px;font-weight:500;letter-spacing:-.02em;line-height:1;color:var(--ink);font-variant-numeric:tabular-nums}',
    '.dr-tile-rank .h{font-size:13px;color:var(--dim)}',
    '.dr-move-note{margin:11px 0 0;font-size:12px;color:var(--dim);line-height:1.45}',

    '.dr-side{display:flex;flex-direction:column;gap:var(--gap-3);min-width:0}',

    /* nearest rival */
    '.dr-rival{background:var(--panel);border:1px solid var(--lime-edge);border-radius:var(--r);padding:12px 14px;min-width:0}',
    '.dr-rival-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:9px;flex-wrap:wrap}',
    '.dr-rival-head .k{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}',
    '.dr-rival-head .d{font-size:12px;font-weight:600}',
    '.dr-rival-body{display:flex;align-items:center;gap:11px;min-width:0;flex-wrap:wrap}',
    '.dr-av{width:34px;height:34px;flex:none;border-radius:8px;display:grid;place-items:center;font-family:var(--mono);font-size:12px;font-weight:500;background:var(--lime-soft);border:1px solid var(--lime-edge);color:var(--lime)}',
    '.dr-rival-meta{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}',
    '.dr-rival-meta b{font-size:13.5px;overflow-wrap:break-word}',
    '.dr-rival-meta span{font-size:12px;color:var(--muted);line-height:1.4}',
    '.dr-rival-gap{margin-left:auto;text-align:right;flex:none}',
    '.dr-rival-gap b{display:block;font-family:var(--mono);font-size:20px;font-weight:500;line-height:1;color:var(--lime);font-variant-numeric:tabular-nums}',
    '.dr-rival-gap span{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}',

    /* strongest and weakest */
    '.dr-stand-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:9px;flex-wrap:wrap}',
    '.dr-stand-head h3{margin:0;font-size:13px;font-weight:600;letter-spacing:.01em}',
    '.dr-cols{display:grid;grid-template-columns:1fr 1fr;gap:var(--gap-3)}',
    '.dr-col-h{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}',
    '.dr-col ul{list-style:none;margin:7px 0 0;padding:0;display:flex;flex-direction:column;gap:5px}',
    '.dr-col li{font-size:12px;color:var(--ink);padding-left:15px;position:relative;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.dr-col li::before{content:"";position:absolute;left:0;top:5px;width:8px;height:8px;border-radius:2px;background:var(--line2)}',
    '.dr-col.up li::before{background:var(--lime)}',
    '.dr-col.down li::before{background:var(--warn)}',

    '.dr-foot{margin-top:var(--gap-3)}',
    '.dr-more{padding:7px 13px;font-size:13px;font-weight:600}',

    '@media(max-width:900px){.dr-body{grid-template-columns:minmax(0,1fr)}}',
    '@media(max-width:560px){.dr-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dr-cols{grid-template-columns:1fr}.dr-rival-gap{margin-left:0;text-align:left}}'
  ].join('');
  document.head.appendChild(s);
}

/* ---------------- helpers ---------------- */

function drillOf(r) {
  return r ? (r.drillId || r.drill_id || null) : null;
}

function distinctDrills(runs) {
  var seen = {}, out = [];
  for (var i = 0; i < runs.length; i++) {
    var id = drillOf(runs[i]);
    if (id && !seen[id]) { seen[id] = 1; out.push(id); }
  }
  return out;
}

/* Same shape the leaderboard view prints: ms as a time, n-back as a level. */
function formatValue(m, v) {
  if (v == null || v === '' || !isFinite(Number(v))) return '--';
  var n = Number(v);
  if (m.id === 'ufov' || m.unit === 'ms') return n + ' ms';
  if (m.id === 'nback') return 'level ' + n;
  return n + (m.unit ? ' ' + m.unit : '');
}

function formatNum(v) {
  if (!isFinite(v)) return '--';
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
}

function gapUnit(m) {
  if (m.id === 'ufov' || m.unit === 'ms') return 'ms to close';
  if (m.id === 'nback') return 'levels to close';
  return (m.unit ? m.unit + ' to close' : 'to close');
}

function initials(name) {
  var s = String(name == null ? '' : name).trim();
  if (!s) return '?';
  var parts = s.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!parts.length) return s.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/* ---------------- blocks ---------------- */

function rankCard(reg, entries) {
  var c = h('div', 'card dr-card');
  var head = h('div', 'card-head');
  head.appendChild(h('h3', null, 'Your rank by drill'));
  head.appendChild(h('span', 'cap', 'all-time board'));
  c.appendChild(head);

  var grid = h('div', 'dr-grid');
  for (var i = 0; i < entries.length; i++) {
    var m = metaFor(reg, entries[i].id);
    var tile = h('article', 'dr-tile');
    var name = h('span', 'dr-tile-name', m.name);
    name.title = m.name;
    tile.appendChild(name);
    var rk = h('div', 'dr-tile-rank');
    rk.appendChild(h('span', 'h', '#'));
    rk.appendChild(document.createTextNode(String(entries[i].me.rank)));
    tile.appendChild(rk);
    grid.appendChild(tile);
  }
  c.appendChild(grid);
  c.appendChild(h('p', 'dr-move-note',
    'Week-over-week movement is not shown because the app does not keep rank history.'));
  return c;
}

function rivalCard(reg, entries) {
  var pick = null, bestRel = Infinity;
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (!e.above) continue;
    var m = metaFor(reg, e.id);
    var a = Number(e.above.bestValue), mv = Number(e.me.bestValue);
    if (!isFinite(a) || !isFinite(mv)) continue;
    var gap = m.direction === 'lower' ? mv - a : a - mv;
    if (!isFinite(gap) || gap < 0) gap = 0;
    var rel = gap / Math.max(Math.abs(a), 1e-9);
    if (rel < bestRel) { bestRel = rel; pick = { m: m, above: e.above, gap: gap }; }
  }
  if (!pick) return null;

  var c = h('section', 'dr-rival');
  c.setAttribute('aria-label', 'Nearest rival and the gap to close');
  var head = h('div', 'dr-rival-head');
  head.appendChild(h('span', 'k', 'Closest rival'));
  head.appendChild(h('span', 'd', pick.m.name));
  c.appendChild(head);

  var body = h('div', 'dr-rival-body');
  var av = h('span', 'dr-av', initials(pick.above.username));
  av.setAttribute('aria-hidden', 'true');
  body.appendChild(av);

  var meta = h('span', 'dr-rival-meta');
  meta.appendChild(h('b', null, String(pick.above.username)));
  meta.appendChild(h('span', null,
    'holds ' + formatValue(pick.m, pick.above.bestValue) + ', one spot above you'));
  body.appendChild(meta);

  var gapBox = h('span', 'dr-rival-gap');
  gapBox.appendChild(h('b', null, formatNum(pick.gap)));
  gapBox.appendChild(h('span', null, gapUnit(pick.m)));
  body.appendChild(gapBox);
  c.appendChild(body);
  return c;
}

function standCol(label, dir, entries, reg) {
  var col = h('div', 'dr-col ' + dir);
  col.appendChild(h('span', 'dr-col-h', label));
  var ul = h('ul');
  for (var i = 0; i < entries.length; i++) {
    var m = metaFor(reg, entries[i].id);
    var li = h('li', null, m.name);
    li.title = m.name;
    ul.appendChild(li);
  }
  col.appendChild(ul);
  return col;
}

function standCard(reg, entries) {
  var c = h('section', 'card dr-stand');
  c.setAttribute('aria-label', 'Your strongest and weakest drills by rank');
  var head = h('div', 'dr-stand-head');
  head.appendChild(h('h3', null, 'Where you stand'));
  head.appendChild(h('span', 'cap', 'highest and lowest'));
  c.appendChild(head);

  var sorted = entries.slice().sort(function (a, b) { return a.me.rank - b.me.rank; });
  var n = sorted.length;
  var strongN = Math.min(3, Math.ceil(n / 2));
  var weakN = Math.min(3, Math.floor(n / 2));

  var cols = h('div', 'dr-cols');
  cols.appendChild(standCol('Strongest', 'up', sorted.slice(0, strongN), reg));
  if (weakN > 0) cols.appendChild(standCol('Weakest', 'down', sorted.slice(n - weakN).reverse(), reg));
  c.appendChild(cols);
  return c;
}

/* ---------------- async fill ---------------- */

function fill(ctx, reg, drills, body) {
  var api = ctx.api;
  return Promise.all(drills.map(function (id) {
    return Promise.resolve()
      .then(function () { return api.leaderboard(id, 'all'); })
      .then(function (rows) { return { id: id, rows: Array.isArray(rows) ? rows : null }; })
      .catch(function () { return { id: id, rows: null }; });
  })).then(function (results) {
    var entries = [], failed = 0;
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (!r.rows) { failed++; continue; }
      var me = null, j;
      for (j = 0; j < r.rows.length; j++) if (r.rows[j] && r.rows[j].isMe) me = r.rows[j];
      if (!me) continue;
      var above = null;
      for (j = 0; j < r.rows.length; j++) {
        if (r.rows[j] && r.rows[j].rank === me.rank - 1) { above = r.rows[j]; break; }
      }
      entries.push({ id: r.id, me: me, above: above });
    }

    if (!entries.length) {
      body.replaceChildren(h('p', 'dr-note', failed
        ? 'Ranks could not be loaded right now.'
        : 'You are not on a board yet. Finish a run to enter one.'));
      return;
    }
    entries.sort(function (a, b) { return a.me.rank - b.me.rank; });

    body.replaceChildren();
    body.appendChild(rankCard(reg, entries));
    var side = h('div', 'dr-side');
    var rival = rivalCard(reg, entries);
    if (rival) side.appendChild(rival);
    side.appendChild(standCard(reg, entries));
    body.appendChild(side);
  }).catch(function () {
    body.replaceChildren(h('p', 'dr-note', 'Ranks could not be loaded right now.'));
  });
}

/* ---------------- build ---------------- */

export function build(ctx, data) {
  injectStyles();
  var reg = drillRegistry();
  var section = h('section', 'dash-rank');
  section.setAttribute('aria-label', 'Your rank and rivals');
  section.appendChild(h('h2', 'dr-title', 'Rank and rivals'));

  var body = h('div', 'dr-body');
  section.appendChild(body);

  var api = ctx && ctx.api;
  var runs = (data && Array.isArray(data.runs)) ? data.runs : [];
  var drills = distinctDrills(runs);

  if (!api || typeof api.leaderboard !== 'function') {
    body.appendChild(h('p', 'dr-note', 'Rank data is not available offline. Sign in to see where you stand.'));
    return section;
  }
  if (!drills.length) {
    body.appendChild(h('p', 'dr-note', 'No runs yet, so there is no rank to show.'));
    return section;
  }

  var loading = h('p', 'dr-note', 'Loading your ranks...');
  body.appendChild(loading);
  fill(ctx, reg, drills, body);

  if (ctx && typeof ctx.navigate === 'function') {
    var foot = h('div', 'dr-foot');
    var b = h('button', 'btn-ghost dr-more', 'See full leaderboards');
    b.type = 'button';
    b.addEventListener('click', function () { ctx.navigate('leaderboards'); });
    foot.appendChild(b);
    section.appendChild(foot);
  }
  return section;
}
