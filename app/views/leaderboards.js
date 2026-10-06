/* Neuralbase v2 leaderboards view.
   render(container, ctx) builds the whole view into `container`.

   ctx.api.leaderboard(drillId, window) resolves to an array of
     { rank, username, bestValue, isMe, user_id }.
   ctx.db.updateProfile({ visibility }) persists the name / anonymous choice.
   ctx.profile (or ctx.state.profile) supplies the current visibility.
   ctx.navigate takes a row to that person's profile.

   Every row that carries a user_id is a link: it writes the id to
   localStorage['cortex.profile.view'] and navigates to 'profile', which is the
   handoff the profile view reads and clears. A row with no user_id has nothing
   to open, so it stays a plain row and shows no sign of being clickable.

   Usernames are rendered with textContent only, never innerHTML. */

const WINDOWS = [
  { id: "daily", label: "Daily" },
  { id: "monthly", label: "Monthly" },
  { id: "all", label: "All-time" },
];

const HINTS = {
  nback: "Ranked by level, higher is better.",
  ufov: "Ranked by time, lower is better.",
  palace: "Ranked by items recalled, higher is better.",
  reasoning: "Ranked by correct answers, higher is better.",
  spaced: "Ranked by cards retained, higher is better.",
  switching: "Ranked by correct switches, higher is better.",
};

const FALLBACK_DRILLS = [
  { id: "nback", name: "Executive N-Back", unit: "n" },
  { id: "ufov", name: "Speed of Processing", unit: "ms" },
  { id: "palace", name: "Memory Palace", unit: "items" },
  { id: "reasoning", name: "Relational Reasoning", unit: "correct" },
  { id: "spaced", name: "Spaced Retrieval", unit: "cards" },
  { id: "switching", name: "Task Switching", unit: "correct" },
];

const STYLE_ID = "cortex-lb-styles";

/* The handoff key the profile view reads and clears. Same shape as the existing
   cortex.train.select handoff other views use. */
const VIEW_KEY = "cortex.profile.view";

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
}

function drills() {
  const c = typeof globalThis !== "undefined" ? globalThis.Content : null;
  if (c && Array.isArray(c.DRILLS) && c.DRILLS.length) return c.DRILLS;
  return FALLBACK_DRILLS;
}

function formatValue(drill, v) {
  if (v == null || v === "" || !isFinite(Number(v))) return "--";
  const n = Number(v);
  if (drill.id === "ufov" || drill.unit === "ms") return n + " ms";
  if (drill.id === "nback") return "level " + n;
  return n + (drill.unit ? " " + drill.unit : "");
}

function readProfile(ctx) {
  const c = ctx || {};
  return c.profile || (c.state && c.state.profile) || {};
}

function visibilityOf(profile) {
  return profile && profile.visibility === "anon" ? "anon" : "name";
}

function ownName(profile) {
  return (profile && (profile.display_name || profile.username)) || "You";
}

