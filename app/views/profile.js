/* Neuralbase view: Profile.
   render(container, ctx) fills the profile section.

   One body, two callers:
     - no requested id: your own account. It goes through the same
       db.fetchPublicProfile call a visitor would make, so the not-shared states
       you read here are the states other people read.
     - an id left in localStorage['cortex.profile.view'] by a leaderboard row:
       somebody else's profile.

   Every field the owner chose to hide arrives null, and null renders as one plain
   sentence saying so. A zero is printed only when the server sent a zero, because
   "0" and "withheld" mean different things here and only the server knows which it
   sent. See settings.js for the toggles that decide it.

   Another person's display name, handle and bio are untrusted text and are set
   with textContent only. The avatar goes in as a src attribute, never as markup,
   and only from an http(s) or base64 image URL. */

import { h, drillRegistry, metaFor, iconEl, localDate } from './dashboard.js';
import { isDemo } from '../lib/supabase.js';

var VIEW_KEY = 'cortex.profile.view';
var STYLE_ID = 'nb-profile-styles';
var MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
var ACTIVITY_WINDOW = 30;
var ANON = 'Anonymous';
/* The username can be changed once every 30 days. The database enforces this with a
   trigger; this constant is the client mirror so demo mode (no trigger) behaves the
   same and the person is told the date instead of being bounced by an error. */
var USERNAME_COOLDOWN_MS = 30 * 86400000;

/* ---------------- scoped styles (theme tokens only) ---------------- */

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  var s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = [
    /* The card grid: identity, then the shared activity underneath. */
    '.pf{display:block}',
    '.pf-stack{display:flex;flex-direction:column;gap:14px;margin-top:4px}',
    '.pf-nav{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}',
    '.pf-note{margin:0;font-size:12px;color:var(--dim);line-height:1.5}',
    '.pf-foot{margin:0;padding-top:12px;border-top:1px solid var(--line);font-size:12px;color:var(--dim);line-height:1.5}',

    /* A withheld section reads as absent, not as a box of zeros. The left rule is
       the only mark: same weight as a divider, no empty frame to mistake for data. */
    '.pf-off{margin:0;font-size:13px;color:var(--dim);line-height:1.5;border-left:2px solid var(--line2);padding-left:10px}',

    /* Identity. Centered like a masthead, so the picture and the name read as one
       thing before any number does. */
    '.pf-id{text-align:center;display:flex;flex-direction:column;align-items:center;gap:0}',
    '.pf-id-top{display:flex;flex-direction:column;align-items:center;gap:10px}',
    '.pf-av{width:76px;height:76px;flex:none;border-radius:50%;overflow:hidden;background:var(--panel2);border:1px solid var(--line2);display:flex;align-items:center;justify-content:center}',
    '.pf-av-img{width:100%;height:100%;object-fit:cover;display:block}',
    '.pf-av-mono{font-family:var(--mono);font-size:26px;line-height:1;color:var(--muted);letter-spacing:-.02em}',
    '.pf-id-name{margin:0;font-size:20px;font-weight:600;letter-spacing:-.015em;overflow-wrap:anywhere;max-width:100%}',
    '.pf-id-handle{margin:3px 0 0;font-family:var(--mono);font-size:12px;color:var(--dim);overflow-wrap:anywhere}',
    '.pf-bio{margin:12px 0 0;font-size:13px;color:var(--muted);line-height:1.55;max-width:56ch;overflow-wrap:anywhere;white-space:pre-wrap}',
    '.pf-bio.off{color:var(--dim);border-left:2px solid var(--line2);padding-left:10px;text-align:left;display:inline-block}',
    '.pf-tags{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin-top:13px}',
    '.pf-tag-off{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);border:1px dashed var(--line2);padding:3px 6px;border-radius:8px}',

    /* The inline editor. The identity masthead turns into this form in place, so the
       fields stay inside the same card and nothing navigates away. */
    '.pf-edit{display:flex;flex-direction:column;gap:12px;width:100%;max-width:420px;margin:14px auto 0;text-align:left}',
    '.pf-field{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);margin-bottom:5px}',
    '.pf-input,.pf-area{width:100%;background:var(--panel2);border:1px solid var(--line2);color:var(--ink);border-radius:8px;padding:8px 10px;font:inherit}',
    '.pf-input:focus,.pf-area:focus{border-color:var(--lime-edge)}',
    '.pf-area{min-height:84px;resize:vertical;line-height:1.5;font:inherit}',
    '.pf-input[readonly]{color:var(--muted);border-style:dashed}',
    '.pf-edit-note{margin:6px 0 0;font-size:12px;color:var(--dim);line-height:1.5}',
    '.pf-edit-err{margin:0;font-size:12px;color:var(--warn);line-height:1.5}',
    '.pf-edit-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
    '.pf-status{margin:12px 0 0;font-size:12px;color:var(--muted)}',
    '.pf-edit-open{margin-top:14px}',

    /* Best per drill: the same tile as the Progress readout, values to match. */
    '.pf-bests{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:8px}',
    '.pf-best{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:9px 10px;display:flex;flex-direction:column;gap:4px;min-width:0}',
    '.pf-best-top{display:flex;align-items:center;gap:7px;min-width:0}',
    '.pf-best-name{flex:1;font-size:13px;font-weight:600;min-width:0;overflow-wrap:break-word;line-height:1.25}',
    '.pf-best-when{margin-left:auto;flex:none;font-family:var(--mono);font-size:11px;color:var(--dim);font-variant-numeric:tabular-nums;white-space:nowrap}',

    /* Streak readout: two cells in the shared instrument frame. */
    '.pf-read{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));background:var(--panel);border:1px solid var(--line);border-radius:var(--r);overflow:hidden}',
    '.pf-read-l{font-family:var(--mono);font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim)}',

    /* Activity calendar: a row of weekday heads, then one row per week. The grid is
       seven columns of 1fr, so it spans the card at every width instead of leaving
       a void beside a narrow strip. It stays seven columns even for a one day
       account, so a new profile reads the same shape as a full one. Cells shrink
       below 560 so a month still fits 360. */
    '.pf-heat-card{--pf-cell-h:30px;--pf-cell-gap:6px;--pf-cell-r:3px}',
    '.pf-heat-body{display:block}',
    '.pf-heat-head{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:var(--pf-cell-gap);margin-bottom:5px}',
    '.pf-heat-day{font-family:var(--mono);font-size:10px;color:var(--dim);text-align:center;letter-spacing:.04em}',
    '.pf-heat{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:var(--pf-cell-gap)}',
    '.pf-cell{height:var(--pf-cell-h);border-radius:var(--pf-cell-r);border:1px solid var(--line);background:var(--panel2);position:relative}',
    '.pf-cell::after{content:"";position:absolute;inset:1px;border-radius:var(--pf-cell-r);background:var(--accent);opacity:0}',
    '.pf-cell[data-level="1"]::after{opacity:.14}',
    '.pf-cell[data-level="2"]::after{opacity:.2}',
    '.pf-cell[data-level="3"]::after{opacity:.26}',
    '.pf-cell[data-level="4"]::after{opacity:.33}',
    '.pf-cell.today{box-shadow:inset 0 0 0 1px var(--muted)}',
    '.pf-cell.outside{border-style:dotted;border-color:var(--line2)}',
    '.pf-heat-foot{margin-top:11px;padding-top:10px;border-top:1px solid var(--line)}',

    '.pf-err{color:var(--warn)}',
    '@media(max-width:560px){.pf-heat-card{--pf-cell-h:24px;--pf-cell-gap:4px;--pf-cell-r:2px}.pf-bests{grid-template-columns:1fr 1fr}}',
    '@media(max-width:480px){.pf-bests{grid-template-columns:1fr}}'
  ].join('');
  document.head.appendChild(s);
}

