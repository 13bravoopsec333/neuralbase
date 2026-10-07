/* Neuralbase study view: the memorization surface.

   The first screen answers two questions and nothing else: how many cards are
   due, and how do I start. One number, one button, one plain line.

   Everything else (adding a card, statistics, the forecast, the retention
   target, the deck list) lives behind one "Card tools" disclosure, and the
   importer sits behind a second disclosure inside it, so nothing is in the way
   until the learner asks for it.

   The review flow is the card, a way to show the answer, then the grade
   choices. Two grades by default (Again, Good); the finer two are a setting.

   ctx = { user, profile, db, api, audio, themes, motion, navigate }

   app/spacing.js stays the source of truth for every schedule number. This file
   only calls Spacing and Importer, and it never re-derives a schedule. All text
   is set with textContent, never innerHTML, so imported and pasted card content
   can never become markup. */

var DAY = 86400000;
var STYLE_ID = "nb-study-styles";
var FORECAST_DAYS = 14;

/* Device local preferences only: the retention target and whether the finer
   grades are shown. Neither is card state, so neither shadows the database. */
var RETENTION_KEY = "cortex.study.retention";
var GRADES_ALL_KEY = "cortex.study.allgrades";

var RETENTION_MIN = 0.7;
var RETENTION_MAX = 0.995;
var SUSPEND_DAYS = 365;

var GRADE_NAMES = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };
/* Again and Good cover most reviews. Hard and Easy only nudge the next gap, so
   they sit behind a setting rather than in front of every learner. */
var DEFAULT_GRADES = [1, 3];
var ALL_GRADES = [1, 2, 3, 4];

var STATE_LABELS = {
  new: "new",
  learning: "learning",
  relearning: "relearning",
  review: "review",
  suspended: "suspended"
};

/* ---------------- tiny DOM helpers ---------------- */

function h(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
}

function str(v) { return v == null ? "" : String(v); }

