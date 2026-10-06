/* Neuralbase themes: token sets applied by data-theme on <html>.
   Token values live in styles.css; this module only lists and switches them. */
(function () {
  "use strict";

  var KEY = "cortex.theme";

  var THEMES = [
    { name: "graphite",  label: "Graphite",  mode: "dark" },
    { name: "carbon",    label: "Carbon",    mode: "dark" },
    { name: "porcelain", label: "Porcelain", mode: "light" },
    { name: "midnight",  label: "Midnight",  mode: "dark" },
    { name: "ember",     label: "Ember",     mode: "dark" }
  ];
  var NAMES = THEMES.map(function (t) { return t.name; });

  function list() { return THEMES.map(function (t) { return { name: t.name, label: t.label, mode: t.mode }; }); }
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
