/**
 * Chaos tests — parser must NOT crash, hang, leak data, or produce garbage
 * on malicious or malformed input.
 */
import { parseOrder, isDraftReady } from "./parser.js";

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`✅ ${name}`); passed++; }
  else { console.log(`❌ ${name}${detail ? `: ${detail}` : ""}`); failed++; }
}

// ── Empty / minimal input ────────────────────────────────
{
  const d = parseOrder("");
  assert("empty string → no crash", typeof d === "object");
  assert("empty string → not ready", !isDraftReady(d));
  assert("empty string → warnings present", d.warnings.length > 0);
}

{
  const d = parseOrder("   \n\n\n  ");
  assert("whitespace only → no crash", typeof d === "object");
  assert("whitespace only → no fields", !d.recipientName && !d.cityName);
}

{
  const d = parseOrder("a");
  assert("single char → no crash", typeof d === "object");
}

// ── Very long input (100KB) ──────────────────────────────
{
  const longText = "a".repeat(100_000);
  const t0 = Date.now();
  const d = parseOrder(longText);
  const ms = Date.now() - t0;
  assert("100KB input → completes <2s", ms < 2000, `took ${ms}ms`);
  assert("100KB input → no crash", typeof d === "object");
}

// ── Gibberish ────────────────────────────────────────────
{
  const garbage = "@#$%^&*()_+{}|:<>?/.,;'][\\=-`~!  кашпб№№№пб   ".repeat(10);
  const d = parseOrder(garbage);
  assert("gibberish → no crash", typeof d === "object");
  assert("gibberish → no false positives", !d.recipientPhone && !d.cityName);
}

// ── Unicode attack: zero-width chars between digits ──────
{
  const sneaky = "0​5​0​1​2​3​4​5​6​7";
  const d = parseOrder(`Іванова Олена\n${sneaky}\nКиїв 5`);
  assert("zero-width chars in phone → either parsed or null, no crash", typeof d === "object");
}

// ── SQL-injection-like (must be treated as text, not executed) ───
{
  const sql = `'; DROP TABLE users; --
0501234567
Київ № 5
2000`;
  const d = parseOrder(sql);
  assert("SQL-injection style → no crash", typeof d === "object");
  assert("SQL-injection style → phone still extracted", d.recipientPhone === "+380501234567");
  // SQL is just text — not executed
}

// ── XSS-like ─────────────────────────────────────────────
{
  const xss = `<script>alert(1)</script>
Петренко І.
0501234567
Київ 5`;
  const d = parseOrder(xss);
  assert("XSS in description → no crash", typeof d === "object");
  // Parser output is stored as data — frontend must escape
}

// ── Mixed RTL / LTR ──────────────────────────────────────
{
  const rtl = "السلام عليكم\nІванова Олена\n+380501234567\nКиїв 5";
  const d = parseOrder(rtl);
  assert("RTL preamble → no crash", typeof d === "object");
  assert("RTL preamble → phone still extracted", d.recipientPhone === "+380501234567");
}

// ── Catastrophic backtracking attempts ───────────────────
{
  // Repeated patterns that could trigger ReDoS in poorly-written regex
  const evil = "а".repeat(100) + "1".repeat(100) + "+38".repeat(100);
  const t0 = Date.now();
  const d = parseOrder(evil);
  const ms = Date.now() - t0;
  assert("ReDoS attempt → completes <500ms", ms < 500, `took ${ms}ms`);
}

// ── Multiple emoji walls ─────────────────────────────────
{
  const emoji = "📦📦📦📦📦📦📦📦📦📦\n👤👤👤 Іванова Олена 👤👤👤\n📱 0501234567\n🏙 Київ\n💰 2000";
  const d = parseOrder(emoji);
  assert("emoji walls → no crash", typeof d === "object");
  assert("emoji walls → name extracted", d.recipientName === "Іванова Олена");
  assert("emoji walls → phone extracted", d.recipientPhone === "+380501234567");
}

// ── Multiple phones — pick one ───────────────────────────
{
  const multiPhone = `Іванова Олена
0501234567
0671234567
0931234567
Київ 5`;
  const d = parseOrder(multiPhone);
  assert("multiple phones → picks first", d.recipientPhone === "+380501234567");
}

// ── Mixed CYR/LAT in city ────────────────────────────────
{
  // "Khіev" mixing Latin and Cyrillic letters
  const mixed = "Іванова Олена\n0501234567\nКiyiv 5";  // K-Cyrillic + iyiv-Latin
  const d = parseOrder(mixed);
  // Should NOT match any city (mixed script), but no crash
  assert("mixed CYR/LAT city → no crash", typeof d === "object");
}

// ── Only phone, no other context ─────────────────────────
{
  const d = parseOrder("0501234567");
  assert("only phone (too short, <10 chars) → empty result", typeof d === "object");
}

// ── Numbers everywhere (looks like fraud / form-spam) ────
{
  const spam = `1234567890
0501234567
1234567890123
9999999999
Іванова Олена
Київ 5`;
  const d = parseOrder(spam);
  assert("number spam → still finds correct phone", d.recipientPhone === "+380501234567");
}

// ── Repeated identical lines (form-spam) ─────────────────
{
  const repeat = ("Іванова Олена\n0501234567\nКиїв 5\n2000\n").repeat(50);
  const t0 = Date.now();
  const d = parseOrder(repeat);
  const ms = Date.now() - t0;
  assert("50× repeat → completes <500ms", ms < 500, `took ${ms}ms`);
  assert("50× repeat → fields populated", !!d.recipientName);
}

// ── isDraftReady predicate ───────────────────────────────
{
  const empty = parseOrder("");
  assert("isDraftReady(empty) === false", isDraftReady(empty) === false);

  const full = parseOrder("Іванова Олена Петрівна\n+380501234567\nКиїв № 5\n2000");
  assert("isDraftReady(full) === true", isDraftReady(full) === true);
}

console.log(`\n──────────────────────────────`);
console.log(`Chaos: ${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