/* ---------------- small helpers ---------------- */

/* The requested id is read and cleared in one go, so a later visit to your own
   profile does not land on whoever you looked up last. */
function readRequested() {
  var id = '';
  try {
    id = localStorage.getItem(VIEW_KEY) || '';
    localStorage.removeItem(VIEW_KEY);
  } catch (e) { /* degrade to own profile */ }
  return typeof id === 'string' ? id.trim() : '';
}

/* An image the browser will be asked to load. Anything else is dropped rather than
   written into a src attribute. */
function safeImageUrl(u) {
  var s = String(u == null ? '' : u).trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^data:image\/(png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=\s]+$/i.test(s)) return s;
  return '';
}

/* Accepts both a YYYY-MM-DD day and a full timestamp, because the two arrive from
   different columns. Returns '' for anything unparseable, which callers treat as
   nothing to show rather than as a made-up date. */
function longDate(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return Number(m[3]) + ' ' + MONTH[Number(m[2]) - 1] + ' ' + m[1];
  var d = new Date(s);
  if (isNaN(d.getTime())) return '';
  return d.getDate() + ' ' + MONTH[d.getMonth()] + ' ' + d.getFullYear();
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}

/* A card whose data the owner withheld. One plain line, never an empty frame and
   never a zero. */
function withheld(title, line, cap) {
  var card = h('div', 'card');
  var head = h('div', 'card-head');
  head.appendChild(h('h3', null, title));
  if (cap) head.appendChild(h('span', 'cap', cap));
  card.appendChild(head);
  card.appendChild(h('p', 'pf-off', line));
  return card;
}

function monogram(name) {
  var t = String(name == null ? '' : name).trim();
  var parts = t.split(/\s+/).filter(Boolean);
  var letters = parts.length > 1
    ? parts[0].charAt(0) + parts[parts.length - 1].charAt(0)
    : t.slice(0, 2);
  return h('span', 'pf-av-mono', (letters || '?').toUpperCase());
}