function num(v, fallback) {
  var n = Number(v);
  return isFinite(n) ? n : fallback;
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function uid() {
  try {
    if (globalThis.crypto && globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  } catch (e) { /* fall through */ }
  return "c" + Date.now().toString(36) + Math.random().toString(16).slice(2, 8);
}

function readJSON(key, fallback) {
  try {
    var raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}

function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* degrade */ }
}

function S() { return globalThis.Spacing || null; }
function IMP() { return globalThis.Importer || null; }

/* ---------------- number and date formatting ---------------- */

function fmtSpan(ms, long) {
  var v = Number(ms);
  if (!isFinite(v) || v < 0) v = 0;
  var m = v / 60000;
  if (m < 1) return long ? "under a minute" : "0m";
  if (m < 90) {
    var mm = Math.round(m);
    return long ? mm + (mm === 1 ? " minute" : " minutes") : mm + "m";
  }
  var hours = m / 60;
  if (hours < 36) {
    var hh = Math.round(hours * 10) / 10;
    return long ? hh + (hh === 1 ? " hour" : " hours") : hh + "h";
  }
  var days = v / DAY;
  if (days < 45) {
    var dd = Math.round(days * 10) / 10;
    return long ? dd + (dd === 1 ? " day" : " days") : dd + "d";
  }
  if (days < 400) {
    var mo = Math.round(days / 30.44);
    return long ? mo + (mo === 1 ? " month" : " months") : mo + "mo";
  }
  var yr = Math.round((days / 365.25) * 10) / 10;
  return long ? yr + (yr === 1 ? " year" : " years") : yr + "y";
}

function fmtDate(ms) {
  var d = new Date(ms);
  if (isNaN(d.getTime())) return "no date";
  var Store = globalThis.Store;
  var key = Store && typeof Store.iso === "function" ? Store.iso(d) : d.toISOString().slice(0, 10);
  return key;
}

function dueWord(ms, now) {
  if (ms <= now) return "due now";
  return "in " + fmtSpan(ms - now, true);
}

function msOf(v, fallback) {
  if (typeof v === "number") return isFinite(v) ? v : fallback;
  if (typeof v === "string" && v) {
    var p = Date.parse(v);
    if (!isNaN(p)) return p;
  }
  return fallback;
}

/* One card in the view's own shape. The cloud and the demo store both hand back
   rows, so front, back, card_type, last_review, and client_id all arrive in
   snake case with ISO dates. */
function normCard(raw) {
  var c = raw || {};
  var id = c.id || c.client_id || uid();
  return {
    id: String(id),
    clientId: c.clientId || c.client_id || "",
    front: str(c.front),
    back: str(c.back),
    note: c.note == null ? "" : str(c.note),
    cardType: c.cardType || c.card_type || "basic",
    hint: c.hint == null ? "" : str(c.hint),
    due: msOf(c.due, Date.now()),
    lastReview: c.lastReview == null && c.last_review == null ? null : msOf(c.lastReview != null ? c.lastReview : c.last_review, null),
    stability: num(c.stability, 0),
    difficulty: num(c.difficulty, 0),
    reps: num(c.reps, 0),
    lapses: num(c.lapses, 0),
    state: c.state || "new",
    seen: num(c.seen, 0),
    correct: num(c.correct, 0),
    suspended: c.suspended === true
  };
}

function cardFromImport(raw, now) {
  var sp = S();
  var c = normCard(raw);
  c.id = uid();
  c.clientId = c.id;
  if (!sp) {
    c.due = now;
    return c;
  }
  var made = sp.newCard(c.front, c.back, now, {
    id: c.id,
    note: c.note,
    cardType: c.cardType
  });
  made.hint = c.hint;
  made.clientId = c.id;
  return made;
}

/* ---------------- scoped styles, theme tokens only ---------------- */

function injectStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  var s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = [
    ".sd{display:block;max-width:680px;margin-inline:auto;--sd-gap:14px;--sd-pad:18px;--sd-in:12px}",
    ".sd-stack{display:flex;flex-direction:column;gap:var(--sd-gap)}",
    ".sd .card{padding:var(--sd-pad)}",

    /* ---- the due count: the loudest thing on the page ---- */
    ".sd-hero{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;padding:28px var(--sd-pad)}",
    ".sd-hero-kicker{margin:0;font-family:var(--mono);font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim)}",
    ".sd-hero-n{--nb-readout:76px;color:var(--ink)}",
    ".sd-hero-line{margin:0;font-size:14px;line-height:1.55;color:var(--muted);max-width:44ch}",
    ".sd-hero-cta{margin-top:6px}",
    ".sd-hero-cta .btn-primary{font-size:15px;padding:12px 22px}",

    /* ---- the review flow: one card, one reveal, the grades ---- */
    ".sd-review{border-color:var(--line2)}",
    ".sd-stage{display:flex;flex-direction:column;gap:12px}",
    ".sd-left{margin:0;font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim)}",
    ".sd-well{display:flex;flex-direction:column;gap:10px;justify-content:center;background:var(--panel2);border:1px solid var(--line2);border-radius:var(--r);padding:18px;min-height:96px}",
    ".sd-front{margin:0;font-size:clamp(18px,2.6vw,22px);font-weight:600;letter-spacing:-.01em;line-height:1.35;overflow-wrap:anywhere;white-space:pre-wrap}",
    ".sd-back{margin:0;font-size:14px;line-height:1.5;overflow-wrap:anywhere;white-space:pre-wrap;border-top:1px solid var(--line);padding-top:10px}",
    ".sd-mask{background:transparent;border:1px dashed var(--line2);border-radius:8px;padding:0 6px;font-family:var(--mono);font-size:.86em;color:var(--muted);white-space:nowrap}",
    ".sd-note{margin:0;font-size:13px;color:var(--muted);line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}",
    ".sd-notecap{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);display:block;margin-bottom:3px}",
    ".sd-grades{display:grid;gap:8px}",
    ".sd-grade{display:flex;flex-direction:column;align-items:center;gap:3px;background:transparent;border:1px solid var(--line2);border-radius:8px;padding:11px 6px;color:var(--ink);transition:border-color .15s ease,background .15s ease,transform .12s ease}",
    ".sd-grade:hover{border-color:var(--lime-edge);background:var(--lime-soft)}",
    ".sd-grade:active{transform:translateY(1px)}",
    ".sd-grade-name{font-size:15px;font-weight:600;line-height:1.1}",
    ".sd-grade-iv{font-family:var(--mono);font-size:11px;font-variant-numeric:tabular-nums;color:var(--muted)}",
    ".sd-grade:hover .sd-grade-iv{color:var(--ink)}",
    ".sd-empty{margin:0;font-size:14px;color:var(--muted);line-height:1.55;max-width:46ch}",

    /* ---- one disclosure for everything else ---- */
    ".sd-tools{border:1px solid var(--line);border-radius:var(--r);background:var(--panel);overflow:hidden}",
    ".sd-tools>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:15px 16px;font-size:14px;font-weight:600}",
    ".sd-tools>summary::-webkit-details-marker{display:none}",
    ".sd-tools-label{flex:1}",
    ".sd-caret{flex:none;width:9px;height:9px;margin-right:2px;border-right:2px solid var(--dim);border-bottom:2px solid var(--dim);transform:rotate(45deg);transition:transform .2s ease}",
    ".sd-tools[open]>summary .sd-caret{transform:rotate(-135deg)}",
    ".sd-tools-body{display:flex;flex-direction:column;padding:0 16px 16px}",
    ".sd-sub{border-color:var(--line2);background:transparent}",
    ".sd-sub>summary{padding:12px 14px;font-size:13px}",
    ".sd-sec{border-top:1px solid var(--line);padding-top:14px;margin-top:14px}",
    ".sd-sec:first-child{border-top:0;padding-top:0;margin-top:4px}",
    ".sd-sec-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:8px}",
    ".sd-sec-title{margin:0;font-size:13px;font-weight:600;letter-spacing:.01em}",
    ".sd-line{margin:0;font-size:13px;line-height:1.55;color:var(--ink)}",
    ".sd-cap{margin:6px 0 0;font-size:12px;line-height:1.5;color:var(--dim);max-width:56ch}",
    ".sd-pref{display:flex;align-items:flex-start;gap:9px;font-size:13px;line-height:1.5;cursor:pointer}",
    ".sd-pref input{margin-top:2px;accent-color:var(--lime)}",

    /* ---- builder and importer ---- */
    ".sd-field{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);margin-bottom:6px}",
    ".sd-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--sd-in);margin-top:var(--sd-in)}",
    ".sd-cell{min-width:0}",
    ".sd-cell.wide{grid-column:1/-1}",
    ".sd-row select{width:100%;align-self:stretch}",
    ".sd-input,.sd-area{width:100%;background:var(--panel2);border:1px solid var(--line2);color:var(--ink);border-radius:8px;padding:8px 10px;font:inherit}",
    ".sd-input:focus,.sd-area:focus{border-color:var(--lime-edge)}",
    ".sd-area{min-height:110px;resize:vertical;font-family:var(--mono);font-size:13px;line-height:1.6}",
    ".sd-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
    ".sd-fmt{display:flex;gap:5px;flex-wrap:wrap}",
    ".sd-fmt-b{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;padding:5px 8px;border-radius:8px;background:transparent;border:1px solid var(--line2);color:var(--muted);transition:border-color .15s ease,color .15s ease}",
    ".sd-fmt-b:hover{border-color:var(--lime-edge);color:var(--ink)}",
    ".sd-fmt-b[aria-pressed=\"true\"]{color:var(--lime);border-color:var(--lime-edge);background:var(--lime-soft)}",
    ".sd-map{margin:11px 0 0;padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:var(--panel2);font-family:var(--mono);font-size:10px;line-height:1.6;color:var(--muted);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}",
    ".sd-warn-list{list-style:none;margin:9px 0 0;padding:0;display:flex;flex-direction:column;gap:5px}",
    ".sd-warn-list li{display:flex;gap:8px;align-items:baseline;font-size:12px;color:var(--muted);line-height:1.45}",
    ".sd-warn-list .mono{font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--warn);flex:none}",
    ".sd-prev{list-style:none;margin:11px 0 0;padding:0;display:flex;flex-direction:column;gap:5px}",
    ".sd-prev li{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--panel2);min-width:0}",
    ".sd-prev-f{font-size:13px;font-weight:600;line-height:1.35;overflow-wrap:anywhere;white-space:pre-wrap}",
    ".sd-prev-b{font-size:12px;color:var(--muted);line-height:1.45;overflow-wrap:anywhere;white-space:pre-wrap}",
    ".sd-prev-t{font-family:var(--mono);font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--dim)}",
    ".sd-more{font-family:var(--mono);font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:var(--dim);margin-top:7px}",

    /* ---- retention ---- */
    ".sd-range{width:100%;accent-color:var(--lime);margin:2px 0 0;height:22px;background:transparent}",
    ".sd-read{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:4px}",
    ".nb-readout.sd-read-v{--nb-readout:24px}",

    /* ---- card list ---- */
    ".sd-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:4px}",
    ".sd-item{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:10px 11px;display:flex;flex-direction:column;gap:6px;min-width:0}",
    ".sd-item.susp{border-style:dashed;border-color:var(--line2)}",
    ".sd-item-f{font-size:13px;font-weight:600;line-height:1.35;overflow-wrap:anywhere;white-space:pre-wrap}",
    ".sd-item-m{display:flex;flex-wrap:wrap;gap:4px 9px;font-family:var(--mono);font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--dim);font-variant-numeric:tabular-nums}",
    ".sd-item-c{display:flex;gap:6px;flex-wrap:wrap}",
    ".sd-mini{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;padding:4px 7px;border-radius:8px;background:transparent;border:1px solid var(--line2);color:var(--muted);transition:border-color .15s ease,color .15s ease}",
    ".sd-mini:hover{border-color:var(--lime-edge);color:var(--ink)}",
    ".sd-mini.warm{border-color:var(--warn);color:var(--warn)}",
    ".sd-edit{display:flex;flex-direction:column;gap:7px;padding-top:4px;border-top:1px solid var(--line)}",
    ".sd-err{grid-column:1/-1;margin:0;font-size:12px;color:var(--warn);line-height:1.5}",

    "@media(max-width:560px){.sd-hero{padding:22px var(--sd-in)}.sd-hero-n{--nb-readout:58px}.sd-row{grid-template-columns:1fr}.sd-list{grid-template-columns:1fr}.sd-grade-name{font-size:14px}}",
    "@media(prefers-reduced-motion:reduce){.sd *{transition:none!important}}"
  ].join("");
  document.head.appendChild(s);
}

