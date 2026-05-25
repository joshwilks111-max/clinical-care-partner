// tests/evals/harness-env.ts
//
// Eval harness bootstrap: (1) load the API key from .env.local into process.env
// WITHOUT ever printing it, and (2) install a global-fetch tap that tallies the
// real Anthropic token usage + request count across ALL model calls the routes
// make (the @ai-sdk/anthropic provider resolves `globalThis.fetch` lazily, so a
// wrap installed here is picked up by every downstream provider call regardless
// of ES-module import boundaries — we never touch any production file).
//
// SECURITY: the key is read into process.env and never logged. The fetch tap
// reads ONLY the `usage` numbers from the Anthropic JSON response; it does not
// log headers, bodies, or the key.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// .env.local loader (BOM-free, names only surfaced — never the value).
// ---------------------------------------------------------------------------

let envLoaded = false;

/** Load .env.local into process.env once. Idempotent. Never prints the value. */
export function loadEnvLocal(): void {
  if (envLoaded) return;
  envLoaded = true;
  // Already present + non-empty (e.g. a real CI secret) → respect it. An empty
  // ambient value falls through so .env.local can supply the real key.
  const ambient = process.env.ANTHROPIC_API_KEY;
  if (ambient && ambient.trim().length > 0) return;
  try {
    const path = resolve(process.cwd(), ".env.local");
    const text = readFileSync(path, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.length === 0 || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      // Strip surrounding quotes if present.
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      // Set from .env.local when the var is absent OR present-but-empty (an
      // ambient empty ANTHROPIC_API_KEY must NOT shadow the real key in the file;
      // the SDK rejects an empty key with "x-api-key header is required").
      const current = process.env[key];
      if (key && (current === undefined || current.trim().length === 0)) {
        process.env[key] = value;
      }
    }
  } catch {
    // No .env.local — the run will fail later with a clear "no key" message;
    // the deterministic (no-model) cases still pass without a key.
  }
}

// ---------------------------------------------------------------------------
// Global-fetch token tap.
// ---------------------------------------------------------------------------

export type UsageTotals = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  modelCalls: number;
};

const totals: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  modelCalls: 0,
};

let tapInstalled = false;

/**
 * Wrap globalThis.fetch so every Anthropic /messages call's token usage is
 * tallied. The @ai-sdk/anthropic provider calls `globalThis.fetch` lazily, so
 * this tap is transparent to the routes. We clone the response to read `usage`
 * without consuming the body the SDK needs.
 */
export function installFetchTap(): void {
  if (tapInstalled) return;
  tapInstalled = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const res = await originalFetch(input, init);
    try {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("api.anthropic.com")) {
        // Clone so the SDK still reads the original body stream.
        const clone = res.clone();
        const json = (await clone.json()) as {
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        const u = json.usage;
        if (u) {
          totals.modelCalls += 1;
          totals.inputTokens += u.input_tokens ?? 0;
          totals.outputTokens += u.output_tokens ?? 0;
          totals.totalTokens += (u.input_tokens ?? 0) + (u.output_tokens ?? 0);
        }
      }
    } catch {
      // Streaming / non-JSON / parse error — ignore for accounting only.
    }
    return res;
  }) as typeof fetch;
}

/** A snapshot of the running usage totals (for the provider's tokenUsage). */
export function usageSnapshot(): UsageTotals {
  return { ...totals };
}