function avatarEl(data, name) {
  var box = h('span', 'pf-av');
  var url = safeImageUrl(data.avatar_url);
  if (!url) {
    box.appendChild(monogram(name));
    return box;
  }
  var img = document.createElement('img');
  img.className = 'pf-av-img';
  img.alt = '';                       /* decorative: the name sits right beside it */
  img.setAttribute('aria-hidden', 'true');
  img.addEventListener('error', function () { box.replaceChildren(monogram(name)); });
  img.src = url;
  box.appendChild(img);
  return box;
}

/* ---------------- identity ---------------- */

/* The next moment the username can change, or null when a change is allowed now.
   Reads the field if it is present on the owner's row and treats its absence as
   "never changed", so an older row without the column still works. The client is
   only mirroring the rule; the database trigger is what actually holds it. */
function cooldownUntil(owner) {
  var raw = owner && owner.username_changed_on;
  if (raw == null || raw === '') return null;
  var t = Date.parse(raw);
  if (isNaN(t)) return null;
  return t + USERNAME_COOLDOWN_MS;
}

/* The database raises `username_cooldown: ...` with the next date interpolated after
   the prefix. Only the prefix is stable, so that is what is matched; the wording the
   person sees is built here rather than echoed, so the internal prefix never reaches
   the screen. */
var COOLDOWN_PREFIX = 'username_cooldown:';

function isCooldownError(message) {
  return typeof message === 'string' && message.indexOf(COOLDOWN_PREFIX) !== -1;
}

/* The client's own wording for the rule. Names the next date when the row carries the
   clock, and states the rule plainly when the field is absent, which is the case
   before the column exists: absent means the first change is allowed. */
function cooldownSentence(owner) {
  var until = cooldownUntil(owner);
  if (until != null && Date.now() < until) {
    return 'You can change your username once every 30 days. Next change available on ' +
      longDate(new Date(until).toISOString()) + '.';
  }
  return 'You can change your username once every 30 days.';
}

function identityCard(data, opts) {
  opts = opts || {};
  var anon = String(data.display_name == null ? '' : data.display_name).trim() === ANON;
  var name = anon ? ANON : String(data.display_name == null ? '' : data.display_name).trim();
  var handle = String(data.username == null ? '' : data.username).trim();

  var card = h('div', 'card pf-id mid-text');

  var top = h('div', 'pf-id-top');
  top.appendChild(avatarEl(data, name));
  if (!opts.editing) {
    var who = h('div');
    who.appendChild(h('p', 'pf-id-name', name || ANON));
    /* An anonymous handle is withheld with the name. Printing one next to the word
       Anonymous would undo the choice it reports. */
    if (anon) who.appendChild(h('p', 'pf-id-handle', 'Trains anonymously.'));
    else who.appendChild(h('p', 'pf-id-handle', handle ? '@' + handle : 'No handle set.'));
    top.appendChild(who);
  }
  card.appendChild(top);

  /* Editing happens here, in the identity area, on this view. No route change and no
     overlay, so the person never loses their place. */
  if (opts.editing) {
    card.appendChild(editForm(opts));
    return card;
  }

  var bio = data.bio == null ? null : String(data.bio);
  if (bio == null) card.appendChild(h('p', 'pf-bio off', 'The bio is not shared.'));
  else if (!bio.trim()) card.appendChild(h('p', 'pf-bio', 'No bio yet.'));
  else card.appendChild(h('p', 'pf-bio', bio));

  var tags = h('div', 'pf-tags');
  var plan = String(data.plan == null ? '' : data.plan).trim();
  if (plan) {
    var tag = h('span', 'status-tag' + (plan.toLowerCase() === 'pro' ? ' available' : ''),
      plan.charAt(0).toUpperCase() + plan.slice(1));
    tags.appendChild(tag);
  }
  var joined = longDate(data.joined_on);
  if (joined) tags.appendChild(h('span', 'status-tag', 'Member since ' + joined));
  else tags.appendChild(h('span', 'pf-tag-off', 'Member since not shared'));
  card.appendChild(tags);

  if (opts.isOwn && opts.onEdit) card.appendChild(editButton(opts.onEdit));
  if (opts.status) card.appendChild(h('p', 'pf-status', opts.status));

  return card;
}

/* The three fields the owner asked for. Display name and bio save whenever the
   person likes. The username is read only while its 30 day cooldown is running, and
   the note says when it comes back rather than letting a save bounce off the
   database. */