/* ---------------- module state ---------------- */

var ctxRef = null;
var cards = [];
var retention = 0.9;
var session = { ids: [], idx: 0, start: 0, graded: 0, correct: 0 };
var ui = {};
var timers = [];

/* ---------------- persistence ---------------- */

/* Card state goes straight to db.saveCards. saveCards upserts, so a graded
   schedule reaches the store and the database is the only source of truth. */
function persistCards(changed) {
  saveToDb(changed || cards);
}

function findCard(id) {
  for (var i = 0; i < cards.length; i++) if (cards[i].id === id) return cards[i];
  return null;
}

function retentionOf() {
  var raw = Number(readJSON(RETENTION_KEY, null));
  if (isFinite(raw) && raw >= RETENTION_MIN && raw <= RETENTION_MAX) return raw;
  var sp = S();
  return sp && isFinite(sp.DEFAULT_RETENTION) ? sp.DEFAULT_RETENTION : 0.9;
}

function persistRetention(value) {
  writeJSON(RETENTION_KEY, clamp(value, RETENTION_MIN, RETENTION_MAX));
}

function allGradesOn() {
  return readJSON(GRADES_ALL_KEY, false) === true;
}

function activeGrades() {
  return allGradesOn() ? ALL_GRADES : DEFAULT_GRADES;
}

function saveToDb(changed) {
  var db = ctxRef && ctxRef.db;
  if (!db || typeof db.saveCards !== "function") return;
  var rows = Array.isArray(changed) ? changed : [changed];
  if (!rows.length) return;
  try {
    Promise.resolve(db.saveCards(rows)).then(function (res) {
      if (res && res.ok === false) announce("Saved on this device only. The server refused the write.");
    }).catch(function () { /* the local write already happened */ });
  } catch (e) { /* never let a write break the queue */ }
}

/* Remove a card from the store so it does not reappear on the next load. */
function deleteFromDb(id) {
  var db = ctxRef && ctxRef.db;
  if (!db || typeof db.deleteCards !== "function" || !id) return;
  try {
    Promise.resolve(db.deleteCards([id])).catch(function () { /* keep the local removal */ });
  } catch (e) { /* never let a failed delete break the list */ }
}

/* ---------------- spoken state ---------------- */

function announce(text) {
  if (ui.live) ui.live.textContent = text;
}

function sayGrade(name, span, remaining) {
  announce(name + ". Next in " + fmtSpan(span, true) + ". " + remaining +
    (remaining === 1 ? " card" : " cards") + " still due.");
}

/* ---------------- session ---------------- */

function startSession() {
  var sp = S();
  var now = Date.now();
  var ids = sp ? sp.due(cards, now).map(function (c) { return c.id; }) : [];
  session.ids = ids;
  session.idx = 0;
  session.start = ids.length;
  session.graded = 0;
  session.correct = 0;
}

function currentCard() {
  if (session.idx >= session.ids.length) return null;
  return findCard(session.ids[session.idx]);
}

function dueCount() {
  var sp = S();
  return sp ? sp.due(cards, Date.now()).length : 0;
}

function previewsFor(card, now) {
  var sp = S();
  if (!sp) return [];
  var grades = activeGrades();
  var out = [];
  for (var i = 0; i < grades.length; i++) {
    var g = grades[i];
    var graded = sp.grade(card, g, now, { retention: retention });
    out.push({ g: g, name: GRADE_NAMES[g], card: graded, span: Math.max(0, graded.due - now) });
  }
  return out;
}

/* ---------------- cloze ---------------- */

/* Cloze fronts reach the view in two shapes. The importer writes the masked form
   ("the [blank] handles it"), and a card from an Anki export or an older store
   still carries the raw {{c1::answer::hint}} marker. Both mask, and in both the
   answer never reaches the front: only the hint after :: is shown, and a marker
   with no hint reads blank. */
var CLOZE_MASK_RE = /\[([^\]\n]*)\]|\{\{c\d+::([\s\S]*?)\}\}/g;

function renderCloze(text) {
  var frag = document.createDocumentFragment();
  var re = new RegExp(CLOZE_MASK_RE.source, "g");
  var last = 0;
  var m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    var hint;
    if (m[2] != null) {
      var bits = String(m[2]).split("::");
      hint = bits.length > 1 ? bits.slice(1).join("::") : "";
    } else {
      hint = m[1];
    }
    hint = String(hint == null ? "" : hint).trim();
    frag.appendChild(h("span", "sd-mask", hint === "" || hint === "..." ? "blank" : hint));
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
}

/* The shared pattern carries the global flag, so lastIndex has to be cleared
   before each test or a second call starts mid-string. */
function hasCloze(text) {
  CLOZE_MASK_RE.lastIndex = 0;
  return CLOZE_MASK_RE.test(String(text));
}

function frontNode(card) {
  if (card.cardType === "cloze" && hasCloze(card.front)) return renderCloze(card.front);
  return document.createTextNode(card.front);
}

/* ---------------- the due count block ---------------- */

function buildHero() {
  var card = h("section", "card sd-hero");
  card.appendChild(h("p", "sd-hero-kicker", "Cards due now"));

  var number = h("span", "nb-readout sd-hero-n", "0");
  card.appendChild(number);

  var line = h("p", "sd-hero-line", "");
  card.appendChild(line);

  var cta = h("div", "sd-hero-cta");
  var start = h("button", "btn-primary", "Start reviewing");
  start.type = "button";
  cta.appendChild(start);
  card.appendChild(cta);

  start.addEventListener("click", function () {
    if (!cards.length) { openTools(true); return; }
    startSession();
    if (!currentCard()) {
      hideReview();
      announce("Nothing is due right now.");
      return;
    }
    showReview();
    paintWell(true);
    paintHero();
    var left = dueCount();
    announce(left + (left === 1 ? " card" : " cards") + " due. Reviewing.");
  });

  ui.hero = { el: card, num: number, line: line, start: start, cta: cta };
  return card;
}

/* The count, the one plain line, and the label on the button. The button is
   disabled rather than hidden when there is nothing to do, so the place the
   action lives never moves. While the review panel is open the button steps
   aside and the card takes over. */
function paintHero() {
  if (!ui.hero) return;
  var n = dueCount();
  var number = ui.hero.num;
  if (ctxRef.motion && typeof ctxRef.motion.countUp === "function") {
    ctxRef.motion.countUp(number, n, { duration: 420 });
  } else {
    number.textContent = String(n);
  }
  number.setAttribute("aria-label", n + (n === 1 ? " card" : " cards") + " due now");

  var next = null;
  var active = 0;
  for (var i = 0; i < cards.length; i++) {
    if (cards[i].suspended) continue;
    active++;
    if (cards[i].due <= Date.now()) continue;
    if (next === null || cards[i].due < next) next = cards[i].due;
  }

  if (!cards.length) {
    ui.hero.line.textContent = "You have no cards yet.";
    ui.hero.start.textContent = "Add your first card";
    ui.hero.start.disabled = false;
  } else if (n > 0) {
    ui.hero.line.textContent = "";
    ui.hero.start.textContent = "Start reviewing " + n + (n === 1 ? " card" : " cards");
    ui.hero.start.disabled = false;
  } else if (active === 0) {
    ui.hero.line.textContent = "All cards are suspended. Resume one in Card tools.";
    ui.hero.start.textContent = "Nothing due right now";
    ui.hero.start.disabled = true;
  } else {
    ui.hero.line.textContent = next === null
      ? "Nothing is due right now."
      : "Nothing is due right now. Next card " + dueWord(next, Date.now()) + ", on " + fmtDate(next) + ".";
    ui.hero.start.textContent = "Nothing due right now";
    ui.hero.start.disabled = true;
  }
  ui.hero.line.hidden = ui.hero.line.textContent === "";

  ui.hero.cta.hidden = !ui.review.el.hidden;
}

