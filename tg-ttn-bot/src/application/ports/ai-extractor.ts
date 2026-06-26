/**
 * AI extraction port — invoked as FALLBACK when regex parser leaves a draft incomplete.
 *
 * Cost control:
 *   - Only called when isDraftReady() === false
 *   - Result cached by sha256(message_text) for 30 days (NpCache table reused)
 *   - 1500 token budget per call (~$0.002 with claude-haiku, ~$0.01 with sonnet)
 *
 * Privacy: phone number and full name ARE sent to AI provider.
 * Anthropic Claude API: zero-retention policy on org plan.
 * If using OpenAI fallback, ensure ZDR is configured.
 */
import type { Result } from "../../shared/result.js";

export type AiExtractInput = {
  text: string;
  partial: {
    recipientName?: string;
    recipientPhone?: string;
    cityName?: string;
    warehouseType?: "branch" | "postomat" | "courier";
    warehouseNumber?: string;
    cost?: number;
    description?: string;
  };
  missing: Array<"name" | "phone" | "city" | "warehouse" | "cost">;
};

export type AiExtractOutput = {
  recipientName?: string;
  recipientPhone?: string;
  cityName?: string;
  warehouseType?: "branch" | "postomat" | "courier";
  warehouseNumber?: string;
  courierAddress?: string;
  cost?: number;
  description?: string;
  confidence: number;          // 0..1
  reasoning?: string;          // explainable AI — kept for audit
  tokensUsed: number;
  costUsd: number;
  modelUsed: string;
};

export interface AiExtractor {
  /** Extract missing fields. Returns null if AI is disabled or call failed. */
  extractMissing(input: AiExtractInput): Promise<Result<AiExtractOutput | null>>;
}

/** Segment a multi-order message into separate orders. */
export type AiSegmentOutput = {
  orders: Array<{ text: string; confidence: number }>;
  tokensUsed: number;
  costUsd: number;
};

export interface AiSegmenter {
  segment(text: string): Promise<Result<AiSegmentOutput>>;
}
