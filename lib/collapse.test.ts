// lib/collapse.test.ts
//
// NON-VACUOUS tests for the PURE collapse decision core. Every arm
// (ask / plan / abstain) is asserted on the REAL croup/epiglottitis fixture
// shape, so a degenerate always-X implementation fails at least one case:
//   - an always-"plan" bug fails cases 3 & 4 (must-not-miss → abstain)
//   - an always-"abstain" bug fails case 2 (the plan arm)
//   - an always-"ask" bug fails cases 4 & 8 (positive must-not-miss / max rounds)
//
// The fixture is reconstructed INLINE (cleaner for a unit test; avoids coupling
// to app/console/fixtures.ts, which does not export CROUP_DIFFERENTIAL).

import { describe, it, expect } from "vitest";
import {
  decideCollapse,
  applyAnswer,
  MAX_ROUNDS,
  type ConditionGuidelineMap,
} from "./collapse";
import type { Differential } from "@/lib/schemas";

// Croup likely (+ has a guideline); Epiglottitis must-not-miss with ZERO
// positive evidence — the canonical "ask one discriminating question" setup.
const fixture: Differential = {
  conditions: [
    {
      name: "Croup",
      likelihood: "likely",
      positive_evidence: ["barky cough", "stridor at rest", "age 3"],
      negative_evidence: ["drooling", "high fever", "toxic appearance"],
    },
    {
      name: "Epiglottitis",
      likelihood: "must-not-miss",
      positive_evidence: [],
      negative_evidence: ["drooling", "tripod posture", "muffled voice"],
    },
  ],
  candidate_guidelines: [
    { guideline_id: "starship-croup-2020", label: "Starship croup (NZ)" },
  ],
};

// NORMALIZED key (lowercase) — the caller builds the map pre-normalized.
const map: ConditionGuidelineMap = { croup: "starship-croup-2020" };

describe("decideCollapse — the ask / plan / abstain decision", () => {
  it("1. ambiguous at round 0 → ask the must-not-miss discriminators", () => {
    const decision = decideCollapse(fixture, map, 0);
    expect(decision.action).toBe("ask");
    expect(decision.target).toBe("Epiglottitis");
    expect(decision.discriminators).toEqual([
      "drooling",
      "tripod posture",
      "muffled voice",
    ]);
  });

  it("2. discriminators answered ABSENT → plan the croup guideline", () => {
    const d2 = applyAnswer(
      fixture,
      "Epiglottitis",
      ["drooling", "tripod posture", "muffled voice"],
      false,
    );
    const decision = decideCollapse(d2, map, 1);
    expect(decision.action).toBe("plan");
    expect(decision.guidelineId).toBe("starship-croup-2020");
  });

  it("3. discriminators answered PRESENT → abstain (must-not-miss confirmed)", () => {
    const d3 = applyAnswer(
      fixture,
      "Epiglottitis",
      ["drooling", "tripod posture", "muffled voice"],
      true,
    );
    const decision = decideCollapse(d3, map, 1);
    expect(decision.action).toBe("abstain");
    expect(decision.guidelineId).toBeUndefined();
  });

  it("4. false-negative guard: a must-not-miss WITH positive evidence → abstain even at round 0 (never asks)", () => {
    // NON-VACUITY: this is the case an always-"plan" OR always-"ask" bug fails.
    const positiveMnm: Differential = {
      ...fixture,
      conditions: [
        fixture.conditions[0],
        {
          ...fixture.conditions[1],
          positive_evidence: ["drooling"],
          negative_evidence: ["tripod posture", "muffled voice"],
        },
      ],
    };
    const decision = decideCollapse(positiveMnm, map, 0);
    expect(decision.action).toBe("abstain");
    expect(decision.target).toBeUndefined();
  });

  it("5. > 1 unresolved must-not-miss → abstain (no arbitrary target)", () => {
    const twoMnm: Differential = {
      conditions: [
        fixture.conditions[0],
        fixture.conditions[1],
        {
          name: "Bacterial tracheitis",
          likelihood: "must-not-miss",
          positive_evidence: [],
          negative_evidence: ["high fever", "toxic appearance"],
        },
      ],
      candidate_guidelines: fixture.candidate_guidelines,
    };
    expect(decideCollapse(twoMnm, map, 0).action).toBe("abstain");
  });

  it("6. > 1 treatable top condition mapping to a guideline → abstain", () => {
    const twoTops: Differential = {
      conditions: [
        {
          name: "Croup",
          likelihood: "likely",
          positive_evidence: ["barky cough"],
          negative_evidence: [],
        },
        {
          name: "Bronchiolitis",
          likelihood: "likely",
          positive_evidence: ["wheeze"],
          negative_evidence: [],
        },
      ],
      candidate_guidelines: fixture.candidate_guidelines,
    };
    // Both names are keys in the map → can't disambiguate → abstain.
    const twoMap: ConditionGuidelineMap = {
      croup: "starship-croup-2020",
      bronchiolitis: "starship-bronchiolitis-2019",
    };
    expect(decideCollapse(twoTops, twoMap, 0).action).toBe("abstain");
  });

  it("7. empty conditions → abstain", () => {
    const empty: Differential = { conditions: [], candidate_guidelines: [] };
    expect(decideCollapse(empty, map, 0).action).toBe("abstain");
  });

  it("8. at MAX_ROUNDS with an unresolved must-not-miss → abstain (never ask again)", () => {
    expect(MAX_ROUNDS).toBe(1);
    const decision = decideCollapse(fixture, map, MAX_ROUNDS);
    expect(decision.action).toBe("abstain");
  });

  it("11. plan checks the SPECIFIC condition's mapping, not map non-emptiness", () => {
    // Only treatable top is Bronchiolitis, which is NOT in the croup-only map,
    // and there is NO must-not-miss → must abstain, not plan.
    const unmapped: Differential = {
      conditions: [
        {
          name: "Bronchiolitis",
          likelihood: "likely",
          positive_evidence: ["wheeze", "age 1"],
          negative_evidence: [],
        },
      ],
      candidate_guidelines: [],
    };
    const decision = decideCollapse(unmapped, map, 0);
    expect(decision.action).toBe("abstain");
    expect(decision.guidelineId).toBeUndefined();
  });
});