/* ---------------- the review flow ---------------- */

function buildReview() {
  var card = h("section", "card sd-review");
  card.hidden = true;
  var stage = h("div", "sd-stage");
  card.appendChild(stage);
  ui.review = { el: card, stage: stage };
  return card;
}

function showReview() { if (ui.review) ui.review.el.hidden = false; }

function hideReview() {
  if (!ui.review) return;
  ui.review.el.hidden = true;
  paintHero();
}

function paintWell(focus) {
  var sp = S();
  var stage = ui.review.stage;
  var card = currentCard();
  stage.textContent = "";

  if (!sp) {
    stage.appendChild(h("p", "sd-empty", "The scheduler is unavailable on this page."));
    return;
  }
  if (!card) {
    var n = session.graded;
    stage.appendChild(h("p", "sd-empty", n
      ? "You reviewed " + n + (n === 1 ? " card" : " cards") + ". Nothing else is due."
      : "Nothing is due right now."));
    ui.review.well = null;
    ui.review.showBtn = null;
    ui.review.revealed = false;
    ui.review.locked = false;
    return;
  }

  var left = Math.max(0, session.start - session.idx);
  stage.appendChild(h("p", "sd-left", left + (left === 1 ? " card left" : " cards left")));

  var well = h("div", "sd-well");
  well.tabIndex = -1;
  var f = h("p", "sd-front");
  f.appendChild(frontNode(card));
  well.appendChild(f);
  stage.appendChild(well);

  var show = h("button", "btn-primary", "Show answer");
  show.type = "button";
  show.addEventListener("click", function () {
    reveal(card, previewsFor(card, Date.now()), well, stage);
  });
  stage.appendChild(show);

  if (focus) {
    try { well.focus({ preventScroll: true }); } catch (e) { /* focus is best effort */ }
  }
  ui.review.well = well;
  ui.review.showBtn = show;
  ui.review.preview = previewsFor(card, Date.now());
  ui.review.revealed = false;
  ui.review.locked = false;
}

/* The reveal swaps the button for the answer and the grades. The front stays
   put: recall is measured against the prompt. */
function reveal(card, prev, well, stage) {
  ui.review.revealed = true;
  ui.review.preview = prev;
  if (ui.review.showBtn && ui.review.showBtn.parentNode) {
    ui.review.showBtn.parentNode.removeChild(ui.review.showBtn);
  }

  var back = h("p", "sd-back");
  back.appendChild(frontNode({ front: card.back, cardType: card.cardType }));
  well.appendChild(back);
  if (card.note) {
    var noteWrap = h("div");
    noteWrap.appendChild(h("span", "sd-notecap", "note"));
    noteWrap.appendChild(h("p", "sd-note", card.note));
    well.appendChild(noteWrap);
  }
  if (card.cardType === "cloze" && card.hint) {
    var hintWrap = h("div");
    hintWrap.appendChild(h("span", "sd-notecap", "hint"));
    hintWrap.appendChild(h("p", "sd-note", card.hint));
    well.appendChild(hintWrap);
  }

  var row = h("div", "sd-grades");
  row.style.gridTemplateColumns = "repeat(" + prev.length + ",minmax(0,1fr))";
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", "Grade this card");
  for (var i = 0; i < prev.length; i++) row.appendChild(gradeButton(prev[i], card));
  stage.appendChild(row);
  announce("Answer shown. " + prev.length + " choices.");
  var first = row.children[0];
  if (first && first.focus) { try { first.focus({ preventScroll: true }); } catch (e) { /* best effort */ } }
}

function gradeButton(prev, card) {
  var b = h("button", "sd-grade");
  b.type = "button";
  b.setAttribute("data-grade", String(prev.g));
  b.appendChild(h("span", "sd-grade-name", prev.name));
  b.appendChild(h("span", "sd-grade-iv", ""));
  priceGrade(b, prev);
  b.addEventListener("click", function () {
    /* One grade per card. A second click in the same window would grade the same
       card twice and silently drop a queue slot. */
    if (ui.review.locked) return;
    var at = Date.now();
    applyGrade(card, previewOne(card, at, prev.g), at);
  });
  return b;
}

function priceGrade(button, prev) {
  var iv = button.querySelector(".sd-grade-iv");
  if (iv) iv.textContent = prev.span < 60000 ? "in " + fmtSpan(prev.span, true) : "in " + fmtSpan(prev.span, false);
  button.setAttribute("aria-label", prev.name + ", next review " + (prev.span < 60000 ? "in " + fmtSpan(prev.span, true) : "in " + fmtSpan(prev.span, false)));
}

function previewOne(card, now, grade) {
  var prev = previewsFor(card, now);
  for (var i = 0; i < prev.length; i++) if (prev[i].g === grade) return prev[i];
  return prev[0];
}

function relabelGrades(prev) {
  var buttons = ui.review.stage.querySelectorAll(".sd-grade");
  for (var i = 0; i < buttons.length && i < prev.length; i++) priceGrade(buttons[i], prev[i]);
}

function applyGrade(card, prev, now) {
  if (ui.review.locked) return;
  ui.review.locked = true;
  if (!prev) return;

  var next = card;
  for (var i = 0; i < cards.length; i++) if (cards[i].id === card.id) next = cards[i];
  /* Spacing.grade returns the schedule fields only, so the hint, the deck id,
     and the suspended flag ride along from the card being graded. */
  var merged = {};
  var k;
  for (k in next) if (Object.prototype.hasOwnProperty.call(next, k)) merged[k] = next[k];
  for (k in prev.card) if (Object.prototype.hasOwnProperty.call(prev.card, k)) merged[k] = prev.card[k];
  merged.id = next.id;
  merged.clientId = next.clientId || next.id;
  merged.suspended = false;
  merged.cardType = next.cardType;
  merged.hint = next.hint;

  for (var j = 0; j < cards.length; j++) if (cards[j].id === card.id) cards[j] = merged;
  persistCards();
  saveToDb(merged);

  session.graded++;
  if (prev.g >= 3) session.correct++;
  session.idx++;

  var left = Math.max(0, session.start - session.idx);
  sayGrade(prev.name, Math.max(0, merged.due - now), left);

  paintHero();
  paintStats();
  paintForecast();
  paintList();

  if (!currentCard()) {
    hideReview();
    announce("All done. " + session.graded + (session.graded === 1 ? " card reviewed." : " cards reviewed."));
    return;
  }
  paintWell(true);
}

