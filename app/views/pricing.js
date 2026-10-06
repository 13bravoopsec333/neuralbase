/* Neuralbase pricing view: plan state, upgrade choice, and billing.

   Two states, chosen by the plan on the profile, so a paying customer never sees
   the thing they already bought. Free shows the upgrade choice. Pro shows the
   subscription: what it includes, what it costs, when it renews, and how to leave.

   Every plan change on this page is a client-side seam. Nothing is charged, and
   the page says so, because real entitlement checks need a server. */

var STYLE_ID = "nb-pricing-styles";

function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* Copy comes from the canonical strings in content.js when present. */
function copy(key, fallback) {
  var C = globalThis.Content && globalThis.Content.COPY;
  return (C && C[key]) || fallback;
}

/* Scoped styles. Theme tokens only, so all five themes pick them up. Column and
   heading centering come from .view-mid and .mid-head in styles.css. */
function injectStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  var s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = [
    ".pr{--pr-sec:20px;--pr-in:12px}",
    ".pr-lead{margin:9px 0 0;font-size:15px;line-height:1.55;color:var(--muted);text-wrap:pretty}",
    /* .price-grid caps at 720px; centering it keeps the pair as one centered group. */
    ".pr-grid{margin-inline:auto}",
    ".pr-price{display:flex;align-items:baseline;gap:7px;margin:2px 0}",
    ".pr-price .n{font-family:var(--mono);font-size:26px;font-weight:500;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1}",
    ".pr-price .u{font-size:12px;color:var(--dim)}",
    ".pr-feats{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}",
    ".pr-feats li{display:flex;align-items:baseline;gap:9px;font-size:13px;line-height:1.4;color:var(--muted)}",
    ".pr-feats li::before{content:'';flex:none;width:5px;height:5px;border-radius:1px;background:var(--lime);transform:translateY(-1px)}",
    ".pr-sec{margin-top:var(--pr-sec)}",
    ".pr-rows{margin-top:var(--pr-in);display:flex;flex-direction:column}",
    ".pr-row{display:grid;grid-template-columns:minmax(118px,32%) 1fr;gap:4px 14px;padding:10px 0;border-top:1px solid var(--line);align-items:start}",
    ".pr-row:first-child{border-top:0;padding-top:0}",
    ".pr-k{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);padding-top:2px}",
    ".pr-v{margin:0;font-size:13px;line-height:1.5;color:var(--ink);overflow-wrap:anywhere}",
    ".pr-prose{margin:var(--pr-in) 0 0;font-size:13px;line-height:1.55;color:var(--muted);text-wrap:pretty}",
    ".pr-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:var(--pr-sec)}",
    ".pr-note{margin:var(--pr-sec) 0 0;padding-top:12px;border-top:1px solid var(--line);font-size:12px;color:var(--dim);line-height:1.55;max-width:62ch;text-wrap:pretty}",
    "@media (max-width:430px){.pr-row{grid-template-columns:1fr;gap:2px}.pr-k{padding-top:6px}}"
  ].join("");
  document.head.appendChild(s);
}

/* The centered masthead every normal page opens on. */
function pageHead(title, lead) {
  var head = el("div", "mid-head");
  var h = el("h2", "view-title", title);
  h.tabIndex = -1;
  head.appendChild(h);
  head.appendChild(el("p", "pr-lead", lead));
  return head;
}

/* One tier card. Only shown on Free, where the choice is real. */
function tierCard(plan) {
  var pro = plan === "pro";
  var c = el("div", "card price-card" + (pro ? " pro" : ""));
  var head = el("div", "card-head");
  head.appendChild(el("h3", null, copy(pro ? "proPlan" : "freePlan", pro ? "Pro" : "Free")));
  c.appendChild(head);

  var price = el("div", "pr-price");
  price.appendChild(el("span", "n", pro ? "$4.99" : "$0"));
  price.appendChild(el("span", "u", pro ? "per month" : "forever"));
  c.appendChild(price);

  var list = el("ul", "pr-feats");
  var perks = pro
    ? ["All nine drills", "Circuit builder", "Adaptive mix", "Full history", "All leaderboards"]
    : ["Executive N-Back", "Speed of Processing", "Spaced Retrieval", "Daily circuit", "7-day history"];
  perks.forEach(function (p) { list.appendChild(el("li", null, p)); });
  c.appendChild(list);
  return c;
}

/* A label/value line: mono label, value text, hairline rule above. */
function row(label, value) {
  var r = el("div", "pr-row");
  r.appendChild(el("span", "pr-k", label));
  var v = el("span", "pr-v");
  if (typeof value === "string") v.textContent = value;
  else v.appendChild(value);
  r.appendChild(v);
  return r;
}

function priceValue() {
  var v = el("span");
  v.appendChild(el("span", "mono", "$4.99"));
  v.appendChild(document.createTextNode(" per month"));
  return v;
}

function backButton(ctx) {
  var back = el("button", "btn-ghost", "Back to dashboard");
  back.type = "button";
  back.addEventListener("click", function () {
    if (typeof ctx.navigate === "function") ctx.navigate("dashboard");
  });
  return back;
}