describe("applyAnswer — deterministic evidence flip (immutable, invents nothing)", () => {
  it("9. an UNKNOWN finding (in neither arm) is skipped → evidence unchanged", () => {
    const out = applyAnswer(
      fixture,
      "Epiglottitis",
      ["nonexistent-symptom"],
      true,
    );
    const epiglottitis = out.conditions[1];
    // The unknown finding is not invented into either arm.
    expect(epiglottitis.positive_evidence).toEqual([]);
    expect(epiglottitis.negative_evidence).toEqual([
      "drooling",
      "tripod posture",
      "muffled voice",
    ]);
  });

  it("10. IMMUTABILITY: the input fixture is not mutated", () => {
    const before = fixture.conditions[1].positive_evidence.length;
    applyAnswer(
      fixture,
      "Epiglottitis",
      ["drooling", "tripod posture", "muffled voice"],
      true,
    );
    const after = fixture.conditions[1].positive_evidence.length;
    expect(before).toBe(0);
    expect(after).toBe(0);
    // The original negative arm is also intact.
    expect(fixture.conditions[1].negative_evidence).toEqual([
      "drooling",
      "tripod posture",
      "muffled voice",
    ]);
  });

  it("PRESENT moves findings into positive_evidence and dedupes", () => {
    const out = applyAnswer(
      fixture,
      "Epiglottitis",
      ["drooling", "drooling"],
      true,
    );
    const epiglottitis = out.conditions[1];
    expect(epiglottitis.positive_evidence).toEqual(["drooling"]);
    expect(epiglottitis.negative_evidence).toEqual([
      "tripod posture",
      "muffled voice",
    ]);
  });

  it("ABSENT keeps findings in negative_evidence (zero positives) and removes from positive", () => {
    // Seed a positive finding, then confirm it ABSENT — it should move to negative.
    const seeded: Differential = {
      ...fixture,
      conditions: [
        fixture.conditions[0],
        {
          ...fixture.conditions[1],
          positive_evidence: ["drooling"],
          negative_evidence: ["tripod posture", "muffled voice"],
        },
      ],
    };
    const out = applyAnswer(seeded, "Epiglottitis", ["drooling"], false);
    const epiglottitis = out.conditions[1];
    expect(epiglottitis.positive_evidence).toEqual([]);
    expect(epiglottitis.negative_evidence).toEqual([
      "tripod posture",
      "muffled voice",
      "drooling",
    ]);
  });

  it("unknown condition name → returns differential unchanged in content", () => {
    const out = applyAnswer(fixture, "Not A Condition", ["drooling"], true);
    expect(out.conditions).toEqual(fixture.conditions);
    expect(out.candidate_guidelines).toEqual(fixture.candidate_guidelines);
  });

  it("all-unknown present=false answer does NOT demote the must-not-miss (stays unresolved → abstain)", () => {
    // SAFETY GUARD (pins applyAnswer's `toMove.size > 0` demote condition):
    // an ABSENT answer naming only findings in NEITHER arm flips nothing — the
    // must-not-miss is NOT ruled out, so its band must stay must-not-miss and
    // downstream must abstain. A refactor dropping the guard would demote to
    // "possible" here and (with no unresolved must-not-miss) PLAN — exactly the
    // false-negative this test forbids. Asserts .likelihood DIRECTLY (the rest of
    // the suite only verifies the band indirectly via the chosen action).
    const out = applyAnswer(
      fixture,
      "Epiglottitis",
      ["nonexistent-symptom"],
      false,
    );
    // guard: an unexamined/unknown answer must NOT rule out a must-not-miss
    expect(out.conditions[1].likelihood).toBe("must-not-miss");
    expect(out.conditions[1].positive_evidence).toEqual([]);
    expect(decideCollapse(out, map, 1).action).toBe("abstain");
  });

  it("the demote-HAPPENS path: an ABSENT answer that flips real discriminators demotes must-not-miss → possible", () => {
    // The other side of the guard, pinned directly: when the answer DOES name
    // findings present in the negative arm (toMove non-empty), the band is
    // demoted out of must-not-miss to "possible" so downstream can plan.
    const out = applyAnswer(
      fixture,
      "Epiglottitis",
      ["drooling", "tripod posture", "muffled voice"],
      false,
    );
    expect(out.conditions[1].likelihood).toBe("possible");
  });
});
