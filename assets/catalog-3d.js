/* Catalog 3D hover-preview — progressive enhancement.
   Pointer-driven 3D tilt on catalog cards with a subtle image parallax, for a
   premium "pick it up and look" feel. Pure transforms, no CDN.

   Safe by construction:
   - prefers-reduced-motion        → do nothing.
   - touch / coarse pointer        → do nothing (tilt needs a fine pointer).
   - runs AFTER catalog-swatch.js  → only tilts the cards that remain.
   On pointer-leave all inline transforms are cleared, so the base CSS hover
   (lift + image scale) takes back over — nothing is permanently overridden. */
(function () {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  const cards = document.querySelectorAll('.cat .grid .card');
  if (!cards.length) return;

  const TILT = 6;   // max degrees
  const SHIFT = 0.6; // image parallax px per degree

  cards.forEach(card => {
    const img = card.querySelector('.ph img');
    let raf = 0, rx = 0, ry = 0;

    const apply = () => {
      raf = 0;
      card.style.transform =
        `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-6px)`;
      if (img) {
        img.style.transform =
          `scale(1.06) translate(${(ry * SHIFT).toFixed(1)}px, ${(-rx * SHIFT).toFixed(1)}px)`;
      }
    };

    const onMove = e => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;  // -0.5 … 0.5
      const py = (e.clientY - r.top) / r.height - 0.5;
      ry = px * TILT * 2;   // horizontal → rotateY
      rx = -py * TILT * 2;  // vertical   → rotateX
      if (!raf) raf = requestAnimationFrame(apply);
    };

    const reset = () => {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      card.style.transform = '';
      if (img) img.style.transform = '';
    };

    card.style.transformStyle = 'preserve-3d';
    card.addEventListener('pointermove', onMove);
    card.addEventListener('pointerleave', reset);
  });
})();
