/**
 * Order fingerprinting — deterministic hash for duplicate detection.
 *
 * Two orders are "the same" if they share:
 *   - normalized phone (digits only)
 *   - normalized recipient name (lowercase, no spaces/punct)
 *   - city + warehouse number
 *   - cost (within ±5 UAH tolerance)
 *
 * Fingerprint = sha256(phone + nameNorm + city + whNum + costBucket)
 * costBucket = floor(cost / 5) * 5 — so 2500 and 2502 dedupe
 *
 * Use:
 *   1) Before creating TTN, hash the draft → look up existing shipment in last 24h
 *   2) If match → ask user "Це той самий замовник? [Так, дублікат] [Ні, новий]"
 */
import { createHash } from "node:crypto";
import { Phone } from "./value-objects/Phone.js";

export type FingerprintInput = {
  recipientName?: string | null;
  recipientPhone?: string | null;
  cityName?: string | null;
  warehouseNumber?: string | null;
  cost?: number | null;
};

/** Normalize phone for hashing: prefer canonical +380XX..., fall back to raw digits. */
function normPhone(raw?: string | null): string {
  if (!raw) return "";
  const p = Phone.tryParse(raw);
  return p ? p.toDigits() : raw.replace(/\D/g, "");
}

export function orderFingerprint(input: FingerprintInput): string {
  const phone = normPhone(input.recipientPhone);
  const name = (input.recipientName ?? "")
    .toLowerCase()
    .replace(/[^а-яїієґa-z]/g, "");
  const city = (input.cityName ?? "").toLowerCase().trim();
  const wh = input.warehouseNumber ?? "";
  const costBucket = input.cost ? Math.floor(input.cost / 5) * 5 : 0;

  const key = `${phone}|${name}|${city}|${wh}|${costBucket}`;
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

/** Looser fingerprint — just phone (catches "same customer, different items"). */
export function customerFingerprint(phone: string): string {
  const digits = normPhone(phone);
  return createHash("sha256").update(`customer:${digits}`).digest("hex").slice(0, 24);
}

/** Levenshtein-based similarity for fuzzy duplicate detection on free-form names. */
export function nameSimilarity(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^а-яїієґa-z]/g, "");
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return 1;
  if (na.length === 0 || nb.length === 0) return 0;
  const max = Math.max(na.length, nb.length);
  let dist = 0;
  // Cheap Hamming-like for same length, fall back to levenshtein for different
  if (na.length === nb.length) {
    for (let i = 0; i < na.length; i++) if (na[i] !== nb[i]) dist++;
  } else {
    // mini-Levenshtein
    const dp: number[][] = [];
    for (let i = 0; i <= na.length; i++) {
      dp[i] = [i];
      for (let j = 1; j <= nb.length; j++) {
        dp[i][j] = i === 0 ? j : Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (na[i - 1] === nb[j - 1] ? 0 : 1),
        );
      }
    }
    dist = dp[na.length][nb.length];
  }
  return 1 - dist / max;
}