function editForm(opts) {
  var owner = opts.owner || {};
  var box = h('div', 'pf-edit');

  var nameWrap = h('div');
  var nameLabel = h('label', 'pf-field', 'Display name');
  nameLabel.setAttribute('for', 'pf-edit-name');
  var nameInput = h('input', 'pf-input');
  nameInput.id = 'pf-edit-name';
  nameInput.type = 'text';
  nameInput.maxLength = 24;
  nameInput.autocomplete = 'off';
  nameInput.value = String(owner.display_name || '');
  nameWrap.appendChild(nameLabel);
  nameWrap.appendChild(nameInput);
  box.appendChild(nameWrap);

  var until = cooldownUntil(owner);
  var blocked = until != null && Date.now() < until;
  var userWrap = h('div');
  var userLabel = h('label', 'pf-field', 'Username');
  userLabel.setAttribute('for', 'pf-edit-username');
  var userInput = h('input', 'pf-input');
  userInput.id = 'pf-edit-username';
  userInput.type = 'text';
  userInput.maxLength = 24;
  userInput.autocomplete = 'off';
  userInput.value = String(owner.username || '');
  userWrap.appendChild(userLabel);
  userWrap.appendChild(userInput);
  var userNote = h('p', 'pf-edit-note', cooldownSentence(owner));
  userNote.id = 'pf-edit-user-note';
  if (blocked) {
    userInput.readOnly = true;
    userInput.setAttribute('aria-describedby', 'pf-edit-user-note');
  }
  userWrap.appendChild(userNote);
  box.appendChild(userWrap);

  var bioWrap = h('div');
  var bioLabel = h('label', 'pf-field', 'Bio');
  bioLabel.setAttribute('for', 'pf-edit-bio');
  var bioInput = h('textarea', 'pf-area');
  bioInput.id = 'pf-edit-bio';
  bioInput.maxLength = 280;
  bioInput.value = String(owner.bio || '');
  bioInput.placeholder = 'A line about what you are training for.';
  bioWrap.appendChild(bioLabel);
  bioWrap.appendChild(bioInput);
  box.appendChild(bioWrap);

  var err = h('p', 'pf-edit-err', opts.err || '');
  err.hidden = !opts.err;
  box.appendChild(err);

  var acts = h('div', 'pf-edit-actions');
  var save = h('button', 'btn-primary pf-edit-save', 'Save changes');
  save.type = 'button';
  save.disabled = !!opts.busy;
  var cancel = h('button', 'btn-ghost pf-edit-cancel', 'Cancel');
  cancel.type = 'button';
  acts.appendChild(save);
  acts.appendChild(cancel);
  box.appendChild(acts);

  save.addEventListener('click', function () { if (opts.onSave) opts.onSave(); });
  cancel.addEventListener('click', function () { if (opts.onCancel) opts.onCancel(); });
  box.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (opts.onCancel) opts.onCancel();
    }
  });

  return box;
}

/* ---------------- account actions ---------------- */

/* The edit control lives inside the identity card, right under the bio, because that
   is the area it turns into a form. Settings already owns the privacy toggles and the
   foot line points there, so the old full width row that only pointed at another page
   is gone. */
function editButton(onEdit) {
  var edit = h('button', 'btn-ghost pf-edit-open', 'Edit profile');
  edit.type = 'button';
  edit.addEventListener('click', function () { if (onEdit) onEdit(); });
  return edit;
}

/* ---------------- bests ---------------- */

function bestsCard(data, reg) {
  var title = 'Personal best in each drill';
  var rows = data.bests;

  if (rows == null) return withheld(title, 'Personal bests are not shared.');

  if (!Array.isArray(rows)) return withheld(title, 'Personal bests are not shared.');

  var usable = rows.filter(function (r) {
    return r && typeof r === 'object' && numOrNull(r.best) != null;
  });
  if (!usable.length) {
    return withheld(title, 'No personal bests are shared yet.');
  }
  /* A drill the client cannot name is dropped rather than printed as its raw id, so
     a slug never reaches a public profile. The server joins public.drills, so this
     only bites on stale local data with an id the app no longer ships. */
  var named = usable.filter(function (r) { return r.drillId && reg[r.drillId]; });
  if (!named.length) {
    return withheld(title, 'No personal bests to show.');
  }

  var card = h('div', 'card');
  var head = h('div', 'card-head');
  head.appendChild(h('h3', null, title));
  card.appendChild(head);

  var grid = h('div', 'pf-bests');
  named.forEach(function (r) {
    var m = metaFor(reg, r.drillId);
    var box = h('div', 'pf-best');
    var top = h('div', 'pf-best-top');
    top.appendChild(iconEl(m.icon));
    top.appendChild(h('span', 'pf-best-name', m.name));
    /* The bare date sits at the top right of the card. The score itself is gone,
       so there is no "best on" to prefix it with. */
    top.appendChild(h('span', 'pf-best-when', longDate(r.achievedOn) || 'No date'));
    box.appendChild(top);
    grid.appendChild(box);
  });
  card.appendChild(grid);
  return card;
}

/* ---------------- streak ---------------- */