function reducedFlag() {
  return !!(ctxRef.motion && typeof ctxRef.motion.reduced === "function" && ctxRef.motion.reduced());
}

/* ---------------- statistics and forecast, one line each ---------------- */

function paintStats() {
  if (!ui.statsLine) return;
  var sp = S();
  if (!sp) return;
  var r = sp.retention(cards, Date.now());
  ui.statsLine.textContent = r.total + (r.total === 1 ? " card" : " cards") + ". " +
    r.mature + (r.mature === 1 ? " has a gap past three weeks." : " have gaps past three weeks.");
}

function paintForecast() {
  if (!ui.forecastLine) return;
  var sp = S();
  if (!sp) return;
  var counts = sp.forecast(cards, Date.now(), FORECAST_DAYS);
  var total = 0;
  var max = 0;
  for (var i = 0; i < counts.length; i++) {
    total += counts[i];
    if (counts[i] > max) max = counts[i];
  }
  ui.forecastLine.textContent = total === 0
    ? "Nothing is scheduled over the next two weeks."
    : total + (total === 1 ? " review is" : " reviews are") +
      " scheduled over the next two weeks. The heaviest day is " + max +
      (max === 1 ? " card." : " cards.");
}

/* ---------------- section helper ---------------- */

function section(title, cap) {
  var s = h("section", "sd-sec");
  var head = h("div", "sd-sec-head");
  head.appendChild(h("h3", "sd-sec-title", title));
  if (cap) head.appendChild(h("span", "cap", cap));
  s.appendChild(head);
  return s;
}

/* ---------------- builder ---------------- */

function buildBuilder() {
  var sec = section("Add a card", "by hand");

  var row = h("div", "sd-row");

  var typeWrap = h("div", "sd-cell");
  var typeLabel = h("label", "sd-field", "type");
  typeLabel.setAttribute("for", "sd-type");
  var select = h("select", "sd-input");
  select.id = "sd-type";
  var o1 = h("option", null, "Basic");
  o1.value = "basic";
  var o2 = h("option", null, "Cloze");
  o2.value = "cloze";
  select.appendChild(o1);
  select.appendChild(o2);
  typeWrap.appendChild(typeLabel);
  typeWrap.appendChild(select);

  var fWrap = h("div", "sd-cell wide");
  var fLabel = h("label", "sd-field", "front");
  fLabel.setAttribute("for", "sd-front");
  var front = h("input", "sd-input");
  front.id = "sd-front";
  front.type = "text";
  front.autocomplete = "off";
  fWrap.appendChild(fLabel);
  fWrap.appendChild(front);
  row.appendChild(fWrap);

  var bWrap = h("div", "sd-cell wide");
  var bLabel = h("label", "sd-field", "back");
  bLabel.setAttribute("for", "sd-back");
  var back = h("input", "sd-input");
  back.id = "sd-back";
  back.type = "text";
  back.autocomplete = "off";
  bWrap.appendChild(bLabel);
  bWrap.appendChild(back);
  row.appendChild(bWrap);

  row.appendChild(typeWrap);

  var nWrap = h("div", "sd-cell");
  var nLabel = h("label", "sd-field", "note, optional");
  nLabel.setAttribute("for", "sd-note");
  var note = h("input", "sd-input");
  note.id = "sd-note";
  note.type = "text";
  note.autocomplete = "off";
  nWrap.appendChild(nLabel);
  nWrap.appendChild(note);
  row.appendChild(nWrap);

  var err = h("p", "sd-err", "");
  err.hidden = true;
  row.appendChild(err);

  var acts = h("div", "sd-actions");
  acts.style.marginTop = "var(--sd-in)";
  var add = h("button", "btn-primary", "Add card");
  add.type = "button";
  acts.appendChild(add);
  sec.appendChild(row);
  sec.appendChild(acts);

  function fail(message) {
    err.textContent = message;
    err.hidden = false;
  }

  add.addEventListener("click", function () {
    err.hidden = true;
    var sp = S();
    var imp = IMP();
    if (!sp) { fail("The scheduler is unavailable on this page."); return; }
    var f = front.value.trim();
    var b = back.value.trim();
    var n = note.value.trim();
    var now = Date.now();
    var made = [];

    if (select.value === "cloze") {
      if (!imp) { fail("The cloze parser is unavailable on this page."); return; }
      if (!f) { fail("A cloze card needs a sentence with a blank in it."); return; }
      var parsed = imp.parseCloze(f + (b ? "\t" + b : ""));
      if (!parsed.cards.length) {
        var why = parsed.warnings.length ? parsed.warnings[0] : "no cloze markers";
        fail("No card was made. " + why + ". Write the blank as {{c1::answer}}.");
        return;
      }
      for (var i = 0; i < parsed.cards.length; i++) made.push(cardFromImport(parsed.cards[i], now));
    } else {
      if (!f || !b) { fail("Both a front and a back are needed."); return; }
      made.push(cardFromImport({ front: f, back: b, note: n, cardType: "basic" }, now));
    }

    for (var j = 0; j < made.length; j++) {
      if (n && made[j].note === "") made[j].note = n;
      cards.push(made[j]);
    }
    persistCards();
    saveToDb(made);
    front.value = "";
    back.value = "";
    note.value = "";
    front.focus();
    announce(made.length + (made.length === 1 ? " card added." : " cards added.") + " " + dueCount() + " due.");
    afterDeckChange();
  });

  ui.builder = { el: sec, front: front };
  return sec;
}

/* ---------------- importer ---------------- */

var SEPARATOR_NAMES = { "\t": "tab", ",": "comma", ";": "semicolon", "|": "pipe", " ": "space" };

function separatorName(sep) {
  if (!sep) return "tab";
  if (SEPARATOR_NAMES[sep]) return SEPARATOR_NAMES[sep];
  return sep.charAt(0) + " separated";
}

function describeFields(kind, fields) {
  if (!fields) return "no field map";
  if (kind === "cloze") return "cloze";
  if (kind === "anki") {
    return "anki, " + separatorName(fields.separator) +
      (fields.html ? ", html stripped" : "") +
      (fields.deck ? ", deck " + fields.deck : "");
  }
  return separatorName(fields.separator) + ", col " + (fields.frontIndex + 1) + " front, col " +
    (fields.backIndex + 1) + " back" +
    (fields.header && fields.header.length ? ", header row read" : "");
}

