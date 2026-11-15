// Applies the saved/system colour theme before first paint (prevents a light flash in dark mode).
// Loaded as an external file so the strict Content-Security-Policy (script-src 'self') allows it.
(function () {
  var pref = "system";
  try { pref = localStorage.getItem("carehub.theme") || "system"; } catch (e) { /* storage blocked */ }
  var dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();
