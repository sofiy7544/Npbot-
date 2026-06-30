/* GSAP scroll-reveal — progressive enhancement (Batch: GSAP reveal).
   The page already reveals `.reveal` elements via a CSS transition + inline
   IntersectionObserver (see index.html). This module UPGRADES that to smoother,
   staggered batch reveals using GSAP + ScrollTrigger when the CDN is reachable.

   Safe by construction:
   - prefers-reduced-motion  → do nothing (CSS already shows everything).
   - CDN blocked / no GSAP    → do nothing; the existing observer reveals as before.
   - GSAP available           → it sets INLINE opacity/transform, which override the
     `.reveal.in` class rules, so the two systems never fight. */
(async function () {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const els = Array.from(document.querySelectorAll('.reveal'));
  if (!els.length) return;

  let gsap, ScrollTrigger;
  try {
    const g = await import('https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js/+esm');
    const s = await import('https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js/+esm');
    gsap = g.default || g.gsap;
    ScrollTrigger = s.default || s.ScrollTrigger;
    if (!gsap || !ScrollTrigger) return; // malformed module → leave CSS fallback
    gsap.registerPlugin(ScrollTrigger);
  } catch (_) {
    return; // CDN unavailable → native CSS reveal stays in charge
  }

  // The inline observer may already have revealed above-the-fold elements by the
  // time the CDN module arrives — leave those alone to avoid a re-animation flash.
  // Only take over the ones still pending (off-screen).
  const pending = els.filter(el => !el.classList.contains('in'));
  if (!pending.length) return;

  gsap.set(pending, { opacity: 0, y: 30, willChange: 'opacity, transform' });

  ScrollTrigger.batch(pending, {
    start: 'top 90%',
    once: true,
    onEnter: batch => gsap.to(batch, {
      opacity: 1,
      y: 0,
      duration: 0.8,
      ease: 'power3.out',
      stagger: { each: 0.09, from: 'start' },
      overwrite: true,
      clearProps: 'willChange'
    })
  });

  // recompute positions once images/fonts settle (avoids early/late triggers)
  addEventListener('load', () => ScrollTrigger.refresh());
})();
