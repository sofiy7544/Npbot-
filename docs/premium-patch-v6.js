/* ============================================================================
   Stanley · Premium Patch v6 (production polish)
   Final pass before deploy. Audit-driven.

   What this does:
     1. Console output gate — silences console.log/warn/info in production
        unless ?debug=1 or localhost. Console.error always passes (errors
        must be visible).
     2. Idempotent — safe to load multiple times.
   ============================================================================ */
(function () {
  "use strict";

  /* DEBUG mode if: ?debug=1, localhost, or window.STANLEY_DEBUG = true */
  const isDebug =
    location.search.includes("debug=1") ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    window.STANLEY_DEBUG === true;

  if (!isDebug) {
    /* Silence info-level console output but keep `console.error` so real
       bugs are visible. We also keep `console.warn` because some legacy
       code uses it for actionable advice (e.g. "TG token missing"). */
    const noop = function () {};
    try {
      console.log = noop;
      console.info = noop;
      console.debug = noop;
      /* leave .warn and .error untouched */
    } catch (e) { /* old browsers */ }
  } else {
    /* Mark debug mode visibly */
    try {
      console.info(
        "%c[Stanley] DEBUG mode active%c",
        "background:#1C3A2E;color:#fff;padding:2px 8px;border-radius:4px;",
        ""
      );
    } catch (e) {}
  }

  /* Re-export the debug flag so other patches can check it */
  window.STANLEY_DEBUG = isDebug;
})();
