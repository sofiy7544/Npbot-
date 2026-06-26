/**
 * Multi-order segmenter — splits a Telegram message into individual orders.
 *
 * Strategy:
 *   1. Count phone numbers in text — if N≥2, likely multiple orders
 *   2. Try rule-based split: paragraph breaks (\n\n+) OR numbered lists (1. 2. 3.)
 *   3. Validate each segment has ≥1 phone OR ≥1 city+warehouse — discard garbage
 *
 * If rule-based produces 2+ valid segments → return them.
 * Otherwise → caller may fall back to AI segmenter for hard cases.
 *
 * Pure function, no I/O — easy to test.
 */
import { parseOrder, isDraftReady } from "./parser.js";

// Same phone regex as parser.ts (kept in sync)
const PHONE_RE = /(?:\+?38\s*0?\s*\(?\s*\d{2}\s*\)?[\s.\-]?\d{3}[\s.\-]?\d{2}[\s.\-]?\d{2})|(?:\(?0\d{2}\)?[\s.\-]?\d{3}[\s.\-]?\d{2}[\s.\-]?\d{2})/g;

export type Segment = {
  text: string;
  hasPhone: boolean;
  hasCity: boolean;
  isReady: boolean;
};

export function segmentOrders(text: string): Segment[] {
  // Count phones
  const phones = Array.from(text.matchAll(PHONE_RE));
  if (phones.length === 0) {
    // No phones at all — return as single (might still parse via city+warehouse)
    return [makeSegment(text)];
  }
  if (phones.length === 1) {
    // Single order
    return [makeSegment(text)];
  }

  // Multi-phone: try paragraph split
  let chunks = text.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);

  // If paragraph split didn't separate phones into different chunks, try numbered list
  const phoneCountsPerChunk = chunks.map((c) => Array.from(c.matchAll(PHONE_RE)).length);
  if (phoneCountsPerChunk.some((n) => n >= 2)) {
    // Some chunk still has 2+ phones — try numbered split
    const numbered = text.split(/(?:^|\n)\s*\d{1,2}[.)]\s+/m).map((s) => s.trim()).filter(Boolean);
    if (numbered.length > chunks.length) {
      chunks = numbered;
    }
  }

  // Validate each chunk parses as an order
  const segments = chunks
    .map((c) => makeSegment(c))
    .filter((s) => s.hasPhone || s.hasCity);

  // If we got < 2 valid segments, fallback to single
  if (segments.length < 2) return [makeSegment(text)];

  return segments;
}

function makeSegment(text: string): Segment {
  const d = parseOrder(text);
  return {
    text,
    hasPhone: !!d.recipientPhone,
    hasCity: !!d.cityName,
    isReady: isDraftReady(d),
  };
}
