#!/usr/bin/env node
/* Generate an .avif next to every .webp under img/, and write img/avif-manifest.json.
 *
 * AVIF is ~30–50% smaller than webp at equal quality. The site uses this as a
 * progressive enhancement: assets/avif.js upgrades <img> from webp to avif only
 * for paths listed in the manifest, and only when the browser supports avif.
 * So nothing breaks if the avif files are missing — this script just unlocks them.
 *
 * Requires sharp (has no network access in CI sandboxes):
 *     npm i -D sharp
 *     node scripts/make-avif.mjs
 *     # then mirror img/ -> docs/img/ and commit the .avif + manifest
 *
 * Re-runnable: skips avif files already newer than their webp source.
 */
import { readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';

let sharp;
try { sharp = (await import('sharp')).default; }
catch {
  console.error('Missing dependency "sharp".\nInstall it where tooling/network is available:\n  npm i -D sharp');
  process.exit(1);
}

const ROOT = 'img';
const QUALITY = 50;   // avif q50 ≈ webp q80 visually, far smaller
const EFFORT = 4;     // 0..9 (higher = slower, a bit smaller)

const walk = d => readdirSync(d, { withFileTypes: true })
  .flatMap(e => { const p = join(d, e.name); return e.isDirectory() ? walk(p) : [p]; });

const webps = walk(ROOT).filter(f => extname(f).toLowerCase() === '.webp');
const manifest = [];
let made = 0, skipped = 0, failed = 0;

for (const src of webps) {
  const out = src.replace(/\.webp$/i, '.avif');
  try {
    if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) {
      skipped++;
    } else {
      await sharp(src).avif({ quality: QUALITY, effort: EFFORT }).toFile(out);
      made++;
    }
    if (existsSync(out)) manifest.push(src.replace(/\\/g, '/'));
  } catch (e) {
    failed++;
    console.error('FAIL', src, e.message);
  }
}

writeFileSync(join(ROOT, 'avif-manifest.json'), JSON.stringify(manifest));
console.log(`avif: made ${made}, skipped ${skipped}, failed ${failed}, manifest ${manifest.length} entries`);
console.log('Next: cp -r img/* docs/img/  (mirror)  &&  git add img docs/img  &&  commit');
