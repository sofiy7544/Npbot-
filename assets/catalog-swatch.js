/* Catalog colour swatches — progressive enhancement (Batch C).
   The catalog lists every colour of a product as its own near-identical card.
   This collapses same-product colour variants into ONE card with a row of
   clickable swatches that swap the photo, name, colour label and price dot.

   Pure DOM enhancement: if it can't run, the original cards stay untouched. */
(function () {
  const grids = document.querySelectorAll('.cat .grid');
  if (!grids.length) return;

  // styles (injected so the base page only needs the <script> tag)
  const css = `
  .swrow{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin-top:11px}
  .sw{width:19px;height:19px;border-radius:50%;cursor:pointer;border:0;padding:0;
      box-shadow:0 0 0 1px var(--line);transition:transform .15s var(--ease),box-shadow .15s;
      -webkit-appearance:none;appearance:none}
  .sw:hover{transform:scale(1.16)}
  .sw:focus-visible{outline:2px solid var(--clay);outline-offset:2px}
  .sw[aria-pressed="true"]{box-shadow:0 0 0 2px var(--ink);transform:scale(1.08)}
  .swn{font-size:11px;color:var(--muted);font-weight:600;margin-left:2px}
  .card .ph img{transition:transform .5s var(--ease),opacity .25s var(--ease)}
  .card.swapping .ph img{opacity:.25}
  @media(prefers-reduced-motion:reduce){.sw,.card .ph img{transition:none}}`;
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  const txt = el => (el ? el.textContent.trim() : '');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  grids.forEach(grid => {
    const cards = Array.from(grid.querySelectorAll('.card'));
    // group consecutive cards that share the same base name (name minus " · Colour")
    const groups = new Map();
    cards.forEach(card => {
      const nmEl = card.querySelector('.nm');
      const img = card.querySelector('.ph img');
      if (!nmEl || !img) return;
      const dzEl = card.querySelector('.dz');
      const dot = card.querySelector('.pr i');
      const full = txt(nmEl);
      const i = full.lastIndexOf(' · ');
      const base = i > -1 ? full.slice(0, i) : full;
      const color = i > -1 ? full.slice(i + 3) : '';
      if (!color) return; // no colour suffix → not a colour variant, leave alone
      const v = {
        card, color, full,
        src: img.getAttribute('src'),
        alt: img.getAttribute('alt'),
        dz: txt(dzEl),
        dot: dot ? dot.getAttribute('style') : ''
      };
      if (!groups.has(base)) groups.set(base, []);
      groups.get(base).push(v);
    });

    groups.forEach(variants => {
      if (variants.length < 2) return; // nothing to collapse
      const host = variants[0].card;
      const img = host.querySelector('.ph img');
      const nmEl = host.querySelector('.nm');
      const dzEl = host.querySelector('.dz');
      const dot = host.querySelector('.pr i');
      const meta = host.querySelector('.meta');

      // remove sibling variant cards (keep the first as host)
      variants.slice(1).forEach(v => v.card.remove());

      // build swatch row
      const row = document.createElement('div');
      row.className = 'swrow';
      const count = document.createElement('span');
      count.className = 'swn';
      row.appendChild(count);

      const select = idx => {
        const v = variants[idx];
        const apply = () => {
          img.src = v.src;
          img.alt = v.alt;
          if (nmEl) nmEl.textContent = v.full;
          if (dzEl) dzEl.textContent = v.dz;
          if (dot && v.dot) dot.setAttribute('style', v.dot);
          host.classList.remove('swapping');
        };
        if (reduce) { apply(); }
        else {
          host.classList.add('swapping');
          img.addEventListener('load', apply, { once: true });
          // safety: apply even if cached image fires no load event
          setTimeout(apply, 260);
          img.src = v.src;
        }
        count.textContent = `${variants.length} кольорів · ${v.color}`;
        row.querySelectorAll('.sw').forEach((b, k) =>
          b.setAttribute('aria-pressed', k === idx ? 'true' : 'false'));
      };

      variants.forEach((v, idx) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sw';
        b.setAttribute('style', v.dot || 'background:#ccc');
        b.setAttribute('aria-label', v.color);
        b.setAttribute('title', v.color);
        b.setAttribute('aria-pressed', idx === 0 ? 'true' : 'false');
        b.addEventListener('click', () => select(idx));
        row.appendChild(b);
      });

      count.textContent = `${variants.length} кольорів · ${variants[0].color}`;
      // place swatches right after the price line
      const pr = meta.querySelector('.pr');
      if (pr && pr.nextSibling) meta.insertBefore(row, pr.nextSibling);
      else meta.appendChild(row);
    });
  });
})();
