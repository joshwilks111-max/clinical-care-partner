// lib/tool-call-id.test.ts
//
// Generator-contract tests. The single load-bearing invariant is the regex
// conformance — every other test (uniqueness, length) is a downstream sanity
// check that catches accidental refactors.

import { describe, expect, it } from "vitest";

import { TOOL_CALL_ID_REGEX, newToolCallId } from "./tool-call-id";

describe("newToolCallId", () => {
  // The contract test. If this ever fails, the harness's calculate_dose tool
  // would issue ids the skill's Zod schema rejects, every dose-card would
  // surface a `tool_call_id_regex_violation` validator-blocked state, and
  // production goes red. We sample 1k ids to make sure no edge case (early
  // nanoid output containing only digits, only letters, etc.) sneaks past.
  it("every id matches ^[a-zA-Z0-9_-]{8,32}$", () => {
    for (let i = 0; i < 1000; i++) {
      const id = newToolCallId();
      expect(id, `id at iter ${i}`).toMatch(TOOL_CALL_ID_REGEX);
    }
  });

  // Uniqueness check at scale. nanoid's default 21-char alphabet gives ~71
  // bits of entropy at len=12; the birthday-collision expectation across 10k
  // draws is effectively zero. If a refactor ever switches to a seeded /
  // counter-based generator, this test goes red — that's the alarm we want.
  it("10000 ids are all unique", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) seen.add(newToolCallId());
    expect(seen.size).toBe(10_000);
  });

  // Length is part of the wire format, not just the regex. A sudden jump
  // to length 21 (nanoid's default) would still pass the regex but blow
  // up block size in every emitted dose-card. Lock it.
  it("length is stable at 12 characters", () => {
    for (let i = 0; i < 100; i++) {
      expect(newToolCallId()).toHaveLength(12);
    }
  });
});