function buildImporter() {
  var d = h("details", "sd-tools sd-sub");
  var summary = h("summary");
  summary.appendChild(h("span", "sd-tools-label", "Import a deck"));
  summary.appendChild(h("span", "sd-caret"));
  d.appendChild(summary);

  var sec = h("div", "sd-tools-body");
  d.appendChild(sec);

  var areaWrap = h("div");
  areaWrap.style.marginTop = "0";
  var areaLabel = h("label", "sd-field", "cards");
  areaLabel.setAttribute("for", "sd-paste");
  var area = h("textarea", "sd-area");
  area.id = "sd-paste";
  area.spellcheck = false;
  area.placeholder = "front, back\nfront, back";
  areaWrap.appendChild(areaLabel);
  areaWrap.appendChild(area);
  sec.appendChild(areaWrap);

  var fileWrap = h("div", "sd-actions");
  fileWrap.style.marginTop = "10px";
  var file = h("input", "sd-input");
  file.type = "file";
  file.accept = ".txt,.csv,.tsv,.md,.anki,text/plain,text/csv,text/tab-separated-values";
  file.setAttribute("aria-label", "Choose a card file to import");
  file.style.maxWidth = "260px";
  file.style.fontSize = "12px";
  fileWrap.appendChild(file);
  sec.appendChild(fileWrap);

  var fmtWrap = h("div");
  fmtWrap.style.marginTop = "12px";
  fmtWrap.appendChild(h("span", "sd-field", "format"));
  var fmt = h("div", "sd-fmt");
  var KINDS = [
    { id: "", name: "Auto" },
    { id: "anki", name: "Anki export" },
    { id: "delimited", name: "Delimited" },
    { id: "cloze", name: "Cloze" }
  ];
  var kind = "";
  for (var i = 0; i < KINDS.length; i++) {
    (function (k) {
      var b = h("button", "sd-fmt-b", k.name);
      b.type = "button";
      b.setAttribute("data-format", k.id || "auto");
      b.setAttribute("aria-pressed", k.id === kind ? "true" : "false");
      b.addEventListener("click", function () {
        kind = k.id;
        var all = fmt.querySelectorAll(".sd-fmt-b");
        for (var j = 0; j < all.length; j++) {
          all[j].setAttribute("aria-pressed", all[j].getAttribute("data-format") === (kind || "auto") ? "true" : "false");
        }
        previewImport();
      });
      fmt.appendChild(b);
    })(KINDS[i]);
  }
  fmtWrap.appendChild(fmt);
  sec.appendChild(fmtWrap);

  var map = h("p", "sd-map", "Nothing pasted yet.");
  sec.appendChild(map);

  var warnList = h("ul", "sd-warn-list");
  sec.appendChild(warnList);

  var prev = h("ul", "sd-prev");
  sec.appendChild(prev);

  var more = h("p", "sd-more", "");
  sec.appendChild(more);

  var acts = h("div", "sd-actions");
  acts.style.marginTop = "12px";
  var go = h("button", "btn-primary", "Add cards");
  go.type = "button";
  go.disabled = true;
  var clear = h("button", "btn-ghost", "Clear");
  clear.type = "button";
  acts.appendChild(go);
  acts.appendChild(clear);
  sec.appendChild(acts);

  var parsed = { cards: [], warnings: [], fields: {}, notes: [] };

  function nonBlankLines(text) {
    var raw = String(text).split("\n");
    var n = 0;
    for (var i = 0; i < raw.length; i++) if (raw[i].trim() !== "") n++;
    return n;
  }

  /* A skipped line and a line that parsed with a caveat are both warnings, so
     both are listed with the parser's own wording. The count is kept separate
     because the headline number is how many lines did not become cards. */
  function classify(warnings) {
    var skipped = [];
    var other = [];
    for (var i = 0; i < warnings.length; i++) {
      var text = String(warnings[i]);
      if (/^line \d+: skipped|^row \d+: skipped/i.test(text) ||
          /no cards found|no cloze cards found|no rows found/i.test(text)) skipped.push(text);
      else other.push(text);
    }
    return { skipped: skipped, other: other };
  }

  /* When the parser's own read throws most of the text away, the format control
     is the fix. Every other parser is tried so the suggestion names a real
     number rather than a guess. */
  function bestAlternative(text, used) {
    var imp = IMP();
    if (!imp) return null;
    var names = { anki: "Anki export", delimited: "Delimited", cloze: "Cloze" };
    var best = null;
    ["delimited", "cloze", "anki"].forEach(function (k) {
      if (k === used) return;
      var alt = imp.run(text, { parser: k });
      if (!alt.cards.length) return;
      if (!best || alt.cards.length > best.cards) best = { name: names[k], cards: alt.cards.length };
    });
    return best;
  }

  function previewImport() {
    var imp = IMP();
    parsed = { cards: [], warnings: [], fields: {}, notes: [] };
    warnList.textContent = "";
    prev.textContent = "";
    more.textContent = "";
    go.disabled = true;
    go.textContent = "Add cards";
    var text = area.value;
    if (!text.trim()) {
      map.textContent = "Nothing pasted yet.";
      return;
    }
    if (!imp) {
      map.textContent = "The importer is unavailable on this page.";
      return;
    }
    var out = imp.run(text, kind ? { parser: kind } : undefined);
    parsed = out;
    var used = kind || imp.detect(text);
    var cls = classify(out.warnings || []);
    var lines = nonBlankLines(text);
    var skippedCount = cls.skipped.length;
    var alt = kind ? null : bestAlternative(text, used);

    if (!out.cards.length) {
      map.textContent = "No cards found. " + describeFields(used, out.fields) + ". " +
        skippedCount + " of " + lines + " lines skipped." +
        (alt ? " Reading the same text as " + alt.name + " gives " + alt.cards + " cards." : "");
    } else if (!kind && skippedCount > 0 && skippedCount + out.cards.length >= lines) {
      map.textContent = out.cards.length + (out.cards.length === 1 ? " card" : " cards") +
        " ready, read as " + used + ", with " + skippedCount + " of " + lines + " lines skipped." +
        (alt ? " Reading the same text as " + alt.name + " gives " + alt.cards + " cards." : "");
    } else {
      map.textContent = out.cards.length + (out.cards.length === 1 ? " card" : " cards") +
        " ready · " + describeFields(used, out.fields) +
        (skippedCount
          ? " · " + skippedCount + " line" + (skippedCount === 1 ? "" : "s") + " skipped"
          : "");
    }
    addWarnings(cls.skipped.concat(cls.other));

    if (!out.cards.length) return;

    var shown = Math.min(out.cards.length, 6);
    for (var i = 0; i < shown; i++) {
      var c = out.cards[i];
      var li = h("li");
      li.appendChild(h("span", "sd-prev-t", c.cardType === "cloze" ? "cloze" : "basic"));
      var fEl = h("span", "sd-prev-f");
      if (c.cardType === "cloze" && hasCloze(c.front)) fEl.appendChild(renderCloze(String(c.front)));
      else fEl.textContent = String(c.front);
      li.appendChild(fEl);
      if (c.back) li.appendChild(h("span", "sd-prev-b", String(c.back)));
      prev.appendChild(li);
    }
    if (out.cards.length > shown) {
      more.textContent = "and " + (out.cards.length - shown) + " more in the import";
    }
    go.disabled = false;
    go.textContent = "Add " + out.cards.length + (out.cards.length === 1 ? " card" : " cards");
  }

  function addWarnings(list) {
    var shown = Math.min(list.length, 5);
    for (var i = 0; i < shown; i++) {
      var m = String(list[i]).match(/^(line|row)\s+(\d+)/i);
      var li = h("li");
      li.appendChild(h("span", "mono", m ? m[1] + " " + m[2] : "note"));
      li.appendChild(h("span", null, String(list[i]).replace(/^(line|row)\s+\d+:\s*/i, "")));
      warnList.appendChild(li);
    }
    if (list.length > shown) {
      var rest = h("li");
      rest.appendChild(h("span", "mono", "note"));
      rest.appendChild(h("span", null, "and " + (list.length - shown) + " more lines of the same kind"));
      warnList.appendChild(rest);
    }
  }

  area.addEventListener("input", previewImport);
  file.addEventListener("change", function () {
    var f = file.files && file.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      area.value = String(reader.result || "");
      previewImport();
      announce("File loaded. " + area.value.split("\n").length + " lines read.");
    };
    reader.onerror = function () { announce("That file could not be read."); };
    reader.readAsText(f);
  });

  clear.addEventListener("click", function () {
    area.value = "";
    file.value = "";
    previewImport();
    area.focus();
  });

  go.addEventListener("click", function () {
    var sp = S();
    if (!sp || !parsed.cards.length) return;
    var now = Date.now();
    var made = [];
    for (var i = 0; i < parsed.cards.length; i++) made.push(cardFromImport(parsed.cards[i], now));
    for (var j = 0; j < made.length; j++) cards.push(made[j]);
    persistCards();
    saveToDb(made);
    var skippedCount = classify(parsed.warnings || []).skipped.length;
    var total = nonBlankLines(area.value);
    area.value = "";
    file.value = "";
    previewImport();
    announce(made.length + (made.length === 1 ? " card" : " cards") + " added." +
      (skippedCount ? " " + skippedCount + " of " + total + " lines skipped." : ""));
    afterDeckChange();
  });

  ui.importer = { el: d, area: area };
  return d;
}

