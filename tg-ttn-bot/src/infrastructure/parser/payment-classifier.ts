/**
 * Payment Type Classifier — weighted scoring engine for COD vs Prepaid.
 *
 * Why not just regex match on "наложка"?
 *   - False positives: "БЕЗ наложки" matches "наложка"
 *   - Conflicts: "наложка 2800, але вже оплачено" — both signals present
 *   - Language mix: UA/RU/EN/translit + slang
 *   - Need explainable decisions for debugging
 *
 * This engine:
 *   1. Normalizes text (lowercase, strip punct, normalize spaces, emoji-strip)
 *   2. Walks weighted rules — each adds to or subtracts from score
 *   3. Returns final decision (COD if score >= threshold) + REASONING array
 *
 * The reasoning array makes every classification auditable — when a real-world
 * message produces a surprising result, you can see WHY in the log.
 */

export type PaymentMethod = "Cash" | "NonCash";

export type PaymentClassification = {
  /** True = COD (cash on delivery, наложка); False = prepaid */
  isCod: boolean;
  /** Aggregate score: positive = COD, negative = prepaid. Threshold = 0.3 */
  score: number;
  /** Confidence: 0..1, derived from |score| capped at 1.0 */
  confidence: number;
  /** Human-readable trace of every rule that fired */
  reasoning: Array<{ rule: string; matched: string; delta: number }>;
  /** Convenient mapping to OrderDraft.paymentMethod */
  paymentMethod: PaymentMethod;
};

const COD_THRESHOLD = 0.3;

// ─────────────────────────────────────────────────────────────────────
// Rule definitions — each rule contributes ±delta if its regex matches.
//
// Rules are intentionally NON-overlapping where possible (e.g. "без наложки"
// has higher priority than bare "наложка"). When they overlap, we use the
// `priority` field to pick the most specific one.
// ─────────────────────────────────────────────────────────────────────

type Rule = {
  name: string;
  pattern: RegExp;
  delta: number;
  /** When two rules both match, higher priority wins (lower-priority skipped). */
  priority?: number;
  /** Group of mutually-exclusive rules — only the highest-priority match fires. */
  group?: string;
};

// Cyrillic-friendly boundary — JS \b only works with ASCII.
// Use (?:^|[^\p{L}])  as "start-of-word" and (?=[^\p{L}]|$) as "end-of-word".
// /u flag mandatory for \p{L}.
const BS = `(?:^|[^\\p{L}])`;   // before-start
const AE = `(?=[^\\p{L}]|$)`;   // after-end (lookahead — doesn't consume)

