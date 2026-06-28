/* Smooth scroll (Lenis) — progressive enhancement.
   No-op if user prefers reduced motion or the CDN is unavailable. */
if (!matchMedia('(prefers-reduced-motion: reduce)').matches && innerWidth > 720) {
  import('https://cdn.jsdelivr.net/npm/lenis@1.1.13/dist/lenis.mjs')
    .then(({ default: Lenis }) => {
      const lenis = new Lenis({ duration: 1.1, smoothWheel: true });
      function raf(t) { lenis.raf(t); requestAnimationFrame(raf); }
      requestAnimationFrame(raf);
      // keep in-page anchor links working with Lenis
      document.querySelectorAll('a[href^="#"]').forEach(a => {
        a.addEventListener('click', e => {
          const id = a.getAttribute('href');
          if (id.length > 1) { const t = document.querySelector(id); if (t) { e.preventDefault(); lenis.scrollTo(t, { offset: -72 }); } }
        });
      });
    })
    .catch(() => { /* CDN blocked -> native scroll */ });
}
