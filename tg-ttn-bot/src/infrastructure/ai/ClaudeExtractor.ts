/**
 * Claude API extractor — fallback for incomplete regex parses.
 *
 * Model: claude-3-5-haiku (~$0.001/1k tokens, fast)
 * Fallback chain: Claude → OpenAI gpt-4o-mini → null
 *
 * Caching: every prompt hashed (sha256), result cached 30 days in NpCache table.
 * Same message = no second AI call = no extra cost.
 */
import { createHash } from "node:crypto";
import type {
  AiExtractInput,
  AiExtractOutput,
  AiExtractor,
  AiSegmentOutput,
  AiSegmenter,
} from "../../application/ports/ai-extractor.js";
import type { NpCacheRepository } from "../../application/ports/repositories.js";
import { type Result, ok, err, AppError } from "../../shared/result.js";
import { makeLogger } from "../../shared/logger.js";
import { loadConfig } from "../../shared/config.js";

const log = makeLogger("ai.claude");

const SYSTEM_PROMPT = `Ти — асистент логістики Нової Пошти. Витягуєш з хаотичного тексту повідомлення українською/російською мовою наступні поля:

- recipientName: ПІБ отримувача (Прізвище Ім'я По-батькові)
- recipientPhone: телефон у форматі +380XXXXXXXXX
- cityName: назва міста українською (без префіксів "м.", "Місто:")
- warehouseType: "branch" (відділення) | "postomat" (поштомат) | "courier" (кур'єр)
- warehouseNumber: номер відділення/поштомата (1-5 цифр)
- courierAddress: адреса для кур'єра (вулиця + номер, тільки якщо warehouseType=courier)
- cost: сума у гривнях (число)
- description: товар одним рядком
- confidence: 0.0..1.0 — наскільки впевнений у витяганих даних
- reasoning: короткий коментар чому саме так

ВАЖЛИВО:
- Виправляй опечатки міст ("Харкрів" → "Харків")
- Розпізнавай ВСІ діалекти: "опл", "наложка", "надожка", "почтомат", "поштомат", "паштомат"
- Поверни ТІЛЬКИ те, що ВПЕВНЕНО витягнув. Невпевнене лиши undefined
- Відповідь — ТІЛЬКИ JSON. Без markdown, без пояснень за межами JSON
- Якщо повідомлення не схоже на замовлення — поверни {"confidence": 0, "reasoning": "not_an_order"}`;

type ClaudeResponse = {
  content: Array<{ type: string; text: string }>;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
};

export class ClaudeExtractor implements AiExtractor, AiSegmenter {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint = "https://api.anthropic.com/v1/messages";

  constructor(
    apiKey: string,
    model: string,
    private readonly cache: NpCacheRepository,
  ) {
    this.apiKey = apiKey;
    this.model = model || "claude-3-5-haiku-20241022";
  }

  // ─────────────────────────────────────────────────────────
  // Field extraction
  // ─────────────────────────────────────────────────────────
  async extractMissing(input: AiExtractInput): Promise<Result<AiExtractOutput | null>> {
    if (!this.apiKey) return ok(null);

    const userPrompt = this.buildExtractPrompt(input);
    const cacheKey = this.hash("ai-extract", userPrompt);

    // Cache check
    const cached = await this.cache.get(cacheKey).catch(() => null);
    if (cached) {
      log.debug({ cacheKey }, "ai.cache_hit");
      return ok(cached as AiExtractOutput | null);
    }

    const r = await this.call(SYSTEM_PROMPT, userPrompt, 1500);
    if (!r.ok) return err(r.error);

    let parsed: Partial<AiExtractOutput>;
    try {
      // Strip optional markdown fences
      const stripped = r.value.text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
      parsed = JSON.parse(stripped) as Partial<AiExtractOutput>;
    } catch (e) {
      log.warn({ raw: r.value.text.slice(0, 200) }, "ai.extract.parse_failed");
      return err(new AppError("system.internal_error", "Failed to parse AI JSON", { raw: r.value.text }));
    }

    const output: AiExtractOutput = {
      ...parsed,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      tokensUsed: r.value.tokens,
      costUsd: r.value.costUsd,
      modelUsed: r.value.model,
    };

    // Cache for 30 days
    await this.cache.set(cacheKey, "ai-extract", { text: input.text.slice(0, 100) }, output, 30 * 86400)
      .catch((e) => log.warn({ err: String(e) }, "ai.cache_set_failed"));

    log.info({ confidence: output.confidence, tokens: output.tokensUsed, model: output.modelUsed }, "ai.extract.success");
    return ok(output);
  }