const RULES: Rule[] = [
  // ═══ STRONG PREPAID (negative — beat COD rules via priority) ═══

  {
    name: "negation_without_cod",
    // "без наложки" / "не наложкой" — explicit negation
    pattern: new RegExp(`${BS}(?:без|не\\s+)\\s*(?:на[лд]ожк|післяплат|cod|оплат[аи]?\\s+при\\s+отриман)`, "iu"),
    delta: -1.5,
    priority: 100,
    group: "cod",
  },
  {
    name: "prepaid_explicit",
    pattern: new RegExp(`${BS}(?:передоплат|предоплат|prepay(?:ment|ed)?|100\\s*%\\s*оплат|повна\\s+оплат|полная\\s+оплат|тільки\\s+передоплат|только\\s+предоплат)`, "iu"),
    delta: -1.0,
    priority: 90,
  },
  {
    name: "already_paid",
    pattern: new RegExp(`${BS}(?:оплачен[оаи]|сплачен[оаи]|paid|payment\\s+received|вже\\s+сплат|уже\\s+оплач)`, "iu"),
    delta: -0.8,
    priority: 80,
  },
  {
    name: "card_payment",
    pattern: new RegExp(`${BS}(?:liqpay|приват\\s*24|monobank|mono|карт[аеи]|онлайн[ -]?оплат|безготівков)`, "iu"),
    delta: -0.4,
    priority: 60,
  },

  // ═══ STRONG COD (positive) ═══

  {
    name: "cod_naloga",
    // "наложка" / "надожка" (typo) / "наложен(ий/а) платіж"
    pattern: new RegExp(`${BS}(?:на[лд]ожк[аиуоіи]?|наложен[іи]ий\\s+платіж|наложен(?:а|им)\\s+оплат)`, "iu"),
    delta: 0.7,
    priority: 70,
    group: "cod",
  },
  {
    name: "cod_pislyaplata",
    // "післяплата" / "оплата при отриманні/получении/видачі"
    pattern: new RegExp(`${BS}(?:п[іи]сляплат[аеуоі]?|оплат(?:а|у)?\\s+при\\s+(?:отриман|получен|видач))`, "iu"),
    delta: 0.6,
    priority: 70,
    group: "cod",
  },
  {
    name: "cod_english",
    pattern: /(?:^|[^\p{L}])(?:cash\s+on\s+delivery|cod|c\.o\.d\.?)/iu,
    delta: 0.6,
    priority: 70,
    group: "cod",
  },
  {
    name: "cod_on_warehouse",
    // "оплата на пошті" / "сума на відділенні" / "оплата на отделении"
    pattern: new RegExp(`(?:оплат[аиу]?|сум[аиу]?)\\s+(?:на|у|в)\\s+(?:пошт|відділ|отделен|почт)`, "iu"),
    delta: 0.5,
    priority: 70,
    group: "cod",
  },
  {
    name: "cod_shorthand",
    // "нал" / "нл" — standalone shorthand (often with sum: "нал 2500")
    // Must be followed by digit or whitespace+digit to avoid matching parts of other words
    pattern: new RegExp(`${BS}(?:нал|нл)\\.?\\s*\\d{2,6}`, "iu"),
    delta: 0.5,
    priority: 50,
    group: "cod",
  },

  // ═══ "Опл XXXX" — dominant shop-owner shorthand (means COD with amount) ═══
  {
    name: "opl_keyword_with_amount",
    // "Опл 2200" / "ОПЛ 1500" / "опл.2500"
    pattern: new RegExp(`${BS}опл[а-яії]*\\.?\\s*\\d{2,6}`, "iu"),
    delta: 0.5,
    priority: 60,
    group: "cod",
  },

  // ═══ WEAK SIGNALS ═══
  {
    name: "amount_in_delivery_context",
    pattern: new RegExp(`(?:сум[аиу]|cost|ціна|price|вартість)\\s*[:=]?\\s*\\d{2,6}`, "iu"),
    delta: 0.15,
    priority: 30,
  },
  {
    name: "amount_with_currency",
    pattern: /\d{2,6}\s*(?:₴|грн|uah)(?:[^\p{L}]|$)/iu,
    delta: 0.1,
    priority: 20,
  },
];

// ─────────────────────────────────────────────────────────────────────
// Normalize text — single pass before scoring
// ─────────────────────────────────────────────────────────────────────

function normalize(raw: string): string {
  return raw
    .toLowerCase()
    // Strip emoji range
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, " ")
    // Normalize whitespace
    .replace(/\s+/g, " ")
    .trim();
}

// ─────────────────────────────────────────────────────────────────────
// Main entry — classify a message
// ─────────────────────────────────────────────────────────────────────

export function classifyPayment(rawText: string): PaymentClassification {
  const text = normalize(rawText);
  const reasoning: PaymentClassification["reasoning"] = [];
  const firedGroups = new Set<string>();
  let score = 0;

  // Sort by priority desc — higher-priority rules win on group conflicts
  const sortedRules = [...RULES].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  for (const rule of sortedRules) {
    // Skip if a higher-priority rule in same group already fired
    if (rule.group && firedGroups.has(rule.group)) continue;

    const match = text.match(rule.pattern);
    if (!match) continue;

    score += rule.delta;
    reasoning.push({
      rule: rule.name,
      matched: match[0].slice(0, 60),
      delta: rule.delta,
    });
    if (rule.group) firedGroups.add(rule.group);
  }

  const isCod = score >= COD_THRESHOLD;
  const confidence = Math.min(Math.abs(score), 1.0);

  return {
    isCod,
    score: Math.round(score * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    reasoning,
    paymentMethod: isCod ? "Cash" : "NonCash",
  };
}