/* ---------- Free: the upgrade choice, the only place Free versus Pro belongs ---------- */
function buildFree(body, ctx, setPlan) {
  body.appendChild(pageHead(
    "Free and Pro",
    copy("freeNote", "Free includes three drills and seven days of history.")
  ));

  var grid = el("div", "price-grid pr-grid");
  grid.appendChild(tierCard("free"));
  grid.appendChild(tierCard("pro"));
  body.appendChild(grid);

  body.appendChild(el("p", "pr-note",
    copy("proNote", "Pro unlocks all nine drills, the circuit builder, the adaptive mix, and the full history.")));

  var actions = el("div", "pr-actions");
  var go = el("button", "btn-primary", copy("proCta", "Go Pro"));
  go.type = "button";
  go.addEventListener("click", function () { setPlan("pro"); });
  actions.appendChild(go);
  actions.appendChild(backButton(ctx));
  body.appendChild(actions);

  body.appendChild(el("p", "pr-note",
    "Payments are a client-side seam. Going Pro changes the plan saved to your account and nothing is charged, because real entitlement checks need a server."));
}

/* ---------- Pro: a billing and subscription page, no tier comparison ---------- */
function buildPro(body, ctx, setPlan) {
  body.appendChild(pageHead(
    "Your subscription",
    "You are on Pro. This page covers what it includes, what you pay, and how to leave it."
  ));

  /* Current plan: stated plainly, with what it includes. */
  var planCard = el("section", "card pr-sec");
  var planHead = el("div", "card-head");
  planHead.appendChild(el("h3", null, "Current plan"));
  planHead.appendChild(el("span", "status-tag available", "Pro"));
  planCard.appendChild(planHead);
  var feats = el("ul", "pr-feats");
  ["All nine drills", "Circuit builder", "Adaptive mix", "Full history", "All leaderboards"].forEach(function (f) {
    feats.appendChild(el("li", null, f));
  });
  planCard.appendChild(feats);
  body.appendChild(planCard);

  /* Billing: price, period, renewal, and payment method. */
  var billCard = el("section", "card pr-sec");
  billCard.appendChild(el("h3", null, "Billing"));
  var rows = el("div", "pr-rows");
  rows.appendChild(row("Price", priceValue()));
  rows.appendChild(row("Period", "Monthly, charged each month."));
  /* The renewal date would come from the payment provider, and this build has
     none, so it is stated as unset rather than invented. */
  rows.appendChild(row("Next renewal", "Not set yet. This build stores no renewal date, because billing runs without a server."));
  rows.appendChild(row("Payment method", "None on file. Nothing has been charged."));
  billCard.appendChild(rows);
  body.appendChild(billCard);

  /* Cancelling: the path, and what happens to the data. */
  var cancelCard = el("section", "card pr-sec");
  cancelCard.appendChild(el("h3", null, "Cancelling"));
  cancelCard.appendChild(el("p", "pr-prose",
    "Cancel any time. Your runs, sessions, and cards stay on your account and your history stays readable. The account returns to Free, so the Pro-only drills and the circuit builder lock again."));
  var cancelActions = el("div", "pr-actions");
  var cancel = el("button", "btn-ghost", "Cancel Pro");
  cancel.type = "button";
  cancel.addEventListener("click", function () { setPlan("free"); });
  cancelActions.appendChild(cancel);
  cancelCard.appendChild(cancelActions);
  body.appendChild(cancelCard);

  /* Help and refunds: honest about there being no live charge to refund. */
  var helpCard = el("section", "card pr-sec");
  helpCard.appendChild(el("h3", null, "Help and refunds"));
  helpCard.appendChild(el("p", "pr-prose",
    "Nothing has been charged, so there is nothing to refund yet. Once billing goes live, refunds and billing questions go through the payment provider that handles the charge."));
  body.appendChild(helpCard);

  var actions = el("div", "pr-actions");
  actions.appendChild(backButton(ctx));
  body.appendChild(actions);

  body.appendChild(el("p", "pr-note",
    "Payments here are a client-side seam. Cancelling changes the plan saved to your account and nothing is charged, because real entitlement checks need a server."));
}

export function render(container, ctx) {
  if (!container) return;
  ctx = ctx || {};
  injectStyles();
  container.replaceChildren();

  var col = el("div", "view-mid pr");
  var body = el("div");
  var live = el("div", "sr");
  live.setAttribute("aria-live", "polite");
  col.appendChild(body);
  col.appendChild(live);
  container.appendChild(col);

  function say(msg) { live.textContent = msg; }

  function paint(focusTitle) {
    body.replaceChildren();
    var plan = (ctx.profile && ctx.profile.plan) === "pro" ? "pro" : "free";
    if (plan === "pro") buildPro(body, ctx, setPlan);
    else buildFree(body, ctx, setPlan);
    if (focusTitle) {
      var h = body.querySelector(".view-title");
      if (h && h.focus) h.focus();
    }
  }

  /* The one seam: it writes the plan to the profile, then repaints the state.
     There is no charge and no server check, and the page says so. */
  function setPlan(next) {
    function apply() {
      if (ctx.profile) ctx.profile.plan = next;
      paint(true);
      say(next === "pro"
        ? "You are on Pro."
        : "You are back on Free. Your history is still here.");
    }
    if (ctx.db && typeof ctx.db.updateProfile === "function") {
      Promise.resolve(ctx.db.updateProfile({ plan: next })).then(apply, apply);
    } else {
      apply();
    }
  }

  paint(false);
}

export default render;