function defaultDrillId(ctx, list) {
  const c = ctx || {};
  let id = c.mostPlayed || (c.stats && c.stats.mostPlayed) || (c.state && c.state.mostPlayed);
  if (!id) {
    const recs = (c.state && c.state.records) || c.records;
    if (Array.isArray(recs) && recs.length) {
      const counts = {};
      recs.forEach((r) => {
        if (r && r.drillId) counts[r.drillId] = (counts[r.drillId] || 0) + 1;
      });
      id = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    }
  }
  if (id && list.some((d) => d.id === id)) return id;
  return list[0].id;
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = [
    ".lb{max-width:720px}",
    ".lb-controls{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;justify-content:space-between;margin-bottom:12px}",
    ".lb-field{display:flex;flex-direction:column;gap:4px}",
    ".lb-field-l{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}",
    ".lb-select{background:var(--panel2);color:var(--ink);border:1px solid var(--line2);border-radius:var(--r);padding:8px 10px;font:inherit}",
    ".lb-tabs{display:inline-flex;border:1px solid var(--line2);border-radius:var(--r);overflow:hidden;background:var(--panel)}",
    ".lb-tab{background:transparent;color:var(--muted);border:0;padding:8px 14px;font:inherit;cursor:pointer}",
    ".lb-tab.is-on{background:var(--accent-soft);color:var(--ink)}",
    ".lb-tab+.lb-tab{border-left:1px solid var(--line)}",
    /* Which board you are looking at, spelled out over the list. The select above
       already chooses it, but the list itself has to answer the question on its own. */
    ".lb-title{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px}",
    ".lb-title h3{margin:0;font-size:15px;font-weight:600;letter-spacing:-.01em}",
    ".lb-title-s{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);white-space:nowrap}",
    ".lb-list{border:1px solid var(--line);border-radius:var(--r);overflow:hidden;background:var(--panel)}",
    /* Column ruler over the rows: the left column is a place in the order, not a score. */
    ".lb-head{display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:10px;padding:9px 14px;border-bottom:1px solid var(--line);font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}",
    ".lb-head .lb-h-r{text-align:right}",
    ".lb-row{position:relative;display:grid;grid-template-columns:44px minmax(0,1fr) auto;align-items:center;gap:6px 10px;padding:10px 14px;border-top:1px solid var(--line);min-height:44px}",
    ".lb-head + .lb-row{border-top:0}",
    /* A row is a link through one full-bleed button laid over the grid, so the
       three columns keep their widths and the whole row is a single tab stop.
       Absolutely positioned, so it is not a grid item and adds no column. */
    ".lb-hit{position:absolute;inset:0;z-index:1;padding:0;margin:0;border:0;border-radius:0;background:transparent;font:inherit;color:inherit;cursor:pointer}",
    ".lb-hit:focus-visible{outline:2px solid var(--lime);outline-offset:-2px}",
    ".lb-row.link:hover{background:var(--hover)}",
    ".lb-row.link:hover .lb-name{color:var(--accent)}",
    /* The visibility control sits above the overlay so the select still takes its
       own clicks. It is the one control inside a row. */
    ".lb-vis-cell{position:relative;z-index:2}",
    ".lb-rank{color:var(--muted);text-align:right}",
    ".lb-name{color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".lb-val{color:var(--ink)}",
    ".lb-me{background:var(--accent-soft);border-left:3px solid var(--accent);padding-left:11px}",
    ".lb-me .lb-rank{color:var(--accent);font-weight:600}",
    /* The gap says which places are not on screen, so the rank column reads as a
       scale rather than as an unexplained jump. */
    ".lb-gap{display:flex;align-items:center;justify-content:center;min-height:26px;padding:4px 14px;color:var(--dim);font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;border-top:1px solid var(--line);border-bottom:1px solid var(--line);text-align:center}",
    ".lb-vis{display:flex;align-items:center;gap:6px}",
    /* The visibility control is a fourth child but not a fourth column: it drops to
       its own line under the row so the name keeps its width instead of collapsing
       to an ellipsis. */
    ".lb-vis-cell{grid-column:2 / -1;flex-wrap:wrap;gap:6px 8px}",
    "@media(min-width:720px){.lb-vis-cell{grid-column:2 / -1;justify-content:flex-end}}",
    ".lb-vis-l{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.06em}",
    ".lb-vis-sel{background:var(--panel2);color:var(--ink);border:1px solid var(--line2);border-radius:var(--r);padding:4px 6px;font:inherit;font-size:12px}",
    ".lb-empty{padding:28px 16px;text-align:center}",
    ".lb-empty-t{color:var(--ink);margin:0 0 4px}",
    ".lb-empty-s{color:var(--dim);margin:0;font-size:13px}",
    ".lb-status{color:var(--dim);font-size:12px;min-height:16px;margin:12px 0 0}",
  ].join("");
  document.head.appendChild(s);
}