/* ---------------- card list ---------------- */

function buildList() {
  var sec = section("Cards", "0");
  var list = h("div", "sd-list");
  sec.appendChild(list);
  ui.list = { el: sec, box: list, count: sec.querySelector(".cap") };
  return sec;
}

function paintList() {
  if (!ui.list) return;
  var box = ui.list.box;
  box.textContent = "";
  var now = Date.now();
  var sorted = cards.slice().sort(function (a, b) {
    if (a.suspended !== b.suspended) return a.suspended ? 1 : -1;
    return a.due - b.due;
  });
  ui.list.count.textContent = cards.length + (cards.length === 1 ? " card" : " cards");
  if (!cards.length) {
    box.appendChild(h("p", "sd-empty", "Nothing here yet."));
    return;
  }
  var shown = Math.min(sorted.length, 40);
  for (var i = 0; i < shown; i++) box.appendChild(listRow(sorted[i], now));
  if (sorted.length > shown) {
    box.appendChild(h("p", "sd-more", "and " + (sorted.length - shown) + " more cards not listed"));
  }
}

function listRow(card, now) {
  var li = h("div", "sd-item" + (card.suspended ? " susp" : ""));
  var f = h("span", "sd-item-f");
  if (card.cardType === "cloze" && hasCloze(card.front)) f.appendChild(renderCloze(card.front));
  else f.textContent = card.front;
  li.appendChild(f);

  var meta = h("div", "sd-item-m");
  meta.appendChild(h("span", null, card.suspended ? "suspended" : (STATE_LABELS[card.state] || card.state)));
  if (card.cardType === "cloze") meta.appendChild(h("span", null, "cloze"));
  meta.appendChild(h("span", null, card.due <= now ? "due now" : "in " + fmtSpan(card.due - now, false)));
  if (card.stability > 0) meta.appendChild(h("span", null, "st " + (Math.round(card.stability * 10) / 10) + "d"));
  meta.appendChild(h("span", null, "rep " + card.reps));
  if (card.lapses > 0) meta.appendChild(h("span", null, "lapse " + card.lapses));
  li.appendChild(meta);

  var controls = h("div", "sd-item-c");
  var edit = h("button", "sd-mini", "Edit");
  edit.type = "button";
  var susp = h("button", "sd-mini", card.suspended ? "Resume" : "Suspend");
  susp.type = "button";
  var del = h("button", "sd-mini", "Delete");
  del.type = "button";
  controls.appendChild(edit);
  controls.appendChild(susp);
  controls.appendChild(del);
  li.appendChild(controls);

  edit.addEventListener("click", function () {
    if (li.querySelector(".sd-edit")) return;
    openEditor(li, card, f, meta, controls);
  });

  susp.addEventListener("click", function () {
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].id !== card.id) continue;
      cards[i].suspended = !cards[i].suspended;
      cards[i].due = cards[i].suspended ? Date.now() + SUSPEND_DAYS * DAY : Date.now();
    }
    persistCards();
    saveToDb(findCard(card.id));
    announce(card.suspended ? "Card suspended." : "Card resumed and due now.");
    afterDeckChange();
  });

  del.addEventListener("click", function () {
    if (del.textContent !== "Confirm") {
      /* Arm rather than confirm with a dialog: destructive stays quiet in the
         list and only turns warm once the user has said yes once. */
      del.textContent = "Confirm";
      del.classList.add("warm");
      var t = setTimeout(function () {
        if (!del.isConnected) return;
        del.textContent = "Delete";
        del.classList.remove("warm");
      }, 3500);
      timers.push(t);
      return;
    }
    del.textContent = "Deleted";
    var id = card.id;
    cards = cards.filter(function (c) { return c.id !== id; });
    deleteFromDb(card.clientId || id);
    session.ids = session.ids.filter(function (x) { return x !== id; });
    if (session.start) session.start = Math.max(session.graded, session.start - 1);
    announce("Card deleted.");
    afterDeckChange();
  });

  return li;
}

function openEditor(li, card, fEl, metaEl, controlsEl) {
  var box = h("div", "sd-edit");

  var fWrap = h("div");
  var fLabel = h("label", "sd-field", "front");
  var fIn = h("input", "sd-input");
  fIn.type = "text";
  fIn.value = card.front;
  fWrap.appendChild(fLabel);
  fWrap.appendChild(fIn);

  var bWrap = h("div");
  var bLabel = h("label", "sd-field", "back");
  var bIn = h("input", "sd-input");
  bIn.type = "text";
  bIn.value = card.back;
  bWrap.appendChild(bLabel);
  bWrap.appendChild(bIn);

  var nWrap = h("div");
  var nLabel = h("label", "sd-field", "note");
  var nIn = h("input", "sd-input");
  nIn.type = "text";
  nIn.value = card.note;
  nWrap.appendChild(nLabel);
  nWrap.appendChild(nIn);

  var acts = h("div", "sd-actions");
  var save = h("button", "sd-mini", "Save");
  save.type = "button";
  var cancel = h("button", "sd-mini", "Cancel");
  cancel.type = "button";
  acts.appendChild(save);
  acts.appendChild(cancel);

  box.appendChild(fWrap);
  box.appendChild(bWrap);
  box.appendChild(nWrap);
  box.appendChild(acts);

  controlsEl.style.display = "none";
  fEl.style.display = "none";
  metaEl.style.display = "none";
  li.appendChild(box);
  fIn.focus();

  function close() {
    if (box.parentNode) box.parentNode.removeChild(box);
    controlsEl.style.display = "";
    fEl.style.display = "";
    metaEl.style.display = "";
  }

  cancel.addEventListener("click", close);

  save.addEventListener("click", function () {
    var front = fIn.value.trim();
    var back = bIn.value.trim();
    if (!front || !back) { announce("Both a front and a back are needed."); return; }
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].id !== card.id) continue;
      cards[i].front = front;
      cards[i].back = back;
      cards[i].note = nIn.value.trim();
    }
    var next = findCard(card.id);
    persistCards();
    if (next) saveToDb(next);
    announce("Card updated.");
    afterDeckChange();
  });
}

