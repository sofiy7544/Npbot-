/* AVIF auto-upgrade — progressive enhancement.
   Upgrades webp <img> to avif when (a) the browser supports avif AND (b) an avif
   variant exists for that image, per img/avif-manifest.json (written by
   scripts/make-avif.mjs).

   Safe by construction:
   - No manifest (not generated yet) -> no-op, zero extra requests.
   - We swap src to a path we KNOW exists (in the manifest), so no broken images
     and no <picture> 404 fallback problem.
   - Works on dynamically-rendered pages (catalog/product/shop SPA) via a
     debounced MutationObserver. Our own src swap can't loop: swapped images no
     longer end in .webp and carry data-avif. */
(function () {
  fetch('img/avif-manifest.json')
    .then(r => (r.ok ? r.json() : null))
    .then(list => {
      if (!Array.isArray(list) || !list.length) return;
      const have = new Set(list);

      // 1×1 avif probe for support detection
      const test = new Image();
      test.onload = test.onerror = function () {
        if (!(test.width > 0)) return; // browser can't decode avif

        const swap = img => {
          if (img.dataset.avif) return;
          const s = img.getAttribute('src');
          if (!s || !/\.webp$/i.test(s)) return;
          const key = s.replace(/^\.?\//, '');
          if (!have.has(key)) return;
          img.dataset.avif = '1';
          img.src = s.replace(/\.webp$/i, '.avif');
        };
        const scan = () => document.querySelectorAll('img[src$=".webp"]').forEach(swap);

        scan();
        let t = 0;
        const rescan = () => { clearTimeout(t); t = setTimeout(scan, 150); };
        addEventListener('hashchange', rescan);
        try {
          new MutationObserver(rescan).observe(document.body, {
            childList: true, subtree: true, attributes: true, attributeFilter: ['src']
          });
        } catch (_) { /* initial + hashchange scans still cover most */ }
      };
      test.src = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQAMAAAAABNjb2xybmNseAACAAIABoAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgABogQEDQgMgkQAAAAB8dSLfI=';
    })
    .catch(() => { /* no manifest / fetch blocked -> stay on webp */ });
})();
