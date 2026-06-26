/**
 * Money value object — unit tests.
 */
import { Money } from "./value-objects/Money.js";

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`✅ ${name}`); passed++; }
  else { console.log(`❌ ${name}${detail ? `: ${detail}` : ""}`); failed++; }
}

// ── fromUah ──────────────────────────────────────────────
const m1 = Money.fromUah(2500);
assert("fromUah(2500).toUah() === 2500", m1.toUah() === 2500);
assert("fromUah(2500).kopecks === 250000", m1.kopecks === 250000);

const m2 = Money.fromUah(0);
assert("zero allowed", m2.toUah() === 0);

// ── fromKopecks ──────────────────────────────────────────
const m3 = Money.fromKopecks(2599_50);
assert("fromKopecks(259950).toUah() === 2599", m3.toUah() === 2599);

// ── format ───────────────────────────────────────────────
const f = Money.fromUah(2500).format();
assert("format() returns string with ₴", /₴/.test(f), `got "${f}"`);
// Ukrainian locale uses NBSP ( ) as thousands separator
const f2 = Money.fromUah(12500).format();
assert("format(12500) has separator", /\d/.test(f2) && f2.length >= 8);

// ── toNpString ───────────────────────────────────────────
assert("toNpString() = string of UAH integer", Money.fromUah(2500).toNpString() === "2500");

// ── equals ───────────────────────────────────────────────
assert("equals same kopecks", Money.fromUah(100).equals(Money.fromKopecks(10000)));
assert("not equals different", !Money.fromUah(100).equals(Money.fromUah(200)));

// ── Error cases ──────────────────────────────────────────
let threw = false;
try { Money.fromUah(-1); } catch { threw = true; }
assert("rejects negative", threw);

threw = false;
try { Money.fromUah(NaN); } catch { threw = true; }
assert("rejects NaN", threw);

threw = false;
try { Money.fromUah(1_000_000); } catch { threw = true; }
assert("rejects >999_999", threw);

threw = false;
try { Money.fromKopecks(1.5); } catch { threw = true; }
assert("fromKopecks rejects non-integer", threw);

threw = false;
try { Money.fromKopecks(-1); } catch { threw = true; }
assert("fromKopecks rejects negative", threw);

console.log(`\n──────────────────────────────`);
console.log(`Money: ${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
