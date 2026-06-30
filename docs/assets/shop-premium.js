/* Shop premium polish — progressive enhancement for shop.html.
   Adds a subtle pointer-driven 3D tilt to product-card media (.pcard__media),
   re-applied across the SPA's re-renders. shop.html is the working store — this
   only sets an inline transform on an element that has none of its own, so the
   existing card hover-lift and image scale are untouched and nothing is overridden.

   Safe by construction: reduced-motion or coarse/touch pointer -> no-op. */
(function () {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  const st = document.createElement('style');
  st.textContent =
    '.pcard{perspective:900px}' +
    '.pcard__media{transform-style:preserve-3d;transition:background-color .3s ease,box-shadow .4s ease,transform .25s cubic-bezier(.22,.61,.36,1)}';
  document.head.appendChild(st);

  const TILT = 5; // max degrees
  const wired = new WeakSet();

  const wire = card => {
    const media = card.querySelector('.pcard__media');
    if (!media || wired.has(media)) return;
    wired.add(media);
    let raf = 0, rx = 0, ry = 0;
    const apply = () => {
      raf = 0;
      media.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
    };
    media.addEventListener('pointermove', e => {
      const r = media.getBoundingClientRect();
      ry = ((e.clientX - r.left) / r.width - 0.5) * TILT * 2;
      rx = -((e.clientY - r.top) / r.height - 0.5) * TILT * 2;
      if (!raf) raf = requestAnimationFrame(apply);
    });
    media.addEventListener('pointerleave', () => {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      media.style.transform = '';
    });
  };

  const scan = () => document.querySelectorAll('.pcard').forEach(wire);

  scan();
  // the SPA re-renders cards on route + filter changes; re-scan (debounced).
  let t = 0;
  const rescan = () => { clearTimeout(t); t = setTimeout(scan, 120); };
  addEventListener('hashchange', rescan);
  try {
    new MutationObserver(rescan).observe(document.body, { childList: true, subtree: true });
  } catch (_) { /* no MutationObserver -> initial + hashchange scans still cover most */ }
})();
