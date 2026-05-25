// lib/retry.test.ts
//
// Unit tests for the bounded, transient-only retry helper. These prove the
// SAFETY CONTRACT at the helper level (no SDK, no network, no fake timers
// needed — backoff is short and real):
//   * a transient error followed by success → resolves (retry recovered),
//   * a persistent transient error → throws after EXACTLY the bounded number of
//     attempts (does NOT loop forever; attempt count is asserted),
//   * a non-transient error (e.g. ZodError) → throws on the FIRST attempt with
//     ZERO retries (the fn is invoked exactly once — retry never masks it),
//   * isTransientError classifies each signal in the match list correctly and
//     classifies validation/auth/logic errors as NON-transient.

import { describe, it, expect } from "vitest";
import { withTransientRetry, isTransientError } from "./retry";

// A small fake of the SDK's no-output miss (name + message both transient).
function noOutputError(): Error {
  const e = new Error("No output generated.");
  e.name = "AI_NoOutputGeneratedError";
  return e;
}

// A ZodError-shaped non-transient failure (only the name matters for the match).
function zodLikeError(): Error {
  const e = new Error("Invalid input: expected string, received undefined");
  e.name = "ZodError";
  return e;
}

describe("isTransientError — the match list (mirrors the eval's isTransient)", () => {
  it("classifies the SDK no-output miss as transient (by name AND message)", () => {
    expect(isTransientError(noOutputError())).toBe(true);
    expect(isTransientError(new Error("No output generated."))).toBe(true);
    expect(
      isTransientError(new Error("AI_NoOutputGeneratedError thrown")),
    ).toBe(true);
  });

  it("classifies overload / rate-limit / 429 / 529 / network as transient", () => {
    for (const msg of [
      "Anthropic API is overloaded",
      "rate limit exceeded",
      "Request failed with status 429",
      "Request failed with status 529",
      "read ECONNRESET",
      "fetch failed",
    ]) {
      expect(isTransientError(new Error(msg))).toBe(true);
    }
  });

  it("classifies a Zod/validation error as NON-transient (never retried)", () => {
    expect(isTransientError(zodLikeError())).toBe(false);
  });

  it("classifies an auth / logic / generic error as NON-transient", () => {
    expect(
      isTransientError(new Error("401 Unauthorized: invalid x-api-key")),
    ).toBe(false);
    expect(isTransientError(new Error("Cannot read properties of null"))).toBe(
      false,
    );
    expect(isTransientError("just a string")).toBe(false);
    expect(isTransientError(null)).toBe(false);
  });
});

describe("withTransientRetry — bounded transient-only retry", () => {
  it("(a) transient once, then success → resolves with the value", async () => {
    let calls = 0;
    const result = await withTransientRetry(
      async () => {
        calls++;
        if (calls === 1) throw noOutputError();
        return "ok";
      },
      [1, 1], // tiny backoff so the test is fast
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2); // first miss + one successful retry
  });

  it("(b) persistent transient → throws after EXACTLY bounded attempts (no infinite loop)", async () => {
    let calls = 0;
    await expect(
      withTransientRetry(
        async () => {
          calls++;
          throw noOutputError();
        },
        [1, 1], // 2 retries → 3 attempts max
      ),
    ).rejects.toThrow(/No output generated/);
    // EXACTLY 1 initial try + 2 retries = 3 — bounded, never infinite.
    expect(calls).toBe(3);
  });

  it("(c) non-transient (Zod) → throws IMMEDIATELY with ZERO retries (called once)", async () => {
    let calls = 0;
    await expect(
      withTransientRetry(async () => {
        calls++;
        throw zodLikeError();
      }, [1, 1]),
    ).rejects.toThrow(/Invalid input/);
    // The non-transient error must NOT be retried — exactly one invocation.
    expect(calls).toBe(1);
  });

  it("respects a custom backoff length (attempt count = backoff.length + 1)", async () => {
    let calls = 0;
    await expect(
      withTransientRetry(
        async () => {
          calls++;
          throw noOutputError();
        },
        [1], // 1 retry → 2 attempts max
      ),
    ).rejects.toThrow();
    expect(calls).toBe(2);
  });

  it("an empty backoff means zero retries (single attempt, transient or not)", async () => {
    let calls = 0;
    await expect(
      withTransientRetry(async () => {
        calls++;
        throw noOutputError();
      }, []),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("succeeds on the first try without sleeping when fn resolves", async () => {
    let calls = 0;
    const result = await withTransientRetry(async () => {
      calls++;
      return 42;
    });
    expect(result).toBe(42);
    expect(calls).toBe(1);
  });
});
