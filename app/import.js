/* Neuralbase import: Anki, delimited, and cloze parsers. Pure string work. */
(function () {
  "use strict";

  var SEPARATORS = {
    tab: "\t",
    "\t": "\t",
    space: " ",
    pipe: "|",
    "|": "|",
    comma: ",",
    ",": ",",
    semicolon: ";",
    ";": ";",
    colon: ":",
    ":": ":"
  };

  var FRONT_HEADERS = ["front", "question", "prompt", "term", "word", "vocabulary", "vocab", "query", "item"];
  var BACK_HEADERS = ["back", "answer", "response", "definition", "meaning", "translation", "solution"];

  var CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)\}\}/g;

  function empty() {
    return { cards: [], notes: [], warnings: [], fields: {} };
  }

  /* Split on the delimiter, honouring double-quoted fields and "" escapes. */
  function splitFields(line, delimiter) {
    var out = [];
    var field = "";
    var quoted = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (quoted) {
        if (ch === '"') {
          if (line.charAt(i + 1) === '"') { field += '"'; i++; }
          else quoted = false;
        } else field += ch;
      } else if (ch === '"' && field === "") {
        quoted = true;
      } else if (ch === delimiter) {
        out.push(field);
        field = "";
      } else field += ch;
    }
    out.push(field);
    return out;
  }

  function stripHtml(text) {
    return String(text)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#x27;/gi, "'");
  }

  function clean(value, strip) {
    var text = value == null ? "" : String(value);
    /* Drop control characters that survive a copy paste or a bad export. */
    text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
    return strip ? stripHtml(text).trim() : text.trim();
  }

  function lines(text) {
    return String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
  }

  function blankCard(front, back, note, cardType) {
    return { front: front, back: back, note: note || "", cardType: cardType || "basic" };
  }

  /* ---------- Anki text exports ---------- */

  function ankiHeader(rawLines) {
    var fields = {};
    var start = 0;
    for (var i = 0; i < rawLines.length; i++) {
      var line = rawLines[i];
      if (line.charAt(0) !== "#") break;
      var cut = line.indexOf(":");
      if (cut < 0) continue;
      fields[line.slice(1, cut).trim().toLowerCase()] = line.slice(cut + 1).trim();
      start = i + 1;
    }
    return { fields: fields, start: start };
  }

  function ankiDelimiter(fields) {
    var raw = String(fields.separator == null ? "\t" : fields.separator);
    if (Object.prototype.hasOwnProperty.call(SEPARATORS, raw)) return SEPARATORS[raw];
    if (raw === "" ) return "\t";
    return raw.charAt(0);
  }

  function ankiIsHtml(fields) {
    var flag = String(fields.html == null ? "" : fields.html).toLowerCase();
    if (flag === "true" || flag === "yes" || flag === "1") return true;
    if (flag === "false" || flag === "no" || flag === "0") return false;
    return false;
  }

  function parseAnki(text) {
    var out = empty();
    var rawLines = lines(text);
    var head = ankiHeader(rawLines);
    var fields = head.fields;
    var delimiter = ankiDelimiter(fields);
    var strip = ankiIsHtml(fields);
    var cardType = /cloze/i.test(fields.notetype || "") ? "cloze" : "basic";
    out.fields = {
      separator: delimiter,
      html: strip,
      notetype: fields.notetype || "",
      deck: fields.deck || "",
      cardType: cardType
    };

    for (var i = head.start; i < rawLines.length; i++) {
      var line = rawLines[i];
      if (line.trim() === "") continue;
      var parts = splitFields(line, delimiter);
      var front = clean(parts[0], strip);
      var backParts = [];
      for (var j = 1; j < parts.length; j++) {
        var value = clean(parts[j], strip);
        if (value !== "") backParts.push(value);
      }
      var back = backParts.join("\n");
      if (front === "" && back === "") {
        out.warnings.push("line " + (i + 1) + ": skipped, no front or back text");
        continue;
      }
      if (back === "") out.warnings.push("line " + (i + 1) + ": no back text, showing front only");
      out.notes.push(front);
      out.cards.push(blankCard(front, back, fields.deck || "", cardType));
    }
    if (out.cards.length === 0) out.warnings.push("no cards found");
    return out;
  }

  /* ---------- Delimited CSV and TSV ---------- */

  function sniffDelimiter(rawLines) {
    var counts = { "\t": 0, ",": 0, ";": 0, "|": 0 };
    var sample = rawLines.filter(function (l) { return l.trim() !== ""; }).slice(0, 20);
    sample.forEach(function (line) {
      var outside = 0;
      var quoted = false;
      for (var i = 0; i < line.length; i++) {
        var ch = line.charAt(i);
        if (ch === '"') quoted = !quoted;
        else if (!quoted && Object.prototype.hasOwnProperty.call(counts, ch)) {
          counts[ch]++;
          outside++;
        }
      }
    });
    var best = "\t";
    var bestCount = 0;
    Object.keys(counts).forEach(function (key) {
      if (counts[key] > bestCount) { best = key; bestCount = counts[key]; }
    });
    return bestCount ? best : "\t";
  }

  function guessIndices(header) {
    var frontIndex = -1;
    var backIndex = -1;
    header.forEach(function (cell, i) {
      var key = String(cell).toLowerCase().replace(/[^a-z]/g, "");
      if (frontIndex < 0 && FRONT_HEADERS.indexOf(key) >= 0) frontIndex = i;
      else if (backIndex < 0 && BACK_HEADERS.indexOf(key) >= 0) backIndex = i;
    });
    if (frontIndex < 0 && backIndex < 0) return { front: 0, back: 1, named: false };
    if (frontIndex < 0) frontIndex = backIndex === 0 ? 1 : 0;
    if (backIndex < 0) backIndex = frontIndex === 0 ? 1 : 0;
    return { front: frontIndex, back: backIndex, named: true };
  }

  function parseDelimited(text, opts) {
    var options = opts || {};
    var out = empty();
    var rawLines = lines(text).filter(function (l) { return l.trim() !== ""; });
    if (rawLines.length === 0) {
      out.warnings.push("no rows found");
      return out;
    }
    var delimiter = options.delimiter || sniffDelimiter(rawLines);
    var strip = options.html === true;

    var headerRow = null;
    if (options.hasHeader === false) {
      headerRow = null;
    } else {
      var first = splitFields(rawLines[0], delimiter).map(function (c) { return clean(c, false); });
      var looksLikeHeader = first.length > 1 && first.some(function (cell) {
        var key = cell.toLowerCase().replace(/[^a-z]/g, "");
        return FRONT_HEADERS.indexOf(key) >= 0 || BACK_HEADERS.indexOf(key) >= 0;
      });
      if (looksLikeHeader) headerRow = first;
    }

    var body = rawLines.slice(headerRow ? 1 : 0);
    var indices = options.front != null && options.back != null
      ? { front: options.front, back: options.back, named: true }
      : guessIndices(headerRow || splitFields(rawLines[0], delimiter));

    out.fields = {
      separator: delimiter,
      header: headerRow || [],
      frontIndex: indices.front,
      backIndex: indices.back,
      cardType: "basic"
    };

    for (var i = 0; i < body.length; i++) {
      var parts = splitFields(body[i], delimiter);
      var front = clean(parts[indices.front], strip);
      var backParts = [];
      for (var j = 0; j < parts.length; j++) {
        /* Named columns keep their own cell; otherwise extras fold into back. */
        if (j === indices.front) continue;
        if (indices.named && j !== indices.back) continue;
        var value = clean(parts[j], strip);
        if (value !== "") backParts.push(value);
      }
      var back = backParts.join("\n");
      if (front === "" && back === "") {
        out.warnings.push("row " + (i + 1) + ": skipped, no usable fields");
        continue;
      }
      if (back === "") out.warnings.push("row " + (i + 1) + ": no back text, front only");
      out.notes.push(front);
      out.cards.push(blankCard(front, back, "", "basic"));
    }
    if (out.cards.length === 0) out.warnings.push("no cards found");
    return out;
  }

  /* ---------- Cloze ---------- */

  /* Segments alternate plain text and cloze markers, in document order. */
  function clozePieces(text) {
    var pieces = [];
    var last = 0;
    var match;
    CLOZE_RE.lastIndex = 0;
    while ((match = CLOZE_RE.exec(text)) !== null) {
      if (match.index > last) pieces.push({ text: text.slice(last, match.index), cloze: false });
      var bits = match[2].split("::");
      pieces.push({
        text: "",
        cloze: true,
        index: parseInt(match[1], 10),
        answer: bits[0],
        hint: bits.length > 1 ? bits.slice(1).join("::") : ""
      });
      last = match.index + match[0].length;
    }
    if (last < text.length) pieces.push({ text: text.slice(last), cloze: false });
    return pieces;
  }

  function parseCloze(text) {
    var out = empty();
    var rawLines = lines(text);
    out.fields = { cardType: "cloze", separator: "\t", header: [] };

    for (var i = 0; i < rawLines.length; i++) {
      var line = rawLines[i];
      if (line.trim() === "") continue;
      var parts = splitFields(line, "\t");
      var source = parts[0];
      var extra = [];
      for (var j = 1; j < parts.length; j++) {
        var value = clean(parts[j], false);
        if (value !== "") extra.push(value);
      }
      if (/\{\{c\d+::/.test(source) === false) {
        out.warnings.push("line " + (i + 1) + ": skipped, no cloze markers");
        continue;
      }
      var pieces = clozePieces(source);
      var numbers = [];
      var plain = "";
      pieces.forEach(function (piece) {
        if (!piece.cloze) { plain += piece.text; return; }
        if (numbers.indexOf(piece.index) < 0) numbers.push(piece.index);
      });
      numbers.sort(function (a, b) { return a - b; });
      if (numbers.length === 0) {
        out.warnings.push("line " + (i + 1) + ": skipped, empty cloze");
        continue;
      }
      out.notes.push(plain.trim());
      numbers.forEach(function (n) {
        var front = "";
        var back = "";
        pieces.forEach(function (piece) {
          if (!piece.cloze) {
            front += piece.text;
          } else if (piece.index === n) {
            back = piece.answer;
            front += piece.hint ? "[" + piece.hint + "]" : "[...]";
          } else {
            front += "[...]";
          }
        });
        if (extra.length) back = back + "\n" + extra.join("\n");
        out.cards.push({
          front: front.trim(),
          back: back.trim(),
          note: "",
          cardType: "cloze",
          hint: clozeHint(pieces, n)
        });
      });
    }
    if (out.cards.length === 0) out.warnings.push("no cloze cards found");
    return out;
  }

  function clozeHint(pieces, n) {
    for (var i = 0; i < pieces.length; i++) {
      if (pieces[i].cloze && pieces[i].index === n) return pieces[i].hint || "";
    }
    return "";
  }

  /* ---------- Dispatch ---------- */

  function detect(text) {
    var source = text == null ? "" : String(text);
    var rawLines = lines(source);
    var head = ankiHeader(rawLines);
    if (/cloze/i.test(head.fields.notetype || "")) return "cloze";
    if (/\{\{c\d+::/.test(source)) return "cloze";
    if (Object.keys(head.fields).length) return "anki";
    return "delimited";
  }

  function run(text, opts) {
    var kind = (opts && opts.parser) || detect(text);
    if (kind === "anki") return parseAnki(text);
    if (kind === "cloze") return parseCloze(text);
    if (kind === "delimited" || kind === "csv" || kind === "tsv") return parseDelimited(text, opts);
    return parseDelimited(text, opts);
  }

  var api = {
    parseAnki: parseAnki,
    parseDelimited: parseDelimited,
    parseCloze: parseCloze,
    detect: detect,
    run: run,
    splitFields: splitFields,
    stripHtml: stripHtml
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof globalThis !== "undefined") globalThis.Importer = api;
})();