function streakCard(ctx, data) {
  var title = 'Streak';
  var streak = numOrNull(data.streak);
  var longest = numOrNull(data.longest_streak);
  if (streak == null && longest == null) {
    return withheld(title, 'Streak is not shared.');
  }

  var card = h('div', 'card');
  var head = h('div', 'card-head');
  head.appendChild(h('h3', null, title));
  card.appendChild(head);

  var read = h('div', 'nb-readout pf-read');
  [
    ['Current', streak],
    ['Longest', longest]
  ].forEach(function (pair) {
    var cell = h('div', 'nb-readout-cell');
    cell.appendChild(h('span', 'pf-read-l', pair[0]));
    var v = h('span', 'nb-readout');
    if (pair[1] == null) {
      /* Withheld reads as a dash with the reason in the caption. Printing 0 here
         would say the streak ended, which is a different claim entirely. */
      v.textContent = '--';
    } else if (ctx.motion && typeof ctx.motion.countUp === 'function') {
      ctx.motion.countUp(v, pair[1], { duration: 420 });
    } else {
      v.textContent = String(pair[1]);
    }
    cell.appendChild(v);
    cell.appendChild(h('span', 'cap', pair[1] == null ? 'not shared' : (pair[1] === 1 ? 'day' : 'days')));
    read.appendChild(cell);
  });
  card.appendChild(read);
  return card;
}

/* ---------------- sessions per day ---------------- */

/* Only days the server actually sent become bars. A key it left out is not
   evidence of a day with no session, so it is not drawn as one. */
function dayKeys(map) {
  var out = [];
  Object.keys(map).forEach(function (k) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
    var n = numOrNull(map[k]);
    if (n == null || n < 0) return;
    out.push({ key: k, n: n });
  });
  out.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
  return out;
}

/* ---------------- month activity ---------------- */

function mondayIndex(d) {
  return (d.getDay() + 6) % 7;
}

/* Whole days from one YYYY-MM-DD to another, inclusive, so the day an account was
   created counts as day one. Null for anything unparseable. */
function daysInclusive(a, b) {
  var x = Date.parse(String(a == null ? '' : a) + 'T00:00:00');
  var y = Date.parse(String(b == null ? '' : b) + 'T00:00:00');
  if (isNaN(x) || isNaN(y)) return null;
  var n = Math.floor((y - x) / 86400000) + 1;
  return n > 0 ? n : 1;
}

/* The account age in days, from the joined date the server shares. It is the same
   field the identity card prints as "Member since". Null when the owner hid it, and
   nothing is derived from a hidden field to stand in for it. */
function accountAgeDays(joinedOn) {
  var key = String(joinedOn == null ? '' : joinedOn).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  return daysInclusive(key, localDate(Date.now()));
}

/* The shared bucket helper, so a day reads the same shade here as on Progress. */
function heatBuckets(n, max) {
  if (globalThis.Store && typeof globalThis.Store.heatmapBuckets === 'function') {
    return globalThis.Store.heatmapBuckets(n, max);
  }
  if (n <= 0 || max <= 0) return 0;
  var lv = Math.ceil((n / max) * 4);
  return lv < 1 ? 1 : lv > 4 ? 4 : lv;
}

/* The activity card draws whichever activity the server shared: the 30 day array
   when it is there, otherwise the same counts from the 90 day sessions map,
   narrowed to the same window. A withheld field is never read, so the card says
   "not shared" rather than reaching for the other one. */
function activitySource(data) {
  var rows = data.activity_30d;
  if (Array.isArray(rows)) {
    var out = [];
    rows.forEach(function (r) {
      if (!r || typeof r !== 'object') return;
      var key = String(r.key == null ? '' : r.key);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
      var n = numOrNull(r.n);
      if (n == null || n < 0) return;
      out.push({ key: key, n: n });
    });
    out.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
    return { ok: true, days: out };
  }
  if (rows == null) {
    var map = data.sessions_per_day;
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      return { ok: true, days: dayKeys(map).slice(-ACTIVITY_WINDOW) };
    }
  }
  return { ok: false, days: [] };
}

/* One activity card, not two. It answers how many days were trained and draws a
   calendar of the window. The grid is seven weekday columns wide, so it spans the
   card at any width and a one day account still reads as a full week rather than a
   lone strip. The shade is a quiet presence tint; the caption counts active days
   against the account age, not against the number of days that happened to be
   shared. */
