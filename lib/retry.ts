// lib/retry.ts
//
// BOUNDED, TRANSIENT-ONLY RETRY for the structured-output model calls.
//
// WHY: opus-4-7 + experimental_output intermittently throws a TRANSIENT
// SDK/model hiccup — AI_NoOutputGeneratedError ("No output generated"), an
// overloaded/429/529 backpressure signal, or a network blip (ECONNRESET /
// "fetch failed"). Today the routes catch this → a RED 502 technical-error
// state with NO retry. A single transient miss should NOT surface as a broken
// system; we re-roll it a bounded number of times before falling through to the
// SAME red response the route produces today.
//
// THE SAFETY CONTRACT (this is the load-bearing part):
//   * We retry ONLY transient errors. The match list mirrors the eval's
//     `isTransient` (tests/evals/provider.ts) so production and the eval agree
//     on what "transient" means.
//   * A Zod/validation parse failure (ZodError), a logic error, an auth error
//     (bad/missing key → 401), or ANY non-transient error is re-thrown
//     IMMEDIATELY with ZERO retries. The retry must NEVER mask a real failure —
//     that preserves the amber(deliberate)/red(broke) contract: a genuine
//     wrong-shape/parse/auth failure still goes red on the first attempt.
//   * This helper wraps ONLY the actual model calls. The PRE-LLM refusal gate
//     (weight-missing) runs BEFORE any call to this helper, so it keeps making
//     zero model calls — retry never touches the gate.

/**
 * The transient-signal match list. Identical in spirit to the eval's TRANSIENT
 * regex (tests/evals/provider.ts) — kept in sync so "transient" means the same
 * thing in production and in the eval harness.
 *
 * Matches (case-insensitive): AI_NoOutputGeneratedError / "No output
 * generated", "overloaded", "rate limit", HTTP 429 / 529, ECONNRESET, and a
 * generic "fetch failed" network blip.
 */
const TRANSIENT =
  /No output generated|NoOutputGenerated|overloaded|rate limit|429|529|ECONNRESET|fetch failed/i;

/**
 * Is this thrown error a transient model/SDK miss (safe to retry) rather than a
 * logic/validation/auth failure (must go red immediately)?
 *
 * We inspect BOTH the error `name` and `message`. The SDK sets
 * `name === "AI_NoOutputGeneratedError"` on the no-output miss, and a ZodError
 * sets `name === "ZodError"` — whose name/message never match TRANSIENT, so a
 * parse failure is correctly classified non-transient and re-thrown at once.
 */
export function isTransientError(err: unknown): boolean {
  if (err instanceof Error) {
    return TRANSIENT.test(err.name) || TRANSIENT.test(err.message);
  }
  return TRANSIENT.test(String(err));
}

/** Default backoff schedule (ms) BETWEEN attempts. Two retries after the first
 * try: ~300ms then ~800ms. Total added worst-case latency ≈ 1.1s — modest, so
 * the live demo stays snappy while surviving a single transient hiccup. */
const DEFAULT_BACKOFF_MS = [300, 800] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Run `fn`, retrying ONLY on a transient error, with short backoff between
 * attempts. After the bounded attempts are exhausted, the LAST error is
 * re-thrown so the caller's existing catch maps it to the SAME red technical
 * error as today. A non-transient error is re-thrown on the FIRST attempt with
 * zero retries.
 *
 * @param fn       the structured-output model call to run (and possibly retry).
 * @param backoff  delays (ms) between attempts; length = number of RETRIES.
 *                 Defaults to [300, 800] → 1 initial try + up to 2 retries
 *                 (3 attempts max). An empty array means no retries.
 */
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  backoff: readonly number[] = DEFAULT_BACKOFF_MS,
): Promise<T> {
  const maxAttempts = backoff.length + 1;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isLastAttempt = attempt === maxAttempts - 1;
      // Non-transient → fail closed immediately (never mask a real failure).
      // Transient but out of attempts → re-throw so the route goes red.
      if (!isTransientError(err) || isLastAttempt) throw err;
      await sleep(backoff[attempt]);
    }
  }
  // Unreachable (the loop either returns or throws), but satisfies the type.
  throw lastErr;
}
