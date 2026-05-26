// lib/refusal-gate.test.ts
//
// TDD assertions for the PRE-LLM deterministic refusal gate (written first).
// This is the Loom opener: weight missing → refuse with NO model call,
// reproducible 100/100, key-free. The gate MUST be pure (synchronous,
// dependency-free) — we assert that structurally below.
//
// Three distinct deterministic paths:
//   - weight_kg == null/absent → refuse, reason "weight_missing"        (GUARD-1)
//   - no matching guideline    → abstain, reason "no_matching_guideline"
//   - wrong guideline          → abstain, reason "wrong_guideline"
// with DISTINCT copy for each — so the three failure modes never collapse.

import { describe, it, expect } from "vitest";
import {
  refusalGate,
  noGuidelineAbstention,
  wrongGuidelineAbstention,
  type RefusalDecision,
} from "./refusal-gate";

describe("refusalGate — weight missing → pre-LLM refusal (the Loom opener)", () => {
  it("weight_kg null → refuse with reason weight_missing", () => {
    const d = refusalGate({ weight_kg: null });
    expect(d.refuse).toBe(true);
    expect(d.reason).toBe("weight_missing");
    expect(d.copy.length).toBeGreaterThan(0);
  });

  it("weight_kg absent (undefined) → refuse with reason weight_missing", () => {
    const d = refusalGate({});
    expect(d.refuse).toBe(true);
    expect(d.reason).toBe("weight_missing");
  });

  it("weight_kg NaN → refuse (cannot dose on a non-number)", () => {
    const d = refusalGate({ weight_kg: NaN });
    expect(d.refuse).toBe(true);
    expect(d.reason).toBe("weight_missing");
  });

  it("a present numeric weight → does NOT refuse", () => {
    const d = refusalGate({ weight_kg: 14.2 });
    expect(d.refuse).toBe(false);
  });
});

describe("refusalGate — purity (NO model / network call)", () => {
  // The gate is the key-free guarantee. We assert purity structurally:
  // it returns synchronously (not a Promise) and does not touch fetch.
  it("returns a plain object synchronously, not a Promise", () => {
    const d = refusalGate({ weight_kg: null });
    expect(d).not.toBeInstanceOf(Promise);
    expect(typeof d.refuse).toBe("boolean");
  });

  it("does not call global fetch (no network)", () => {
    const original = globalThis.fetch;
    let called = false;
    // Replace fetch with a spy that fails loudly if the gate ever touches it.
    globalThis.fetch = (() => {
      called = true;
      return Promise.reject(new Error("network must not be touched"));
    }) as typeof globalThis.fetch;
    try {
      refusalGate({ weight_kg: null });
      refusalGate({ weight_kg: 14.2 });
    } finally {
      globalThis.fetch = original;
    }
    expect(called).toBe(false);
  });
});

describe("noGuidelineAbstention — distinct copy from the weight refusal", () => {
  it("returns an abstention with reason no_matching_guideline", () => {
    const d = noGuidelineAbstention();
    expect(d.refuse).toBe(true);
    expect(d.reason).toBe("no_matching_guideline");
    expect(d.copy.length).toBeGreaterThan(0);
  });
});

describe("wrongGuidelineAbstention — the third deterministic path", () => {
  it("returns an abstention with reason wrong_guideline", () => {
    const d = wrongGuidelineAbstention();
    expect(d.refuse).toBe(true);
    expect(d.reason).toBe("wrong_guideline");
    expect(d.copy.length).toBeGreaterThan(0);
  });
});

describe("the three refusal paths are mutually DISTINCT (no reason collapse)", () => {
  // The whole point of the wrong_guideline reason is that it is REAL and
  // SEPARATE from the other two — a guideline EXISTS, it just targets the
  // wrong condition. Prove all three copies AND all three reasons are
  // pairwise distinct, so the UI/Loom reads the failure modes apart.
  it("all three copies are pairwise distinct", () => {
    const weight: RefusalDecision = refusalGate({ weight_kg: null });
    const noGuideline: RefusalDecision = noGuidelineAbstention();
    const wrongGuideline: RefusalDecision = wrongGuidelineAbstention();
    expect(weight.copy).not.toBe(noGuideline.copy);
    expect(weight.copy).not.toBe(wrongGuideline.copy);
    expect(noGuideline.copy).not.toBe(wrongGuideline.copy);
  });

  it("all three reasons are pairwise distinct", () => {
    const weight: RefusalDecision = refusalGate({ weight_kg: null });
    const noGuideline: RefusalDecision = noGuidelineAbstention();
    const wrongGuideline: RefusalDecision = wrongGuidelineAbstention();
    expect(weight.reason).not.toBe(noGuideline.reason);
    expect(weight.reason).not.toBe(wrongGuideline.reason);
    expect(noGuideline.reason).not.toBe(wrongGuideline.reason);
  });
});
