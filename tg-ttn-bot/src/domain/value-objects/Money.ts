/**
 * Money — value object for UAH amounts.
 *
 * Stored as integer kopecks internally (avoid floating-point errors).
 * For display, formats as "2,500 ₴".
 */
import { AppError } from "../../shared/result.js";

export class Money {
  /** Amount in kopecks (1 UAH = 100 kopecks). */
  public readonly kopecks: number;

  private constructor(kopecks: number) {
    this.kopecks = kopecks;
  }

  /** From UAH (e.g. 2500 = 2,500 ₴ = 250,000 kopecks). */
  static fromUah(uah: number): Money {
    if (!Number.isFinite(uah) || uah < 0) {
      throw new AppError("validation.invalid_input", `Invalid UAH amount: ${uah}`, { uah });
    }
    if (uah > 999_999) {
      throw new AppError("validation.invalid_input", `UAH amount too large: ${uah}`, { uah });
    }
    return new Money(Math.round(uah * 100));
  }

  /** From integer kopecks (e.g. from DB). */
  static fromKopecks(k: number): Money {
    if (!Number.isInteger(k) || k < 0) {
      throw new AppError("validation.invalid_input", `Invalid kopecks: ${k}`, { kopecks: k });
    }
    return new Money(k);
  }

  /** Whole UAH (rounded down). For display: use format(). */
  toUah(): number {
    return Math.floor(this.kopecks / 100);
  }

  /** "2,500 ₴" */
  format(): string {
    const uah = this.toUah();
    return `${uah.toLocaleString("uk-UA")} ₴`;
  }

  /** For NP API serialization — wants integer UAH as string. */
  toNpString(): string {
    return String(this.toUah());
  }

  equals(other: Money): boolean {
    return this.kopecks === other.kopecks;
  }
}
