/* Neuralbase spacing: FSRS-6 scheduler. Pure logic, no dependencies. */
(function () {
  "use strict";

  var DAY = 86400000;

  /* FSRS-6 default weights, w1..w21. */
  var DEFAULT_PARAMS = [
    0.2172, 1.1771, 3.2602, 16.1507, 7.0114, 0.5709, 2.0966, 0.0069, 1.5261,
    0.112, 1.0178, 1.849, 0.1133, 0.3127, 2.2934, 0.2191, 3.0004, 0.7536,
    0.3332, 0.1437, 0.2
  ];

  var GRADES = { AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 };

  var DECAY = -0.5;          /* power law exponent */
  var FACTOR = 19 / 81;      /* keeps R(t) exact at small t */
  var S_MIN = 0.001;         /* stability floor */
  var DEFAULT_RETENTION = 0.9;
  var RELEARN_MS = 10 * 60000; /* short relearning step */
  var MATURE_DAYS = 21;
  /* Ceiling on the scheduled gap. Recalled stability grows multiplicatively, so
     a card graded Easy on every review climbs into the millions of days and the
     due stamp runs past the largest Date, which reads as an invalid date and
     reschedules the card into the past. One year is well past any real review
     horizon. ponytail: a flat cap, not per-deck tuning; raise it if decks ever
     need gaps longer than a year. */
  var MAX_INTERVAL_DAYS = 365;

  var counter = 0;

  function clamp(value, lo, hi) {
    return value < lo ? lo : value > hi ? hi : value;
  }

  function clampDifficulty(d) {
    if (!isFinite(d)) return 1;
    return clamp(d, 1, 10);
  }

  function str(v) { return v == null ? "" : String(v); }

  function num(v, fallback) {
    return typeof v === "number" && isFinite(v) ? v : fallback;
  }

  function paramsOf(card, opts) {
    var o = opts || card || {};
    var p = (o.params && o.params.length >= 21) ? o.params : DEFAULT_PARAMS;
    return p;
  }

  function retentionOf(card, opts) {
    var o = opts || {};
    var r = num(o.retention, num(card && card.retention, DEFAULT_RETENTION));
    return clamp(r, 0.7, 0.995);
  }

  /* Grades accept the legacy boolean: true -> good, false -> again. */
  function gradeOf(g) {
    if (g === true) return GRADES.GOOD;
    if (g === false) return GRADES.AGAIN;
    if (typeof g === "string") {
      var byName = { again: 1, hard: 2, good: 3, easy: 4 };
      if (byName[g.toLowerCase()] != null) return byName[g.toLowerCase()];
    }
    if (typeof g === "number" && isFinite(g)) return clamp(Math.round(g), 1, 4);
    return GRADES.GOOD;
  }

  /* S0(G) = w[G-1] */
  function initialStability(g, params) {
    var w = params || DEFAULT_PARAMS;
    return Math.max(S_MIN, w[gradeOf(g) - 1]);
  }

  /* D0(G) = w4 - e^(w5 * (G-1)) + 1 */
  function initialDifficulty(g, params) {
    var w = params || DEFAULT_PARAMS;
    return clampDifficulty(w[4] - Math.exp(w[5] * (gradeOf(g) - 1)) + 1);
  }

  function nextDifficulty(difficulty, g, params) {
    var w = params || DEFAULT_PARAMS;
    var grade = gradeOf(g);
    var delta = -w[6] * (grade - 3);
    var next;
    if (grade === GRADES.HARD) {
      next = clampDifficulty(difficulty) + delta;
    } else {
      next = clampDifficulty(difficulty) + delta * ((10 - clampDifficulty(difficulty)) / 9);
    }
    if (grade === GRADES.AGAIN) next += w[7] * (initialDifficulty(GRADES.EASY, w) - next);
    return clampDifficulty(next);
  }

  /* R(t) = (1 + FACTOR * t/S)^DECAY, so R(0) = 1. t in days. */
  function retrievability(elapsedDays, stability) {
    var s = num(stability, 0);
    var t = Math.max(0, num(elapsedDays, 0));
    if (s <= 0) return 0;
    return Math.pow(1 + (FACTOR * t) / s, DECAY);
  }

  /* Days until retrievability falls to the target retention, capped so the
     result always stays a date the app can render. */
  function intervalFor(stability, retention) {
    var s = num(stability, 0);
    if (s <= 0) return 0;
    var r = clamp(num(retention, DEFAULT_RETENTION), 0.7, 0.995);
    var days = (s / FACTOR) * (Math.pow(r, 1 / DECAY) - 1);
    if (!isFinite(days) || days < 0) return 0;
    return Math.min(days, MAX_INTERVAL_DAYS);
  }

  function recallStability(s, d, r, grade, w, shortTerm) {
    var stability = Math.max(S_MIN, s);
    if (shortTerm) {
      return Math.max(S_MIN, stability * Math.exp(w[17] * (grade - 3 + w[18])));
    }
    var hard = grade === GRADES.HARD ? w[15] : 1;
    var easy = grade === GRADES.EASY ? w[16] : 1;
    var bump = Math.exp(w[8]) * (11 - d) * Math.pow(stability, -w[9]) *
      (Math.exp((1 - r) * w[10]) - 1) * hard * easy;
    return Math.max(S_MIN, stability * (1 + bump));
  }

  function forgetStability(s, d, r, w, shortTerm) {
    var stability = Math.max(S_MIN, s);
    if (shortTerm) {
      return Math.max(S_MIN, stability * Math.exp(w[17] * (GRADES.AGAIN - 3 + w[18])));
    }
    var long = w[11] * Math.pow(d, -w[12]) *
      (Math.pow(stability + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r));
    return Math.max(S_MIN, long);
  }

  /* Next stability for any card state. Unseen cards start from S0(G). */
  function stabilityAfter(stability, difficulty, r, g, opts) {
    var o = opts || {};
    var w = o.params || DEFAULT_PARAMS;
    var shortTerm = !!o.shortTerm;
    var grade = gradeOf(g);
    var s = num(stability, 0);
    var d = num(difficulty, 0);
    if (s <= 0 || d <= 0) {
      return grade === GRADES.AGAIN ? S_MIN : initialStability(grade, w);
    }
    if (grade === GRADES.AGAIN) return forgetStability(s, d, r, w, shortTerm);
    return recallStability(s, d, r, grade, w, shortTerm);
  }

  function normalize(card) {
    var c = card || {};
    counter++;
    /* retention and params ride along when present. newCard stores both on the
       card, so dropping them here made a per-card retention target and a custom
       weight set silently fall back to the defaults on the first grade. */
    var out = {
      id: c.id || "c" + Date.now() + "_" + counter,
      front: str(c.front),
      back: str(c.back),
      note: str(c.note),
      cardType: c.cardType || "basic",
      due: num(c.due, 0),
      lastReview: typeof c.lastReview === "number" ? c.lastReview : null,
      stability: Math.max(0, num(c.stability, 0)),
      difficulty: num(c.difficulty, 0) > 0 ? clampDifficulty(c.difficulty) : 0,
      reps: Math.max(0, num(c.reps, 0)),
      lapses: Math.max(0, num(c.lapses, 0)),
      state: c.state || "new",
      seen: Math.max(0, num(c.seen, 0)),
      correct: Math.max(0, num(c.correct, 0))
    };
    if (num(c.retention, 0) > 0) out.retention = c.retention;
    if (c.params && c.params.length >= 21) out.params = c.params;
    return out;
  }

  function newCard(front, back, now, opts) {
    var o = opts || {};
    counter++;
    var card = {
      id: o.id || "c" + now + "_" + counter,
      front: str(front),
      back: str(back),
      note: str(o.note),
      cardType: o.cardType || "basic",
      due: num(o.due, now),
      lastReview: typeof o.lastReview === "number" ? o.lastReview : null,
      stability: Math.max(0, num(o.stability, 0)),
      difficulty: num(o.difficulty, 0) > 0 ? clampDifficulty(o.difficulty) : 0,
      reps: Math.max(0, num(o.reps, 0)),
      lapses: Math.max(0, num(o.lapses, 0)),
      state: o.state || "new",
      seen: Math.max(0, num(o.seen, 0)),
      correct: Math.max(0, num(o.correct, 0))
    };
    if (num(o.retention, 0) > 0) card.retention = o.retention;
    if (o.params && o.params.length >= 21) card.params = o.params.slice();
    return card;
  }

  function grade(card, gradeNumber, now, opts) {
    var c = normalize(card);
    /* An absent or bad timestamp would otherwise make dueAt NaN, and a NaN due
       never matches the due query again, so the card silently disappears. */
    var at = num(now, 0);
    var g = gradeOf(gradeNumber);
    var w = paramsOf(c, opts);
    var retention = retentionOf(c, opts);
    var last = typeof c.lastReview === "number" ? c.lastReview : null;
    var elapsed = last == null ? 0 : Math.max(0, (at - last) / DAY);
    var shortTerm = last != null && Math.round(elapsed) === 0;
    var unseen = c.stability <= 0 || c.difficulty <= 0;
    var r = unseen ? 0 : retrievability(elapsed, c.stability);
    var d0 = unseen ? initialDifficulty(g, w) : c.difficulty;
    var stability = stabilityAfter(unseen ? 0 : c.stability, unseen ? 0 : d0, r, g, {
      params: w,
      shortTerm: shortTerm
    });
    var difficulty = nextDifficulty(d0, g, w);
    var interval = intervalFor(stability, retention);
    var state, dueAt;
    if (g === GRADES.AGAIN) {
      state = "relearning";
      dueAt = at + RELEARN_MS;
    } else if (interval < 1) {
      state = "learning";
      dueAt = at + interval * DAY;
    } else {
      state = "review";
      dueAt = at + interval * DAY;
    }
    /* Callers replace the card with this object, so anything the card carried
       and the scheduler still needs has to be echoed back. */
    var graded = {
      id: c.id,
      front: c.front,
      back: c.back,
      note: c.note,
      cardType: c.cardType,
      due: dueAt,
      lastReview: at,
      stability: stability,
      difficulty: difficulty,
      reps: c.reps + 1,
      lapses: c.lapses + (g === GRADES.AGAIN ? 1 : 0),
      state: state,
      seen: c.seen + 1,
      correct: c.correct + (g >= GRADES.GOOD ? 1 : 0)
    };
    if (c.retention) graded.retention = c.retention;
    if (c.params) graded.params = c.params;
    return graded;
  }

  function due(cards, now) {
    return (cards || [])
      .filter(function (c) { return num(c.due, 0) <= now; })
      .slice()
      .sort(function (a, b) { return a.due - b.due; });
  }

  /* Cards due per day for the next days. Index 0 is today, overdue rolls in. */
  function forecast(cards, now, days) {
    var n = Math.max(0, Math.floor(num(days, 30)));
    var counts = [];
    for (var i = 0; i < n; i++) counts.push(0);
    (cards || []).forEach(function (c) {
      var idx = Math.floor((num(c.due, 0) - now) / DAY);
      if (idx < 0) idx = 0;
      if (idx >= n) return;
      counts[idx]++;
    });
    return counts;
  }

  function retention(cards, now) {
    var list = cards || [];
    var out = { total: list.length, due: 0, learning: 0, review: 0, new: 0, mature: 0 };
    list.forEach(function (c) {
      var state = c.state || "new";
      if (num(c.due, 0) <= now) out.due++;
      if (state === "new") out.new++;
      if (state === "learning" || state === "relearning") out.learning++;
      if (state === "review") {
        out.review++;
        if (num(c.stability, 0) > MATURE_DAYS) out.mature++;
      }
    });
    return out;
  }

  function stats(cards) {
    var list = cards || [];
    var reviews = 0, correct = 0, gaps = [];
    list.forEach(function (c) {
      reviews += Math.max(0, num(c.seen, 0));
      correct += Math.max(0, num(c.correct, 0));
      if (typeof c.lastReview === "number" && typeof c.due === "number" && num(c.stability, 0) > 0) {
        gaps.push(Math.max(0, (c.due - c.lastReview) / DAY));
      }
    });
    gaps.sort(function (a, b) { return a - b; });
    var median = 0;
    if (gaps.length) {
      var mid = Math.floor(gaps.length / 2);
      median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
    }
    return {
      reviews: reviews,
      correct: correct,
      retentionRate: reviews ? correct / reviews : 0,
      interval: Math.round(median * 10) / 10
    };
  }

  var api = {
    DAY: DAY,
    GRADES: GRADES,
    DEFAULT_PARAMS: DEFAULT_PARAMS,
    DEFAULT_RETENTION: DEFAULT_RETENTION,
    S_MIN: S_MIN,
    RELEARN_MS: RELEARN_MS,
    MATURE_DAYS: MATURE_DAYS,
    MAX_INTERVAL_DAYS: MAX_INTERVAL_DAYS,
    newCard: newCard,
    grade: grade,
    due: due,
    forecast: forecast,
    retention: retention,
    stats: stats,
    retrievability: retrievability,
    intervalFor: intervalFor,
    initialStability: initialStability,
    initialDifficulty: initialDifficulty,
    nextDifficulty: nextDifficulty,
    stabilityAfter: stabilityAfter,
    clampDifficulty: clampDifficulty
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof globalThis !== "undefined") globalThis.Spacing = api;
})();