function activityCard(data) {
  var title = 'Activity';
  var src = activitySource(data);
  if (!src.ok) return withheld(title, 'Activity is not shared.');

  var days = src.days;
  if (!days.length) return withheld(title, 'No activity is shared for the past month.');

  var byKey = {};
  var max = 0;
  var active = 0;
  var total = 0;
  days.forEach(function (d) {
    byKey[d.key] = d.n;
    if (d.n > max) max = d.n;
    if (d.n > 0) active++;
    total += d.n;
  });

  var today = localDate(Date.now());
  var age = accountAgeDays(data.joined_on);
  var span = daysInclusive(days[0].key, today);
  /* The window we can speak to: the account age when it is known and younger than
     the data window, otherwise the data window itself. */
  var period = age != null ? Math.min(age, ACTIVITY_WINDOW) : (span == null ? days.length : span);

  var caption;
  if (age != null && age <= ACTIVITY_WINDOW) {
    caption = active + ' of ' + age + (age === 1 ? ' day' : ' days') + ' with a session';
  } else if (age != null) {
    caption = active + ' of the last ' + ACTIVITY_WINDOW + ' days with a session';
  } else {
    /* No account age shared, so the earliest shared day is the honest lower bound
       on how long the account has existed. */
    caption = active + ' of at least ' + period + (period === 1 ? ' day' : ' days') + ' with a session';
  }

  /* The first day the window can speak to. A day inside it that the server left out
     is a day with no session, because the server sends every day that had one. A day
     before it, or one still to come, was not shared and is drawn dotted. */
  var windowStart;
  if (age != null) {
    var wd = new Date(Date.parse(today + 'T00:00:00'));
    wd.setDate(wd.getDate() - (period - 1));
    windowStart = localDate(wd.getTime());
  } else {
    windowStart = days[0].key;
  }

  /* Monday of the window's first week through Sunday of today's week, so the grid is
     a whole number of weeks and always seven columns wide. */
  var startD = new Date(Date.parse(windowStart + 'T00:00:00'));
  startD.setDate(startD.getDate() - mondayIndex(startD));
  var endD = new Date(Date.parse(today + 'T00:00:00'));
  endD.setDate(endD.getDate() + (6 - mondayIndex(endD)));

  var card = h('div', 'card pf-heat-card');
  var head = h('div', 'card-head');
  head.appendChild(h('h3', null, title));
  head.appendChild(h('span', 'cap', caption));
  card.appendChild(head);

  var body = h('div', 'pf-heat-body');
  var heads = h('div', 'pf-heat-head');
  heads.setAttribute('aria-hidden', 'true');
  DAY_LABELS.forEach(function (l) {
    heads.appendChild(h('span', 'pf-heat-day', l));
  });
  body.appendChild(heads);

  var grid = h('div', 'pf-heat');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Activity over the last ' + period +
    (period === 1 ? ' day' : ' days') + ', one cell per day');

  var cur = new Date(startD.getTime());
  while (cur.getTime() <= endD.getTime()) {
    var key = localDate(cur.getTime());
    if (key < windowStart || key > today) {
      var blank = h('span', 'pf-cell outside');
      blank.setAttribute('aria-hidden', 'true');
      grid.appendChild(blank);
    } else {
      var n = byKey[key] || 0;
      var cell = h('span', 'pf-cell');
      cell.setAttribute('data-level', String(heatBuckets(n, max)));
      if (key === today) cell.classList.add('today');
      var label = longDate(key) + ', ' + n + (n === 1 ? ' session' : ' sessions');
      cell.setAttribute('aria-label', label);
      cell.title = label;
      grid.appendChild(cell);
    }
    cur.setDate(cur.getDate() + 1);
  }
  body.appendChild(grid);
  card.appendChild(body);

  /* The foot is the key the grid no longer gives by itself, plus a busiest day only
     when one day really stands out from the typical training day. Fragments are
     joined with a space so the sentences never run together. */
  var parts = ['A filled cell is a day with a session, a dotted cell is a day that was not shared.'];
  var typical = active ? Math.round(total / active) : 0;
  if (max >= 2 && max > typical) {
    parts.push('Busiest day: ' + max + ' sessions, against ' + typical + ' on a typical day.');
  }
  var foot = h('div', 'pf-heat-foot');
  foot.appendChild(h('p', 'pf-note', parts.join(' ')));
  card.appendChild(foot);
  return card;
}

/* ---------------- render ---------------- */

