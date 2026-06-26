/**
 * Phone value object — unit tests.
 * Run: npx tsx src/domain/Phone.test.ts
 */
import { Phone } from "./value-objects/Phone.js";

type Case = { name: string; input: string; expectValue?: string; expectError?: boolean };

const cases: Case[] = [
  // ── Valid ─────────────────────────────────────────────────
  { name: "0XX domestic", input: "0501234567", expectValue: "+380501234567" },
  { name: "+380 international", input: "+380501234567", expectValue: "+380501234567" },
  { name: "380 no plus", input: "380501234567", expectValue: "+380501234567" },
  { name: "0380XX (with leading 0)", input: "+3800501234567", expectValue: "+380501234567" },
  { name: "spaced +380 050", input: "+380 050 123 45 67", expectValue: "+380501234567" },
  { name: "spaced +380 (99)", input: "+380 (99) 259 13 25", expectValue: "+380992591325" },
  { name: "parens (067)", input: "(067) 123-45-67", expectValue: "+380671234567" },
  { name: "dashes", input: "067-123-45-67", expectValue: "+380671234567" },
  { name: "dots", input: "050.123.45.67", expectValue: "+380501234567" },
  { name: "spaced 066", input: "066 663 4114", expectValue: "+380666634114" },

  // ── All UA operators ──────────────────────────────────────
  { name: "operator 39", input: "0391234567", expectValue: "+380391234567" },
  { name: "operator 50", input: "0501234567", expectValue: "+380501234567" },
  { name: "operator 63", input: "0631234567", expectValue: "+380631234567" },
  { name: "operator 66", input: "0661234567", expectValue: "+380661234567" },
  { name: "operator 67", input: "0671234567", expectValue: "+380671234567" },
  { name: "operator 68", input: "0681234567", expectValue: "+380681234567" },
  { name: "operator 73", input: "0731234567", expectValue: "+380731234567" },
  { name: "operator 91", input: "0911234567", expectValue: "+380911234567" },
  { name: "operator 93", input: "0931234567", expectValue: "+380931234567" },
  { name: "operator 95", input: "0951234567", expectValue: "+380951234567" },
  { name: "operator 96", input: "0961234567", expectValue: "+380961234567" },
  { name: "operator 97", input: "0971234567", expectValue: "+380971234567" },
  { name: "operator 98", input: "0981234567", expectValue: "+380981234567" },
  { name: "operator 99", input: "0991234567", expectValue: "+380991234567" },

  // ── Invalid (must throw) ──────────────────────────────────
  { name: "too short", input: "050123", expectError: true },
  { name: "too long", input: "05012345678901234", expectError: true },
  { name: "non-numeric", input: "abc-def-ghij", expectError: true },
  { name: "empty", input: "", expectError: true },
  { name: "invalid operator 11", input: "0111234567", expectError: true },
  { name: "invalid operator 22", input: "0221234567", expectError: true },
  { name: "landline 044", input: "0441234567", expectError: true }, // not in operators list
  { name: "us number", input: "+12025551234", expectError: true },
];

let passed = 0, failed = 0;
for (const c of cases) {
  try {
    const p = Phone.parse(c.input);
    if (c.expectError) {
      console.log(`❌ ${c.name}: expected error, got "${p.value}"`); failed++;
    } else if (p.value !== c.expectValue) {
      console.log(`❌ ${c.name}: got "${p.value}", expected "${c.expectValue}"`); failed++;
    } else { console.log(`✅ ${c.name}`); passed++; }
  } catch (e) {
    if (c.expectError) { console.log(`✅ ${c.name} (rejected: ${(e as Error).message.slice(0, 50)})`); passed++; }
    else { console.log(`❌ ${c.name}: unexpected error: ${(e as Error).message}`); failed++; }
  }
}

// tryParse
const t1 = Phone.tryParse("0501234567");
if (t1?.value === "+380501234567") { console.log("✅ tryParse valid → Phone"); passed++; }
else { console.log("❌ tryParse valid failed"); failed++; }

const t2 = Phone.tryParse("garbage");
if (t2 === null) { console.log("✅ tryParse invalid → null"); passed++; }
else { console.log("❌ tryParse invalid should return null"); failed++; }

// equals
const e1 = Phone.parse("0501234567");
const e2 = Phone.parse("+380501234567");
if (e1.equals(e2)) { console.log("✅ equals(): same number normalized"); passed++; }
else { console.log("❌ equals failed"); failed++; }

// toDigits
const d = Phone.parse("+380501234567").toDigits();
if (d === "380501234567") { console.log("✅ toDigits()"); passed++; }
else { console.log(`❌ toDigits got "${d}"`); failed++; }

console.log(`\n──────────────────────────────`);
console.log(`Phone: ${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
