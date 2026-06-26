/**
 * Order fingerprint — deterministic dedup hashing.
 */
import { orderFingerprint, customerFingerprint, nameSimilarity } from "./order-fingerprint.js";

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`✅ ${name}`); passed++; }
  else { console.log(`❌ ${name}${detail ? `: ${detail}` : ""}`); failed++; }
}

// ── Determinism ──────────────────────────────────────────
const base = { recipientName: "Іванова Олена", recipientPhone: "+380501234567", cityName: "Київ", warehouseNumber: "5", cost: 2500 };
const h1 = orderFingerprint(base);
const h2 = orderFingerprint(base);
assert("same input → same hash", h1 === h2);
assert("hash is 32 chars", h1.length === 32);

// ── Cost bucket — ±5 UAH dedupe ──────────────────────────
const h3 = orderFingerprint({ ...base, cost: 2502 });
assert("cost 2500 vs 2502 → same hash (bucket of 5)", h1 === h3);

const h4 = orderFingerprint({ ...base, cost: 2510 });
assert("cost 2500 vs 2510 → different hash", h1 !== h4);

// ── Phone normalization ──────────────────────────────────
const h5 = orderFingerprint({ ...base, recipientPhone: "0501234567" });
assert("+380501234567 vs 0501234567 → same hash", h1 === h5);

const h6 = orderFingerprint({ ...base, recipientPhone: "+38 050 123 45 67" });
assert("spaced phone → same hash", h1 === h6);

// ── Name normalization (lowercase, strip punct) ──────────
const h7 = orderFingerprint({ ...base, recipientName: "ІВАНОВА ОЛЕНА" });
assert("uppercase name → same hash", h1 === h7);

const h8 = orderFingerprint({ ...base, recipientName: "Іванова, Олена!" });
assert("punctuation in name → same hash", h1 === h8);

// ── Different orders ─────────────────────────────────────
const h9 = orderFingerprint({ ...base, recipientName: "Петров Іван" });
assert("different name → different hash", h1 !== h9);

const h10 = orderFingerprint({ ...base, cityName: "Львів" });
assert("different city → different hash", h1 !== h10);

const h11 = orderFingerprint({ ...base, warehouseNumber: "10" });
assert("different warehouse → different hash", h1 !== h11);

// ── Missing fields ───────────────────────────────────────
const h12 = orderFingerprint({});
const h13 = orderFingerprint({});
assert("empty input → deterministic hash", h12 === h13);

// ── customerFingerprint ──────────────────────────────────
const c1 = customerFingerprint("+380501234567");
const c2 = customerFingerprint("0501234567");
const c3 = customerFingerprint("+38 (050) 123-45-67");
assert("customer fingerprint normalized: full → 0XX", c1 === c2);
assert("customer fingerprint normalized: spaced", c1 === c3);

// ── nameSimilarity ───────────────────────────────────────
assert("identical names → 1.0", nameSimilarity("Іванова Олена", "Іванова Олена") === 1);
assert("case-insensitive", nameSimilarity("Іванова Олена", "ІВАНОВА ОЛЕНА") === 1);
assert("punctuation ignored", nameSimilarity("Іванова, Олена.", "Іванова Олена") === 1);

const s1 = nameSimilarity("Іванова Олена", "Іванова Олександра");
assert("partial overlap < 1", s1 < 1 && s1 > 0.5, `got ${s1}`);

const s2 = nameSimilarity("Іванова", "Петров");
assert("totally different ≈ 0", s2 < 0.4, `got ${s2}`);

console.log(`\n──────────────────────────────`);
console.log(`Fingerprint: ${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
