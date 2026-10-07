/* Neuralbase view: Circuit.
   Four ways to run: single (Train), daily circuit, custom sequence, adaptive mix.
   Order and interleaving match the MVP: daily/custom/adaptive queue a sequence and hand it
   to Train through a local key, so the run host stays in one place. Gating via Engine. */

var CACHE_KEY = 'cortex.cache.data';
var QUEUE_KEY = 'cortex.train.queue';
var SEQ_KEY = 'cortex.circuit.sequences';
var STYLE_ID = 'nb-circuit-styles';

/* Circuit's own styles, scoped to .cx- so nothing leaks out. The checkbox is a
   real input with appearance:none, so it keeps its keyboard, focus and label
   behavior while matching the panel, border and radius the rest of the app uses.
   Theme tokens only, so all five themes pick it up. */
function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  var s = document.createElement('style');
  s.id = STYLE_ID;
  var check = "url(\"data:image/svg+xml,%3Csvg xmlns='http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg' viewBox='0 0 24 24' fill='none'%3E%3Cpath d='M20 6 9 17l-5-5' stroke='black' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\") center/contain no-repeat";
  s.textContent = [
    ".cx-cb{-webkit-appearance:none;appearance:none;width:24px;height:24px;flex:none;margin:0;display:inline-grid;place-items:center;background:var(--panel2);border:1px solid var(--line2);border-radius:7px;color:var(--lime);cursor:pointer;transition:border-color .15s ease,background-color .15s ease}",
    ".cx-cb:hover{border-color:var(--lime-edge)}",
    ".cx-cb::after{content:\"\";width:13px;height:13px;background:currentColor;opacity:0;transition:opacity .12s ease;-webkit-mask:" + check + ";mask:" + check + "}",
    ".cx-cb:checked{background:var(--lime-soft);border-color:var(--lime-edge)}",
    ".cx-cb:checked::after{opacity:1}",
    ".cx-cb:focus-visible{outline:2px solid var(--lime);outline-offset:2px}",
    ".cx-cb:disabled{opacity:.45;cursor:not-allowed}",
    ".cx-cb:disabled:hover{border-color:var(--line2)}",
    "@media (forced-colors:active){.cx-cb{forced-color-adjust:none;background-color:Canvas;border-color:CanvasText;color:CanvasText}.cx-cb:checked{background-color:Highlight;border-color:Highlight;color:HighlightText}.cx-cb:disabled{color:GrayText;border-color:GrayText}}",
    /* One rhythm: --cx-sec between cards, --cx-in inside a card. Replaces the
       generic .mt the cards used to carry so every gap matches. */
    ".cx{--cx-sec:14px;--cx-in:12px}",
    ".cx .card+.card{margin-top:var(--cx-sec)}",
    ".cx .card-head{margin-bottom:var(--cx-in);flex-wrap:wrap}",
    ".cx .programs{margin-top:var(--cx-in)}",
    ".cx .row-actions{margin-top:var(--cx-in)}",
    /* Two checkbox columns fit at 560 and up; below that they crowd, and the
       shared .programs rule cannot win against .cb-list on its own. */
    ".cx .cb-row{min-width:0}",
    "@media (max-width:560px){.cx-list{grid-template-columns:1fr}}"
  ].join('');
  document.head.appendChild(s);
}