/* ---------------- retention target ---------------- */

function buildRetention() {
  var sec = section("How well you want to remember", "scheduler");

  var read = h("div", "sd-read");
  var val = h("span", "nb-readout sd-read-v", "90.0%");
  read.appendChild(val);
  read.appendChild(h("span", "cap", "chance of recall at review"));
  sec.appendChild(read);

  var input = h("input", "sd-range");
  input.type = "range";
  input.min = String(RETENTION_MIN);
  input.max = String(RETENTION_MAX);
  input.step = "0.005";
  input.value = String(retention);
  input.setAttribute("aria-label", "How well you want to remember, from 70 to 99.5 percent");
  input.setAttribute("aria-valuetext", Math.round(retention * 1000) / 10 + " percent");
  sec.appendChild(input);

  sec.appendChild(h("p", "sd-cap", "Higher means shorter gaps and more reviews."));

  input.addEventListener("input", function () {
    retention = clamp(num(input.value, retention), RETENTION_MIN, RETENTION_MAX);
    persistRetention(retention);
    paintRetention();
    /* A target change reprices the open card whether or not the answer shows. */
    var c = currentCard();
    if (!c || !ui.review || !ui.review.revealed) return;
    relabelGrades(previewsFor(c, Date.now()));
  });

  ui.retention = { el: sec, val: val, input: input };
  return sec;
}

function paintRetention() {
  if (!ui.retention) return;
  var pct = Math.round(retention * 1000) / 10;
  ui.retention.val.textContent = pct.toFixed(1) + "%";
  ui.retention.input.value = String(retention);
  ui.retention.input.setAttribute("aria-valuetext", pct + " percent");
}

/* ---------------- grade setting ---------------- */

function buildGradePref() {
  var sec = section("Grade buttons", "review");
  var label = h("label", "sd-pref");
  var cb = h("input");
  cb.type = "checkbox";
  cb.id = "sd-allgrades";
  cb.checked = allGradesOn();
  label.appendChild(cb);
  label.appendChild(h("span", null, "Show all four grade buttons: Again, Hard, Good, Easy"));
  sec.appendChild(label);

  cb.addEventListener("change", function () {
    writeJSON(GRADES_ALL_KEY, cb.checked === true);
    if (ui.review && !ui.review.el.hidden) paintWell(true);
  });
  return sec;
}

/* ---------------- the one disclosure ---------------- */

function buildTools() {
  var d = h("details", "sd-tools");
  var summary = h("summary");
  summary.appendChild(h("span", "sd-tools-label", "Card tools"));
  summary.appendChild(h("span", "sd-caret"));
  d.appendChild(summary);

  var body = h("div", "sd-tools-body");
  d.appendChild(body);
  body.appendChild(buildBuilder());
  body.appendChild(buildImporter());
  body.appendChild(buildStatsSection());
  body.appendChild(buildForecastSection());
  body.appendChild(buildRetention());
  body.appendChild(buildGradePref());
  body.appendChild(buildList());

  ui.tools = { el: d, body: body };
  return d;
}

function buildStatsSection() {
  var sec = section("Your cards");
  var line = h("p", "sd-line", "");
  sec.appendChild(line);
  ui.statsLine = line;
  return sec;
}

function buildForecastSection() {
  var sec = section("Coming up", "two weeks");
  var line = h("p", "sd-line", "");
  sec.appendChild(line);
  ui.forecastLine = line;
  return sec;
}

function openTools(focusFront) {
  if (!ui.tools) return;
  ui.tools.el.open = true;
  if (!focusFront) return;
  try { ui.tools.el.scrollIntoView({ behavior: reducedFlag() ? "auto" : "smooth", block: "start" }); } catch (e) { /* best effort */ }
  if (ui.builder && ui.builder.front) {
    try { ui.builder.front.focus({ preventScroll: true }); } catch (e) { /* best effort */ }
  }
}

/* ---------------- shared repaint ---------------- */

/* Repaint the always-present surfaces after the deck changes, and the review
   panel only when it is open, so a change made in the tools never yanks the
   learner into a review. */
function afterDeckChange() {
  paintHero();
  paintStats();
  paintForecast();
  paintList();
  if (ui.review && !ui.review.el.hidden) {
    if (currentCard()) paintWell(false);
    else hideReview();
  }
}

/* ---------------- render ---------------- */

export async function render(container, ctx) {
  ctx = ctx || {};
  if (!container) return;
  ctxRef = ctx;
  for (var t = 0; t < timers.length; t++) clearTimeout(timers[t]);
  timers = [];

  container.textContent = "";
  injectStyles();

  var root = h("div", "sd view-mid");
  /* The topbar already names the view, so the page does not repeat a title block
     below it. A hidden heading stays for the router's focus move and for screen
     readers, which keeps the region named without the duplicate on screen. */
  var title = h("h2", "view-title sr", "Study");
  title.tabIndex = -1;
  root.appendChild(title);

  var live = h("div", "sr");
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  root.appendChild(live);
  ui = { live: live };

  var sp = S();
  if (!sp) {
    var dead = h("div", "card");
    dead.appendChild(h("p", "sd-empty", "The scheduler did not load on this page. Reload to try again."));
    root.appendChild(dead);
    container.appendChild(root);
    return;
  }

  retention = retentionOf();

  var data = { cards: [] };
  if (ctx.db && typeof ctx.db.loadUserData === "function") {
    try {
      var res = await ctx.db.loadUserData();
      if (res && res.ok && res.data) data = res.data;
    } catch (e) { /* empty defaults are fine */ }
  }
  var raw = Array.isArray(data.cards) ? data.cards : [];
  cards = [];
  var seen = {};
  var i;
  for (i = 0; i < raw.length; i++) {
    if (!raw[i] || typeof raw[i] !== "object") continue;
    var c = normCard(raw[i]);
    if (!c.front && !c.back) continue;
    if (seen[c.id]) continue;
    seen[c.id] = 1;
    cards.push(c);
  }

  /* One number, one button, one line, then the review flow when it is live, then
     everything else behind a single disclosure. */
  var stack = h("div", "sd-stack");
  stack.appendChild(buildHero());
  stack.appendChild(buildReview());
  stack.appendChild(buildTools());
  root.appendChild(stack);
  container.appendChild(root);

  paintHero();
  paintStats();
  paintRetention();
  paintForecast();
  paintList();

  /* Keys work while the review holds focus: space reveals, then a number picks
     the grade in that position. */
  var well = ui.review.el;
  well.addEventListener("keydown", function (ev) {
    if (!ui.review.well) return;
    if (!ui.review.revealed) {
      if (ev.key === " " || ev.key === "Spacebar") {
        ev.preventDefault();
        if (ui.review.showBtn) ui.review.showBtn.click();
      }
      return;
    }
    var idx = parseInt(ev.key, 10);
    var btns = ui.review.stage.querySelectorAll(".sd-grade");
    if (idx >= 1 && idx <= btns.length) {
      ev.preventDefault();
      btns[idx - 1].click();
    }
  });
}
