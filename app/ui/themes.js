/* Neuralbase themes: token sets applied by data-theme on <html>.
   Token values live in styles.css; this module only lists and switches them. */
(function () {
  "use strict";

  var KEY = "cortex.theme";

  /* Seven themes: three dark, four light. Token values live in styles.css keyed by
     name; this list must stay in step with the [data-theme] blocks there, or a name
     here resolves to the dark default. `label` is the accessible name for a theme
     and `swatch` is the two colours the picker paints ([background, accent]) so the
     view never duplicates a hex. */
  var THEMES = [
    { name: "graphite",  label: "Graphite",  mode: "dark",  swatch: ["#0f1113", "#b8e04a"] },
    { name: "basalt",    label: "Basalt",    mode: "dark",  swatch: ["#14110f", "#e8a33d"] },
    { name: "harbor",    label: "Harbor",    mode: "dark",  swatch: ["#0c1216", "#56cfe1"] },
    { name: "porcelain", label: "Porcelain", mode: "light", swatch: ["#f7f7f4", "#3f6b00"] },
    { name: "chalk",     label: "Chalk",     mode: "light", swatch: ["#ffffff", "#0b57d0"] },
    { name: "linen",     label: "Linen",     mode: "light", swatch: ["#faf6f0", "#9a4a12"] },
    { name: "tundra",    label: "Tundra",    mode: "light", swatch: ["#eef1f4", "#0f5f66"] }
  ];
  var NAMES = THEMES.map(function (t) { return t.name; });

  function list() {
    return THEMES.map(function (t) {
      return { name: t.name, label: t.label, mode: t.mode, swatch: t.swatch.slice() };
    });
  }
  function has(name) { return NAMES.indexOf(name) !== -1; }
  function meta(name) { for (var i = 0; i < THEMES.length; i++) if (THEMES[i].name === name) return THEMES[i]; return null; }

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function current() {
    if (typeof document !== "undefined") {
      var attr = document.documentElement.getAttribute("data-theme");
      if (has(attr)) return attr;
    }
    var s = stored();
    return has(s) ? s : "graphite";
  }
  function apply(name) {
    var n = has(name) ? name : "graphite";
    if (typeof document !== "undefined") document.documentElement.setAttribute("data-theme", n);
    try { localStorage.setItem(KEY, n); } catch (e) { /* degrade */ }
    return n;
  }

  function boot() {
    var s = stored();
    if (has(s)) document.documentElement.setAttribute("data-theme", s);
    else if (!document.documentElement.getAttribute("data-theme")) {
      document.documentElement.setAttribute("data-theme", "graphite");
    }
  }

  var api = { list: list, apply: apply, current: current, has: has, meta: meta, KEY: KEY };
  if (typeof globalThis !== "undefined") globalThis.Themes = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document !== "undefined") boot();
})();