function h(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function drillById(id) {
  var D = (globalThis.Content && globalThis.Content.DRILLS) || [];
  for (var i = 0; i < D.length; i++) if (D[i].id === id) return D[i];
  return { id: id, name: 'Legacy run', icon: '', desc: '' };
}
/* The drill's mark, drawn in currentColor. Markup is our own static SVG string. */
function iconEl(d) {
  var s = h('span', 'drill-ic');
  s.setAttribute('aria-hidden', 'true');
  if (d && d.icon) s.innerHTML = d.icon;
  return s;
}
function planOf(ctx) { return ctx && ctx.profile && ctx.profile.plan === 'pro' ? 'pro' : 'free'; }
function readCache() {
  try { var raw = localStorage.getItem(CACHE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function normRun(r) {
  return {
    drillId: r.drill_id || r.drillId, value: Number(r.value), unit: r.unit || '',
    t: typeof r.t === 'number' ? r.t : (Date.parse(r.created_at || '') || 0), meta: r.meta || null
  };
}
function readSequences() {
  try {
    var raw = localStorage.getItem(SEQ_KEY);
    var parsed = raw ? JSON.parse(raw) : null;
    if (parsed && parsed.length && parsed[0] && parsed[0].length) return parsed[0].slice();
  } catch (e) { /* degrade */ }
  return ['nback', 'ufov', 'spaced'];
}
function saveSequence(sel) {
  try { localStorage.setItem(SEQ_KEY, JSON.stringify([sel.slice()])); } catch (e) { /* degrade */ }
}
function queueRun(ids, interleave) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify({ ids: ids, interleave: !!interleave })); } catch (e) { /* degrade */ }
  if (ctxRef && ctxRef.navigate) ctxRef.navigate('train');
}

var ctxRef = null;
var customSel = ['nback', 'ufov', 'spaced'];
var records = [];

export function render(container, ctx) {
  ctxRef = ctx;
  injectStyles();
  container.classList.add('view', 'view-mid-wide', 'cx');
  container.setAttribute('aria-label', 'Circuit');
  container.innerHTML = '';

  var Engine = globalThis.Engine;
  var plan = planOf(ctx);
  var day = (new Date().getDay() + 6) % 7;
  var ids = Engine.dailyCircuit(day, plan);
  customSel = readSequences();
  var D = (globalThis.Content && globalThis.Content.DRILLS) || [];
  var cached = readCache();
  records = ((cached && cached.runs) || []).map(normRun).filter(function (r) { return r.drillId && isFinite(r.value); });

  /* The topbar owns the view name, so the visible title block is gone. The hidden
     heading keeps the router's focus move and gives screen readers the page name. */
  var title = h('h2', 'view-title sr', 'Circuit');
  title.tabIndex = -1;
  container.appendChild(title);

  var card = h('div', 'card');
  var ch = h('div', 'card-head');
  ch.appendChild(h('h3', null, "Today's circuit"));
  var count = h('span', 'mono cap', ids.length + ' drills');
  ch.appendChild(count);
  var today = h('ul', 'programs');
  for (var i = 0; i < ids.length; i++) {
    var p = drillById(ids[i]);
    var li = h('li');
    var nameWrap = h('span', 'prog-name');
    nameWrap.appendChild(iconEl(p));
    nameWrap.appendChild(h('span', 'pname', p.name));
    li.appendChild(nameWrap);
    li.appendChild(h('span', 'pdesc', p.desc));
    today.appendChild(li);
  }
  var act = h('div', 'row-actions');
  var run = h('button', 'btn-primary', 'Run circuit');
  run.type = 'button';
  act.appendChild(run);
  card.appendChild(ch); card.appendChild(today); card.appendChild(act);
  container.appendChild(card);

  var build = h('div', 'card');
  var bh = h('div', 'card-head');
  bh.appendChild(h('h3', null, 'Build your own'));
  var list = h('ul', 'programs cb-list cx-list');
  for (var k = 0; k < D.length; k++) {
    var d = D[k];
    var locked = !Engine.canAccess(d.id, plan);
    var row = h('li');
    var label = h('label', 'cb-row' + (locked ? ' locked' : ''));
    var cb = document.createElement('input');
    cb.type = 'checkbox'; cb.className = 'cx-cb'; cb.value = d.id; cb.disabled = locked;
    if (!locked && customSel.indexOf(d.id) !== -1) cb.checked = true;
    cb.addEventListener('change', (function (id) {
      return function () {
        if (this.checked) { if (customSel.indexOf(id) === -1) customSel.push(id); }
        else { customSel = customSel.filter(function (x) { return x !== id; }); }
      };
    })(d.id));
    label.appendChild(cb);
    label.appendChild(iconEl(d));
    label.appendChild(document.createTextNode(d.name + (locked ? ' (Pro)' : '')));
    row.appendChild(label);
    list.appendChild(row);
  }
  var bacts = h('div', 'row-actions');
  var custom = h('button', 'btn-primary', 'Run custom');
  custom.type = 'button';
  bacts.appendChild(custom);
  build.appendChild(bh); build.appendChild(list); build.appendChild(bacts);
  container.appendChild(build);

  var adapt = h('div', 'card');
  var ah = h('div', 'card-head');
  ah.appendChild(h('h3', null, 'Adaptive mix'));
  var aacts = h('div', 'row-actions');
  var adaptive = h('button', 'btn-ghost', 'Build adaptive circuit');
  adaptive.type = 'button';
  aacts.appendChild(adaptive);
  adapt.appendChild(ah); adapt.appendChild(aacts);
  container.appendChild(adapt);

  run.addEventListener('click', function () {
    var dd = (new Date().getDay() + 6) % 7;
    queueRun(Engine.dailyCircuit(dd, planOf(ctx)), false);
  });
  custom.addEventListener('click', function () {
    saveSequence(customSel);
    queueRun(customSel.slice(), false);
  });
  adaptive.addEventListener('click', function () {
    queueRun(Engine.adaptiveMix({ records: records }, 3, planOf(ctx)), false);
  });

  if (ctx.db && ctx.db.loadUserData) {
    ctx.db.loadUserData().then(function (res) {
      if (!container.isConnected) return;
      if (res && res.ok && res.data) {
        records = (res.data.runs || []).map(normRun).filter(function (r) { return r.drillId && isFinite(r.value); });
      }
    });
  }
}
