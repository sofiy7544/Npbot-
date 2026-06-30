/* Smooth image loading — progressive enhancement.
   Fades lazy images in as they decode, for a calm premium feel.

   Safe by construction:
   - Only touches img[loading="lazy"] — the LCP hero (eager) shows instantly,
     so perceived performance is not hurt.
   - Only hides images that haven't loaded YET; already-decoded/cached images are
     left visible. If the script never runs, nothing is hidden.
   - reduced-motion -> no-op. Works on SPA/dynamic pages via MutationObserver. */
(function () {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const st = document.createElement('style');
  st.textContent =
    'img.fade-img{opacity:0;transition:opacity .55s cubic-bezier(.22,.61,.36,1)}' +
    'img.fade-img.is-in{opacity:1}';
  document.head.appendChild(st);

  const wire = img => {
    if (img.dataset.fade) return;
    if (img.complete && img.naturalWidth > 0) return; // already loaded → leave visible
    img.dataset.fade = '1';
    img.classList.add('fade-img');
    const show = () => img.classList.add('is-in');
    img.addEventListener('load', show, { once: true });
    img.addEventListener('error', () => img.classList.remove('fade-img'), { once: true });
    if (img.complete && img.naturalWidth > 0) show(); // raced to load during wiring
  };

  const scan = () => document.querySelectorAll('img[loading="lazy"]').forEach(wire);
  scan();
  let t = 0;
  const rescan = () => { clearTimeout(t); t = setTimeout(scan, 120); };
  try { new MutationObserver(rescan).observe(document.body, { childList: true, subtree: true }); }
  catch (_) { /* initial scan still covers static images */ }
})();