export async function render(container, ctx) {
  if (!container || !container.ownerDocument) return;
  ctx = ctx || {};
  injectStyles();

  var db = ctx.db || {};
  var profile = ctx.profile || (ctx.state && ctx.state.profile) || {};
  var user = ctx.user || {};
  var navigate = typeof ctx.navigate === 'function' ? ctx.navigate : null;
  var requested = readRequested();
  var myId = String((user && user.id) || (profile && profile.user_id) || '').trim();
  var isOwn = !requested || (myId && requested === myId);
  var reg = drillRegistry();

  var live = h('div', 'sr');
  live.setAttribute('aria-live', 'polite');

  container.replaceChildren();

  /* The centered column comes from styles.css (.content centers itself, .view-mid
     caps the measure inside it). Everything below hangs off this one column, so the
     identity masthead, the action block and every card share the same edges. */
  var col = h('div', 'view-mid pf');
  container.appendChild(col);

  /* The topbar owns the view name, so the visible title block is gone. The hidden
     heading keeps the router's focus move and still tells a screen reader that
     this is your own profile when it is. */
  var title = h('h2', 'view-title sr', isOwn ? 'Your profile' : 'Profile');
  title.tabIndex = -1;
  col.appendChild(title);

  /* A visitor gets the short way back to where they came from. Your own profile has
     no back step: the actions block below is the way to change anything. */
  if (!isOwn) {
    var navRow = h('div', 'pf-nav');
    var back = h('button', 'btn-ghost', 'Back to leaderboards');
    back.type = 'button';
    back.addEventListener('click', function () { if (navigate) navigate('leaderboards'); });
    navRow.appendChild(back);
    col.appendChild(navRow);
  }

  var stack = h('div', 'pf-stack');
  col.appendChild(stack);
  col.appendChild(live);

  var demo = isDemo();

  /* Everything the view paints lives in this one object, so the inline editor can
     switch the identity card between its read and edit shapes and repaint the rest
     unchanged. */
  var state = { data: null, note: '', owner: null, editing: false, busy: false, err: '', status: '' };

  function byId(id) { return container.querySelector('#' + id); }

  function repaint() {
    stack.replaceChildren();
    stack.appendChild(identityCard(state.data, {
      isOwn: isOwn,
      editing: state.editing,
      owner: state.owner,
      err: state.err,
      busy: state.busy,
      status: state.status,
      onEdit: openEditor,
      onSave: saveEditor,
      onCancel: cancelEditor
    }));
    stack.appendChild(bestsCard(state.data, reg));
    stack.appendChild(streakCard(ctx, state.data));
    stack.appendChild(activityCard(state.data));
    if (state.note) stack.appendChild(h('p', 'pf-foot', state.note));
  }

  function ownFallback() {
    /* No public call available (older build, or a demo without one): show the
       account fields and say plainly that the activity sections are unreadable
       rather than painting empties that read as real values. */
    var d = {
      user_id: myId,
      username: profile.username || '',
      display_name: profile.display_name || '',
      avatar_url: profile.avatar_url || null,
      bio: profile.bio == null ? null : profile.bio,
      plan: profile.plan || null,
      joined_on: profile.joined_on || profile.created_at || null,
      bests: null,
      streak: null,
      longest_streak: null,
      sessions_per_day: null,
      activity_30d: null
    };
    return d;
  }

  /* The owner's own row carries the username cooldown clock, which the public
     payload does not. Read it fresh so the editor sees the current value. */
  async function openEditor() {
    var row = null;
    if (typeof db.getProfile === 'function') {
      try {
        var res = await db.getProfile();
        if (res && res.ok && res.data) row = res.data;
      } catch (e) { /* fall back to the context profile below */ }
    }
    if (!row) row = profile || {};
    state.owner = {
      display_name: row.display_name == null ? '' : String(row.display_name),
      username: row.username == null ? '' : String(row.username),
      bio: row.bio == null ? '' : String(row.bio),
      username_changed_on: row.username_changed_on == null ? null : row.username_changed_on
    };
    state.editing = true;
    state.err = '';
    state.status = '';
    repaint();
    var first = byId('pf-edit-name');
    if (first) { try { first.focus({ preventScroll: true }); } catch (e) { try { first.focus(); } catch (e2) { /* best effort */ } } }
  }

  function cancelEditor() {
    state.editing = false;
    state.err = '';
    repaint();
    var btn = container.querySelector('.pf-edit-open');
    if (btn) { try { btn.focus({ preventScroll: true }); } catch (e) { /* best effort */ } }
  }

  function setErr(msg) {
    state.err = msg;
    var err = container.querySelector('.pf-edit-err');
    if (err) { err.textContent = msg; err.hidden = !msg; }
    if (msg) live.textContent = msg;
  }

  /* Best effort re-read of the owner's cooldown clock, so a server block that the
     local mirror did not predict is reflected instead of guessed. */
  function refreshCooldown(done) {
    if (typeof db.getProfile !== 'function') { done(); return; }
    Promise.resolve(db.getProfile()).then(function (res) {
      if (res && res.ok && res.data && res.data.username_changed_on != null) {
        state.owner.username_changed_on = res.data.username_changed_on;
      }
    }).catch(function () { /* keep the value we have */ }).then(done);
  }

  /* Lock the username in place without repainting, so the name and bio the person
     already typed are not thrown away. */
  function lockUsername() {
    var userEl = byId('pf-edit-username');
    if (userEl) {
      userEl.readOnly = true;
      userEl.value = String((state.owner && state.owner.username) || '');
    }
    var note = container.querySelector('#pf-edit-user-note');
    if (note) note.textContent = cooldownSentence(state.owner);
  }

  /* Save whatever changed. Display name and bio go straight through. A username
     change is checked against the same 30 day rule the database holds, so the person
     is told the next date here instead of being bounced by the trigger. */
  function saveEditor() {
    var nameEl = byId('pf-edit-name');
    var userEl = byId('pf-edit-username');
    var bioEl = byId('pf-edit-bio');
    if (!nameEl || !userEl || !bioEl) return;
    var owner = state.owner || {};
    var name = nameEl.value.trim();
    var uname = userEl.value.trim();
    var bio = bioEl.value.trim();

    if (name.length < 2 || name.length > 24) {
      setErr('Use 2 to 24 characters for the display name.');
      return;
    }

    var changedUser = uname !== String(owner.username || '');
    var until = cooldownUntil(owner);
    if (changedUser && until != null && Date.now() < until) {
      setErr(cooldownSentence(owner));
      return;
    }
    if (changedUser && !uname) { setErr('A username is needed.'); return; }

    var patch = {};
    if (name !== String(owner.display_name || '')) patch.display_name = name;
    if (bio !== String(owner.bio || '')) patch.bio = bio;
    if (changedUser) patch.username = uname;
    /* Demo has no trigger, so the mirror writes the clock itself. Live leaves the
       column to the database, which owns it. */
    if (changedUser && demo) patch.username_changed_on = new Date().toISOString();

    if (!Object.keys(patch).length) {
      state.editing = false;
      state.status = 'No changes to save.';
      repaint();
      live.textContent = 'No changes to save.';
      return;
    }
    if (typeof db.updateProfile !== 'function') {
      setErr('Profile editing is unavailable in this build.');
      return;
    }

    var saveBtn = container.querySelector('.pf-edit-save');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }
    state.err = '';

    Promise.resolve(db.updateProfile(patch)).then(function (res) {
      if (res && res.ok === false) {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save changes'; }
        /* The database blocked a rename the local mirror did not expect (a stale
           clock). Match the prefix, refresh the clock, and say the rule in our own
           words rather than echoing the raw server string. */
        if (isCooldownError(res.error)) {
          refreshCooldown(function () {
            setErr(cooldownSentence(state.owner));
            lockUsername();
          });
          return;
        }
        setErr(res.error || 'Could not save.');
        return;
      }
      applySaved(patch);
      state.editing = false;
      state.err = '';
      state.status = 'Saved.';
      repaint();
      live.textContent = 'Profile saved.';
    }).catch(function (e) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save changes'; }
      setErr((e && e.message) || 'Could not save.');
    });
  }

  /* Keep the painted payload and the context profile in step with what was written,
     without inventing a value the server did not confirm. */
  function applySaved(patch) {
    var has = function (k) { return Object.prototype.hasOwnProperty.call(patch, k); };
    if (state.data) {
      if (has('display_name') && state.data.display_name !== ANON) state.data.display_name = patch.display_name;
      if (has('bio') && state.data.bio != null) state.data.bio = patch.bio;
      if (has('username')) state.data.username = patch.username;
    }
    if (profile && typeof profile === 'object') {
      if (has('display_name')) profile.display_name = patch.display_name;
      if (has('bio')) profile.bio = patch.bio;
      if (has('username')) profile.username = patch.username;
      if (has('username_changed_on')) profile.username_changed_on = patch.username_changed_on;
    }
  }

  function paint(data, note) {
    state.data = data;
    state.note = note;
    state.editing = false;
    state.err = '';
    repaint();
  }

  if (typeof db.fetchPublicProfile !== 'function') {
    paint(ownFallback(), 'Activity sections are not readable in this build, so they read as not shared.');
    return;
  }

  var id = requested || myId;
  var res;
  try {
    res = id ? await db.fetchPublicProfile(id) : null;
  } catch (e) {
    res = { ok: false, error: (e && e.message) || 'error' };
  }
  if (!container.isConnected) return;

  if (!res || res.ok === false || !res.data) {
    if (isOwn) {
      /* Own profile with no answer: the account fields still come from ctx, so
         show those and name the failure instead of an empty page. */
      paint(ownFallback(), 'Activity sections could not be loaded just now, so they read as not shared.');
      return;
    }
    stack.replaceChildren();
    var err = h('div', 'card');
    err.appendChild(h('h3', null, 'Profile unavailable'));
    err.appendChild(h('p', 'pf-off pf-err', 'This profile could not be loaded. It may have been removed, or it may be private.'));
    if (navigate) {
      var retry = h('button', 'btn-ghost', 'Back to leaderboards');
      retry.type = 'button';
      retry.style.marginTop = '12px';
      retry.addEventListener('click', function () { navigate('leaderboards'); });
      err.appendChild(retry);
    }
    stack.appendChild(err);
    live.textContent = 'That profile could not be loaded.';
    return;
  }

  var d = res.data || {};
  d.user_id = d.user_id || id;
  if (requested && myId && d.user_id === myId) isOwn = true;

  /* The server decides what is shared, so nothing here writes a local cache of it.
     The foot line is the only claim the view makes, and it is the honest one. */
  paint(d, isOwn
    ? 'You control each part in Settings. A hidden section says so instead of showing a zero.'
    : 'Sections this person has hidden say so rather than showing a zero.');
}

export default render;
