/*
 * Pre-paint theme bootstrap.
 * Loaded as a plain (CSP-allowed) script so no 'unsafe-inline' is needed.
 * Reads the `pp_theme` cookie set by the sidecar and toggles the `dark` class
 * before React mounts, avoiding a flash of the wrong theme.
 */
(function () {
  try {
    var match = document.cookie.match(/(?:^|;\s*)pp_theme=([^;]+)/);
    var stored = match ? decodeURIComponent(match[1]) : "";
    var dark =
      stored === "dark" ||
      (stored === "" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  } catch (err) {
    document.documentElement.classList.add("dark");
  }
})();
