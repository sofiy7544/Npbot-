/**
 * Raw NP HTTP fetcher for warehouse sync — bypasses the cached path used by user-facing
 * code. Reasons:
 *   - Sync needs FRESH data, not 7d-old cache
 *   - Sync fetches by page, not by query string — different cache shape anyway
 *   - We still go through the token-bucket rate limiter (same NP budget)
 *
 * Retry policy: 3 attempts with exponential backoff. After 3 fails, propagate error
 * so the sync engine can either skip that city or fail the run.
 */
import { type Result, ok, err, AppError } from "../../shared/result.js";
import { makeLogger } from "../../shared/logger.js";
import { loadConfig, type AppConfig } from "../../shared/config.js";
import type { NpRawFetcher } from "../../application/use-cases/SyncNpWarehousesUseCase.js";

const log = makeLogger("np.raw_fetcher");

// In-process token bucket — independent of user-facing limiter to keep accounting clean
class RateLimiter {
  private tokens: number;
  private lastRefill = Date.now();
  constructor(private readonly capacity: number, private readonly refillPerSec: number) {
    this.tokens = capacity;
  }
  async acquire(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) { this.tokens -= 1; return; }
      const waitMs = Math.ceil((1 - this.tokens) / this.refillPerSec * 1000);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  private refill() {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.lastRefill) / 1000 * this.refillPerSec);
    this.lastRefill = now;
  }
}

type NpEnvelope<T> = { success: boolean; data: T[]; errors: string[]; warnings: string[] };

export class NpRawFetcherHttp implements NpRawFetcher {
  private readonly cfg: AppConfig;
  private readonly limiter: RateLimiter;

  constructor(cfg: AppConfig) {
    this.cfg = cfg;
    // Use HALF the user-facing budget — sync runs in background, don't want to starve UX
    const rate = Math.max(2, Math.floor(cfg.NP_API_RATE_LIMIT_PER_SEC / 2));
    this.limiter = new RateLimiter(rate * 2, rate);
  }

  async fetchCities(page: number, limit: number): Promise<Result<NpRawCity[]>> {
    return this.call<NpRawCity>("Address", "getCities", { Page: String(page), Limit: String(limit) });
  }

  async fetchWarehousesByCity(cityRef: string): Promise<Result<NpRawWarehouse[]>> {
    // NP `getWarehouses` returns up to 500 — for our case (city-scoped) plenty
    return this.call<NpRawWarehouse>("AddressGeneral", "getWarehouses", {
      CityRef: cityRef,
      Limit: "500",
      Page: "1",
    });
  }

  private async call<T>(modelName: string, calledMethod: string, methodProperties: Record<string, string>): Promise<Result<T[]>> {
    const body = {
      apiKey: this.cfg.NP_API_KEY,
      modelName,
      calledMethod,
      methodProperties,
    };

    const maxAttempts = this.cfg.NP_API_MAX_RETRIES + 1;
    let lastError: AppError | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.limiter.acquire();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.cfg.NP_API_TIMEOUT_MS);
      try {
        const res = await fetch(this.cfg.NP_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
          lastError = new AppError("np.api_error", `HTTP ${res.status}`, { modelName, calledMethod, attempt });
          if (res.status < 500) break;
          continue;
        }
        const json = (await res.json()) as NpEnvelope<T>;
        if (!json.success) {
          lastError = new AppError("np.api_error", json.errors.join("; "), { modelName, calledMethod });
          break;
        }
        return ok(json.data);
      } catch (e) {
        clearTimeout(timer);
        if (e instanceof Error && e.name === "AbortError") {
          lastError = new AppError("np.timeout", `timeout ${this.cfg.NP_API_TIMEOUT_MS}ms`, { modelName, attempt });
        } else {
          lastError = new AppError("np.network_error", String(e), { modelName, attempt });
        }
        if (attempt === maxAttempts) break;
        const delay = Math.min(2000 * Math.pow(2, attempt - 1), 10000) + Math.random() * 500;
        log.warn({ attempt, delay, modelName, calledMethod, error: lastError.message }, "np.retry");
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    return err(lastError ?? new AppError("np.api_error", "Unknown"));
  }
}

// Local types — match NP response schema
type NpRawCity = {
  Ref: string;
  Description: string;
  DescriptionRu: string;
  Area: string;
  AreaDescription: string;
  Region: string | null;
  SettlementTypeDescription: string;
};

type NpRawWarehouse = {
  Ref: string;
  Number: string;
  CityRef: string;
  CityDescription: string;
  CityDescriptionRu: string;
  Description: string;
  DescriptionRu: string;
  ShortAddress: string;
  ShortAddressRu: string;
  Longitude: string;
  Latitude: string;
  TypeOfWarehouse: string;
  TotalMaxWeightAllowed: string;
  Schedule: Record<string, string>;
};
