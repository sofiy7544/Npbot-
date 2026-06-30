/* Catalog colour swatches + product links — progressive enhancement (Batch C / linking).
   The catalog lists every colour of a product as its own near-identical card.
   This collapses same-product colour variants into ONE card with a row of
   clickable swatches that swap the photo, name, colour label and price dot, and
   links each card's photo + name to the standalone product page (product.html?id=).

   Pure DOM enhancement: if it can't run, the original cards stay untouched. The
   collapse happens synchronously (no flash); the product-link layer is best-effort
   — it needs catalog-data.json (same dir) to map image paths to ids and is applied
   once that fetch resolves. If the fetch fails, swatches still work, links are skipped. */
(async function () {
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
  .phlink{display:contents}
  a.nmlink{color:inherit;text-decoration:none}
  a.nmlink:hover{color:var(--clay)}
  @media(prefers-reduced-motion:reduce){.sw,.card .ph img{transition:none}}`;
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  const txt = el => (el ? el.textContent.trim() : '');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // image-path -> product id (filled after fetch; mutated in place so closures see it)
  const bySrc = {};
  const linked = []; // { update(src), getSrc() } for refreshing hrefs post-fetch

  // turn a card's photo + name into links to product.html; returns an updater(src)
  const wireLink = card => {
    const img = card.querySelector('.ph img');
    const nmEl = card.querySelector('.nm');
    if (!img) return null;

    // wrap the image in a display:contents anchor (keeps grid layout intact)
    let a = card.querySelector('a.phlink');
    if (!a) {
      a = document.createElement('a');
      a.className = 'phlink';
      img.parentNode.insertBefore(a, img);
      a.appendChild(img);
    }
    // wrap the name text in a link too (crawlable, accessible)
    let nmA = null;
    if (nmEl) {
      nmA = document.createElement('a');
      nmA.className = 'nmlink';
      nmA.textContent = nmEl.textContent;
      nmEl.textContent = '';
      nmEl.appendChild(nmA);
    }
    const update = src => {
      const id = bySrc[src];
      if (!id) { a.removeAttribute('href'); if (nmA) nmA.removeAttribute('href'); return; }
      const href = 'product.html?id=' + encodeURIComponent(id);
      a.setAttribute('href', href);
      if (nmA) nmA.setAttribute('href', href);
    };
    return { update, nmA };
  };

  // ── synchronous pass: collapse colour variants + build swatches + wire links ──
  grids.forEach(grid => {
    const cards = Array.from(grid.querySelectorAll('.card'));
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
      const dzEl = host.querySelector('.dz');
      const dot = host.querySelector('.pr i');
      const meta = host.querySelector('.meta');

      // remove sibling variant cards (keep the first as host)
      variants.slice(1).forEach(v => v.card.remove());

      // wire links first so the swatch handler can refresh the href (nm text moves into the link)
      const link = wireLink(host);
      host.dataset.linked = '1';
      const nmTarget = link && link.nmA ? link.nmA : host.querySelector('.nm');

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
          if (nmTarget) nmTarget.textContent = v.full;
          if (dzEl) dzEl.textContent = v.dz;
          if (dot && v.dot) dot.setAttribute('style', v.dot);
          if (link) link.update(v.src);
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
      const pr = meta.querySelector('.pr');
      if (pr && pr.nextSibling) meta.insertBefore(row, pr.nextSibling);
      else meta.appendChild(row);

      if (link) linked.push({ link, getSrc: () => img.getAttribute('src') });
    });

    // link any remaining (non-collapsed) cards to their product page
    grid.querySelectorAll('.card').forEach(card => {
      if (card.dataset.linked) return;
      const img = card.querySelector('.ph img');
      const link = wireLink(card);
      card.dataset.linked = '1';
      if (link && img) linked.push({ link, getSrc: () => img.getAttribute('src') });
    });
  });

  // ── async tail: load id map, then activate the product links ──
  try {
    const data = await fetch('catalog-data.json').then(r => r.json());
    (data.products || []).forEach(p => { if (p.img && p.id) bySrc[p.img] = p.id; });
    linked.forEach(e => e.link.update(e.getSrc()));
  } catch (_) { /* no data → cards stay un-linked, swatches already work */ }
})();