export async function render(container, ctx) {
  if (!container || !container.ownerDocument) return;
  ensureStyles();

  const api = ctx && ctx.api;
  const db = ctx && ctx.db;
  const navigate = ctx && typeof ctx.navigate === "function" ? ctx.navigate : null;
  const list = drills();
  let profile = readProfile(ctx);

  const state = {
    drillId: defaultDrillId(ctx, list),
    window: "daily",
    gen: 0,
  };

  container.replaceChildren();

  const root = el("div", "lb view-mid-wide");

  /* The topbar owns the view name, so this hidden heading adds a page heading for
     screen readers without repeating the name on screen. */
  const pageTitle = el("h2", "view-title sr", "Leaderboards");
  pageTitle.tabIndex = -1;
  root.appendChild(pageTitle);

  const controls = el("div", "lb-controls");

  const field = el("label", "lb-field");
  field.appendChild(el("span", "lb-field-l", "Drill"));
  const select = el("select", "lb-select");
  select.setAttribute("aria-label", "Choose a drill");
  list.forEach((d) => {
    const o = el("option", null, d.name);
    o.value = d.id;
    select.appendChild(o);
  });
  select.value = state.drillId;
  select.addEventListener("change", () => {
    state.drillId = select.value;
    refresh();
  });
  field.appendChild(select);
  controls.appendChild(field);

  const tabs = el("div", "lb-tabs");
  tabs.setAttribute("role", "tablist");
  const tabBtns = {};
  WINDOWS.forEach((w) => {
    const b = el("button", "lb-tab", w.label);
    b.type = "button";
    b.setAttribute("role", "tab");
    b.addEventListener("click", () => {
      state.window = w.id;
      refresh();
    });
    tabBtns[w.id] = b;
    tabs.appendChild(b);
  });
  controls.appendChild(tabs);
  root.appendChild(controls);

  /* The board names itself over the list: which drill, which window, and which way
     round the score runs. The controls above already chose all three, but a list
     read on its own has to say so. */
const board = el("div", "lb-title");
  const boardName = el("h3");
  const boardSub = el("span", "lb-title-s");
  board.appendChild(boardName);
  board.appendChild(boardSub);
  root.appendChild(board);

  const rowsMount = el("div", "lb-list");
  root.appendChild(rowsMount);

  const status = el("p", "lb-status");
  status.setAttribute("role", "status");
  root.appendChild(status);

  container.appendChild(root);

  function currentDrill() {
    for (let i = 0; i < list.length; i++) if (list[i].id === state.drillId) return list[i];
    return list[0];
  }

  function windowLabel() {
    for (let i = 0; i < WINDOWS.length; i++) if (WINDOWS[i].id === state.window) return WINDOWS[i].label;
    return state.window;
  }

  function setTabs() {
    Object.keys(tabBtns).forEach((id) => {
      const on = id === state.window;
      tabBtns[id].classList.toggle("is-on", on);
      tabBtns[id].setAttribute("aria-selected", on ? "true" : "false");
    });
    const drill = currentDrill();
    boardName.textContent = drill.name;
    boardSub.textContent = windowLabel() + " board, " +
      (HINTS[state.drillId] || "ranked by best value.");
  }

  /* "Ranks 11 to 42" rather than a row of dots, so the gap states the fact it hides
     instead of just marking that something is missing. */
  function rankRange(from, to) {
    if (from > to) return "";
    return from === to ? "Rank " + from : "Ranks " + from + " to " + to;
  }

  function gapRow(from, to) {
    const g = el("div", "lb-gap", rankRange(from, to) + " not shown");
    return g;
  }

  function visControl() {
    const wrap = el("span", "lb-vis");
    wrap.appendChild(el("span", "lb-vis-l", "Shown as"));
    const sel = el("select", "lb-vis-sel");
    sel.setAttribute("aria-label", "Leaderboard visibility");
    const oName = el("option", null, ownName(profile));
    oName.value = "name";
    const oAnon = el("option", null, "Anonymous");
    oAnon.value = "anon";
    sel.appendChild(oName);
    sel.appendChild(oAnon);
    sel.value = visibilityOf(profile);
    sel.addEventListener("change", async () => {
      const choice = sel.value === "anon" ? "anon" : "name";
      sel.disabled = true;
      if (db && db.updateProfile) {
        try {
          await db.updateProfile({ visibility: choice });
        } catch (e) {
          /* the view still reflects the local choice; the write layer logs failures */
        }
      }
      profile = Object.assign({}, profile, { visibility: choice });
      await refresh();
    });
    wrap.appendChild(sel);
    return wrap;
  }

  /* Open another person's profile. The id is handed to the profile view through the
     same localStorage key the rest of the app uses for cross-view handoff, then
     cleared by that view on render. */
  function openProfile(userId) {
    if (!userId) return;
    try { localStorage.setItem(VIEW_KEY, String(userId)); } catch (e) { /* degrade */ }
    if (ctx && typeof ctx.navigate === "function") ctx.navigate("profile");
  }

  function rowEl(row, drill) {
    const r = el("div", "lb-row" + (row.isMe ? " lb-me" : ""));
    if (row.isMe) r.setAttribute("aria-current", "true");
    r.appendChild(el("span", "lb-rank mono", row.rank));
    r.appendChild(el("span", "lb-name", row.username));
    r.appendChild(el("span", "lb-val mono", formatValue(drill, row.bestValue)));
    if (row.isMe) {
      const cell = visControl();
      cell.classList.add("lb-vis-cell");
      r.appendChild(cell);
    } else if (row.user_id) {
      /* Your own row holds the visibility select, so it is not a link; your own
         profile is reachable from the account control instead. */
      r.classList.add("link");
      r.setAttribute("role", "button");
      r.setAttribute("tabindex", "0");
      r.setAttribute("aria-label", "Open the profile for " + row.username);
      r.addEventListener("click", function () { openProfile(row.user_id); });
      r.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
          e.preventDefault();
          openProfile(row.user_id);
        }
      });
    }
    return r;
  }

  function renderRows(drill, rows, failed) {
    rowsMount.replaceChildren();
    if (!rows.length) {
      status.textContent = "";
      const empty = el("div", "lb-empty");
      empty.appendChild(el("p", "lb-empty-t", failed ? "Could not load this board." : "No scores in this window yet."));
      if (!failed) empty.appendChild(el("p", "lb-empty-s", "Finish a run to enter the board."));
      rowsMount.appendChild(empty);
      return;
    }
    status.textContent = "";

    const me = rows.find((r) => r.isMe) || null;
    rows.filter((r) => r.rank <= 10).forEach((r) => rowsMount.appendChild(rowEl(r, drill)));

    if (!me || me.rank <= 10) return; /* already in the top 10, do not duplicate */

    rowsMount.appendChild(gapRow());
    rowsMount.appendChild(rowEl(me, drill));

    const below = rows.filter((r) => r.rank > me.rank).slice(0, 3);
    if (below.length) {
      rowsMount.appendChild(gapRow());
      below.forEach((r) => rowsMount.appendChild(rowEl(r, drill)));
    }
  }

  async function refresh() {
    setTabs();
    const g = ++state.gen;
    const drill = currentDrill();
    rowsMount.replaceChildren();
    status.textContent = "Loading...";

    let res;
    try {
      res = api && api.leaderboard ? await api.leaderboard(drill.id, state.window) : [];
    } catch (e) {
      res = { ok: false, error: (e && e.message) || "error" };
    }
    if (g !== state.gen) return;

    const failed = !Array.isArray(res);
    const rows = failed ? [] : res.slice().sort((a, b) => a.rank - b.rank);
    renderRows(drill, rows, failed);
  }

  await refresh();
}
