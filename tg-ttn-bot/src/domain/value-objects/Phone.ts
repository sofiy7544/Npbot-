/**
 * Phone — value object that GUARANTEES a normalized Ukrainian mobile number.
 *
 * Always +380XXXXXXXXX (13 chars total). Once you have a Phone instance,
 * you NEVER need to validate it again. Construction is the only place that fails.
 */
import { AppError } from "../../shared/result.js";

export class Phone {
  /** Canonical form: "+380XXXXXXXXX" */
  public readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  /** Parse raw input into a Phone or throw. */
  static parse(raw: string): Phone {
    const digits = raw.replace(/\D/g, "");

    let normalized: string;
    if (digits.length === 10 && digits.startsWith("0")) {
      // Domestic: 0XXxxxxxxx → +380XXxxxxxxx
      normalized = `+38${digits}`;
    } else if (digits.length === 12 && digits.startsWith("380")) {
      // International normal: 380XX… → +380XX…
      normalized = `+${digits}`;
    } else if (digits.length === 13 && digits.startsWith("3800")) {
      // Doubled trunk: +3800 5012345... → drop the trunk 0 → +380 5012345...
      normalized = `+380${digits.slice(4)}`;
    } else if (digits.length === 11 && digits.startsWith("80")) {
      // Missing country prefix digit "3": 80XX… (rare typo) → assume +380XX…
      normalized = `+38${digits.slice(1)}`;
    } else {
      throw new AppError(
        "validation.invalid_input",
        `Invalid Ukrainian phone: "${raw}" (got ${digits.length} digits)`,
        { raw, digits },
      );
    }

    // Validate operator code
    const operatorCode = normalized.slice(4, 6);
    const validOperators = new Set([
      "39", "50", "63", "66", "67", "68", "73",          // Kyivstar / Vodafone
      "91", "92", "93", "94", "95", "96", "97", "98", "99",
    ]);
    if (!validOperators.has(operatorCode)) {
      throw new AppError(
        "validation.invalid_input",
        `Unknown UA mobile operator code: ${operatorCode}`,
        { raw, normalized, operatorCode },
      );
    }

    return new Phone(normalized);
  }

  /** Try-version that returns null instead of throwing. */
  static tryParse(raw: string): Phone | null {
    try {
      return Phone.parse(raw);
    } catch {
      return null;
    }
  }

  /** Strip + sign — useful for NP API which wants pure digits. */
  toDigits(): string {
    return this.value.replace(/\D/g, "");
  }

  toString(): string {
    return this.value;
  }

  equals(other: Phone): boolean {
    return this.value === other.value;
  }
}