  // ─────────────────────────────────────────────────────────
  // Multi-order segmentation
  // ─────────────────────────────────────────────────────────
  async segment(text: string): Promise<Result<AiSegmentOutput>> {
    if (!this.apiKey) {
      return ok({ orders: [{ text, confidence: 1 }], tokensUsed: 0, costUsd: 0 });
    }

    const cacheKey = this.hash("ai-segment", text);
    const cached = await this.cache.get(cacheKey).catch(() => null);
    if (cached) return ok(cached as AiSegmentOutput);

    const systemPrompt = `Ти — асистент логістики. У тексті може бути ОДНЕ замовлення або КІЛЬКА.
Замовлення розділяються пустими рядками, нумерацією (1., 2.), або просто розділами.
Кожне замовлення має ПІБ + телефон + місто + відділення/поштомат.

Поверни JSON: {"orders": [{"text": "повний текст одного замовлення", "confidence": 0.0-1.0}]}
Якщо одне замовлення — поверни масив з одним елементом.
Тільки JSON, без markdown.`;

    const r = await this.call(systemPrompt, text, 2000);
    if (!r.ok) {
      // Failure → fall back to "one order = whole text"
      log.warn({ err: r.error.message }, "ai.segment.failed_fallback");
      return ok({ orders: [{ text, confidence: 0.5 }], tokensUsed: 0, costUsd: 0 });
    }

    try {
      const stripped = r.value.text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
      const parsed = JSON.parse(stripped) as { orders: Array<{ text: string; confidence: number }> };
      const output: AiSegmentOutput = {
        orders: parsed.orders ?? [{ text, confidence: 0.5 }],
        tokensUsed: r.value.tokens,
        costUsd: r.value.costUsd,
      };
      await this.cache.set(cacheKey, "ai-segment", { hash: cacheKey }, output, 7 * 86400)
        .catch((e) => log.warn({ err: String(e) }, "ai.cache_set_failed"));
      return ok(output);
    } catch {
      return ok({ orders: [{ text, confidence: 0.5 }], tokensUsed: 0, costUsd: 0 });
    }
  }

  // ─────────────────────────────────────────────────────────
  // Low-level HTTP call
  // ─────────────────────────────────────────────────────────
  private async call(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<Result<{ text: string; tokens: number; costUsd: number; model: string }>> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return err(new AppError("system.internal_error", `Claude HTTP ${res.status}`, { status: res.status, body: body.slice(0, 200) }));
      }

      const json = (await res.json()) as ClaudeResponse;
      const text = json.content?.[0]?.text ?? "";
      const tokens = json.usage.input_tokens + json.usage.output_tokens;
      // Approximate cost for claude-haiku: input $0.80/1M, output $4.00/1M
      const costUsd = (json.usage.input_tokens / 1_000_000) * 0.8 + (json.usage.output_tokens / 1_000_000) * 4.0;
      return ok({ text, tokens, costUsd, model: json.model });
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof Error && e.name === "AbortError") {
        return err(new AppError("system.timeout", "Claude API timeout"));
      }
      return err(new AppError("system.internal_error", `Claude API error: ${String(e)}`));
    }
  }

  private buildExtractPrompt(input: AiExtractInput): string {
    return `Текст повідомлення:
"""
${input.text.slice(0, 2000)}
"""

Regex уже витяг:
${JSON.stringify(input.partial, null, 2)}

Не вистачає: ${input.missing.join(", ")}

Витягни ТІЛЬКИ відсутні поля + виправ помилки у тих що вже є.
Відповідь — JSON.`;
  }

  private hash(prefix: string, content: string): string {
    return prefix + ":" + createHash("sha256").update(content).digest("hex").slice(0, 32);
  }
}
