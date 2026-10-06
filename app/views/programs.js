/* Neuralbase view: Programs.
   Browse the drills and start one. Selection starts the drill in Train through the
   local select key. Gating via Engine; best/attempts read from cloud data. */

var CACHE_KEY = 'cortex.cache.data';
var SELECT_KEY = 'cortex.train.select';

function h(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* Scoped styles: the detail card's inner gaps had drifted (9, 14, 16), so they
   read one value here. Theme tokens only. */
function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById('nb-programs-styles')) return;
  var s = document.createElement('style');
  s.id = 'nb-programs-styles';
  s.textContent = [
    '.prg{--prg-sec:14px;--prg-in:12px}',
    '.prg .prog-grid{gap:var(--prg-sec)}',
    '.prg .detail-head{margin-bottom:var(--prg-in)}',
    '.prg .detail-sec{margin-top:var(--prg-in)}',
    '.prg .detail-stats{margin-top:var(--prg-in)}',
    '.prg .detail-empty{margin:var(--prg-in) 0 0}',
    '.prg .detail-actions{margin-top:var(--prg-in)}'
  ].join('');
  document.head.appendChild(s);
}
function drillById(id) {
  var D = (globalThis.Content && globalThis.Content.DRILLS) || [];
  for (var i = 0; i < D.length; i++) if (D[i].id === id) return D[i];
  return { id: id, name: 'Legacy run', icon: '', desc: '', trains: '', works: '', pro: false, direction: 'lower', unit: '' };
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

var ui = {};
var ctxRef = null;
var state = { records: [], sessions: [], days: [] };
var selectedProg = 'nback';

function paintDetail() {
  var Engine = globalThis.Engine;
  var Store = globalThis.Store;
  var p = drillById(selectedProg);
  var locked = !Engine.canAccess(p.id, planOf(ctxRef));
  if (ui.detailName) ui.detailName.textContent = p.name;
  if (ui.detailIcon) ui.detailIcon.innerHTML = p.icon || '';
  if (ui.detailStatus) {
    ui.detailStatus.textContent = locked ? 'Pro' : 'Available';
    ui.detailStatus.className = 'status-tag ' + (locked ? 'dev' : 'available');
  }
  if (ui.detailTrains) ui.detailTrains.textContent = p.trains;
  if (ui.detailWorks) ui.detailWorks.textContent = p.works;
  var a = Store.aggregate(state, p.id, p.direction);
  if (ui.detailBest) ui.detailBest.textContent = a.best != null ? String(a.best) : '--';
  if (ui.detailAttempts) ui.detailAttempts.textContent = String(a.attempts);
  if (ui.detailEmpty) ui.detailEmpty.hidden = a.attempts > 0;
  if (ui.detailStart) {
    ui.detailStart.disabled = false;
    ui.detailStart.textContent = locked ? 'Go Pro' : 'Train';
  }
  var items = ui.list ? ui.list.querySelectorAll('.prog-item') : [];
  for (var i = 0; i < items.length; i++) {
    if (items[i].getAttribute('data-prog') === selectedProg) items[i].setAttribute('aria-current', 'true');
    else items[i].removeAttribute('aria-current');
  }
}

function buildDOM(container) {
  container.innerHTML = '';
  /* The topbar owns the view name, so the visible title block is gone. The hidden
     heading keeps the router's focus move and gives screen readers the page name. */
  var title = h('h2', 'view-title sr', 'Programs');
  title.tabIndex = -1;
  container.appendChild(title);

  var grid = h('div', 'prog-grid');
  var list = h('ul', 'prog-list');
  var Engine = globalThis.Engine;
  var D = (globalThis.Content && globalThis.Content.DRILLS) || [];
  for (var i = 0; i < D.length; i++) {
    (function (p) {
      var li = h('li');
      var b = h('button', 'prog-item');
      b.type = 'button';
      b.setAttribute('data-prog', p.id);
      var top = h('span', 'prog-top');
      var nameWrap = h('span', 'prog-name');
      nameWrap.appendChild(iconEl(p));
      nameWrap.appendChild(h('span', 'pname', p.name));
      top.appendChild(nameWrap);
      var locked = !Engine.canAccess(p.id, planOf(ctxRef));
      var tag = h('span', 'status-tag ' + (locked ? 'dev' : 'available'), locked ? 'Pro' : 'Available');
      top.appendChild(tag);
      b.appendChild(top);
      b.appendChild(h('span', 'pdesc', p.desc));
      b.addEventListener('click', function () { selectedProg = p.id; paintDetail(); });
      li.appendChild(b);
      list.appendChild(li);
    })(D[i]);
  }

  var detail = h('div', 'card');
  var dh = h('div', 'detail-head');
  var dtitle = h('span', 'detail-title');
  var dicon = h('span', 'drill-ic');
  dicon.setAttribute('aria-hidden', 'true');
  var dn = h('h3', 'detail-name', 'Executive N-Back');
  dtitle.appendChild(dicon); dtitle.appendChild(dn);
  var ds = h('span', 'status-tag available', 'Available');
  dh.appendChild(dtitle); dh.appendChild(ds);
  var sec1 = h('div', 'detail-sec');
  sec1.appendChild(h('span', 'detail-l', 'What it trains'));
  var dt = h('p', 'detail-copy', '');
  sec1.appendChild(dt);
  var sec2 = h('div', 'detail-sec');
  sec2.appendChild(h('span', 'detail-l', 'How it works'));
  var dw = h('p', 'detail-copy', '');
  sec2.appendChild(dw);
  var dstats = h('div', 'detail-stats');
  var bestCell = h('div', 'stat');
  bestCell.appendChild(h('span', 'stat-l', 'Your best'));
  var dbest = h('span', 'stat-v mono', '--');
  bestCell.appendChild(dbest);
  var attCell = h('div', 'stat');
  attCell.appendChild(h('span', 'stat-l', 'Attempts'));
  var datt = h('span', 'stat-v mono', '0');
  attCell.appendChild(datt);
  dstats.appendChild(bestCell); dstats.appendChild(attCell);
  var dempty = h('p', 'detail-empty', 'No runs yet.');
  var dactions = h('div', 'detail-actions');
  var dstart = h('button', 'btn-primary', 'Train');
  dstart.type = 'button';
  dactions.appendChild(dstart);
  detail.appendChild(dh); detail.appendChild(sec1); detail.appendChild(sec2);
  detail.appendChild(dstats); detail.appendChild(dempty); detail.appendChild(dactions);

  grid.appendChild(list); grid.appendChild(detail);
  container.appendChild(grid);

  ui = { list: list, detailName: dn, detailIcon: dicon, detailStatus: ds, detailTrains: dt, detailWorks: dw, detailBest: dbest, detailAttempts: datt, detailEmpty: dempty, detailStart: dstart };

  dstart.addEventListener('click', function () {
    var p = drillById(selectedProg);
    if (!globalThis.Engine.canAccess(p.id, planOf(ctxRef))) { if (ctxRef.navigate) ctxRef.navigate('pricing'); return; }
    try { localStorage.setItem(SELECT_KEY, p.id); } catch (e) { /* degrade */ }
    if (ctxRef.navigate) ctxRef.navigate('train');
  });
}

export function render(container, ctx) {
  ctxRef = ctx;
  container.classList.add('view', 'view-mid-wide', 'prg');
  container.setAttribute('aria-label', 'Programs');
  injectStyles();
  buildDOM(container);
  var cached = readCache();
  state = { records: ((cached && cached.runs) || []).map(normRun).filter(function (r) { return r.drillId && isFinite(r.value); }), sessions: [], days: [] };
  paintDetail();

  if (ctx.db && ctx.db.loadUserData) {
    ctx.db.loadUserData().then(function (res) {
      if (!container.isConnected) return;
      if (res && res.ok && res.data) {
        state = { records: (res.data.runs || []).map(normRun).filter(function (r) { return r.drillId && isFinite(r.value); }), sessions: [], days: [] };
        paintDetail();
      }
    });
  }
}
