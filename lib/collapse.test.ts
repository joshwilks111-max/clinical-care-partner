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
  demoteSharedFindings,
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

// ---------------------------------------------------------------------------
// demoteSharedFindings — the Rule-2 over-abstain fix.
//
// The live model correctly lists shared physical findings (e.g. "stridor at
// rest") under EVERY must-not-miss condition the finding is consistent with.
// Rule 2 would then over-abstain on a clinically routine fact pattern.
// demoteSharedFindings strips those shared findings from must-not-miss
// positives IFF the same finding anchors a treatable-and-routed condition.
// ---------------------------------------------------------------------------

describe("demoteSharedFindings", () => {
  const map: ConditionGuidelineMap = { croup: "starship-croup-2020" };

  it("demotes a finding shared between a must-not-miss and the treatable", () => {
    // "stridor at rest" appears as positive on Epiglottitis (must-not-miss) AND
    // Croup (likely, routed). The Epiglottitis copy should be demoted to its
    // negative arm with the shared/non-discriminating audit prefix; Croup's
    // positive stays intact.
    const d: Differential = {
      conditions: [
        {
          name: "Epiglottitis",
          likelihood: "must-not-miss",
          positive_evidence: ["stridor at rest"],
          negative_evidence: ["no drooling"],
        },
        {
          name: "Croup",
          likelihood: "likely",
          positive_evidence: ["barky cough", "stridor at rest"],
          negative_evidence: [],
        },
      ],
      candidate_guidelines: [],
    };

    const out = demoteSharedFindings(d, map);
    expect(out.conditions[0].positive_evidence).toEqual([]);
    expect(out.conditions[0].negative_evidence).toContain(
      "[shared / non-discriminating]: stridor at rest",
    );
    // Croup keeps its positive list intact (the treatable's case is preserved).
    expect(out.conditions[1].positive_evidence).toEqual([
      "barky cough",
      "stridor at rest",
    ]);
  });

  it("preserves a must-not-miss positive that the treatable does NOT share (discriminating evidence stays)", () => {
    // "drooling" is on Epiglottitis only — that's discriminating, Rule 2 SHOULD
    // still trigger on it later. demoteSharedFindings must leave it alone.
    const d: Differential = {
      conditions: [
        {
          name: "Epiglottitis",
          likelihood: "must-not-miss",
          positive_evidence: ["drooling"],
          negative_evidence: [],
        },
        {
          name: "Croup",
          likelihood: "likely",
          positive_evidence: ["barky cough"],
          negative_evidence: [],
        },
      ],
      candidate_guidelines: [],
    };

    const out = demoteSharedFindings(d, map);
    expect(out.conditions[0].positive_evidence).toEqual(["drooling"]);
    expect(decideCollapse(out, map, 0).action).toBe("abstain"); // Rule 2 still fires
  });

  it("no-op when there is no treatable-and-routed condition (no benign anchor)", () => {
    // Without a treatable in the map, there's no benign explanation — leave
    // the must-not-miss positives alone. Rule 2 will handle it.
    const d: Differential = {
      conditions: [
        {
          name: "Epiglottitis",
          likelihood: "must-not-miss",
          positive_evidence: ["stridor at rest"],
          negative_evidence: [],
        },
        {
          name: "Tracheomalacia",
          likelihood: "possible",
          positive_evidence: ["stridor at rest"],
          negative_evidence: [],
        },
      ],
      candidate_guidelines: [],
    };

    const out = demoteSharedFindings(d, map);
    expect(out.conditions[0].positive_evidence).toEqual(["stridor at rest"]);
  });

  it("does NOT mutate the input differential (immutability)", () => {
    const d: Differential = {
      conditions: [
        {
          name: "Epiglottitis",
          likelihood: "must-not-miss",
          positive_evidence: ["stridor at rest"],
          negative_evidence: [],
        },
        {
          name: "Croup",
          likelihood: "likely",
          positive_evidence: ["stridor at rest"],
          negative_evidence: [],
        },
      ],
      candidate_guidelines: [],
    };
    const snapshot = JSON.stringify(d);
    demoteSharedFindings(d, map);
    expect(JSON.stringify(d)).toBe(snapshot);
  });

  it("end-to-end on the LIVE croup fact pattern: demote → decideCollapse no longer fires Rule 2", () => {
    // Reconstructs the exact fact pattern from the user's screenshot (May 26):
    // four must-not-miss conditions all citing 'stridor at rest' as positive,
    // Croup (typed with parenthetical) as the only treatable. Before the fix,
    // Rule 2 fires (three confirmed dangers). After demote, Rule 3 fires
    // instead (three unresolved must-not-miss) — also abstain, but for the
    // RIGHT semantic reason (multiple dangers we cannot rule out, not "we
    // confirmed all three"). The honest escalation.
    const live: Differential = {
      conditions: [
        {
          name: "Foreign body aspiration",
          likelihood: "must-not-miss",
          positive_evidence: ["stridor at rest"],
          negative_evidence: ["no choking documented"],
        },
        {
          name: "Epiglottitis",
          likelihood: "must-not-miss",
          positive_evidence: ["stridor at rest"],
          negative_evidence: ["no drooling documented"],
        },
        {
          name: "Bacterial tracheitis",
          likelihood: "must-not-miss",
          positive_evidence: ["stridor at rest", "barky cough"],
          negative_evidence: ["no high fever documented"],
        },
        {
          name: "Croup (viral laryngotracheobronchitis)",
          likelihood: "likely",
          positive_evidence: ["barky cough", "stridor at rest"],
          negative_evidence: [],
        },
      ],
      candidate_guidelines: [],
    };

    // The parenthetical-stripping norm() is what makes "Croup (...)" match the
    // registry's "croup" key — without it, Croup wouldn't even be a treatable
    // top and the demote step would no-op.
    const demoted = demoteSharedFindings(live, map);
    // After demote: every must-not-miss has been stripped of "stridor at rest"
    // (the shared finding); bacterial tracheitis also loses "barky cough".
    expect(demoted.conditions[0].positive_evidence).toEqual([]);
    expect(demoted.conditions[1].positive_evidence).toEqual([]);
    expect(demoted.conditions[2].positive_evidence).toEqual([]);
    // Croup keeps its full positive list.
    expect(demoted.conditions[3].positive_evidence).toEqual([
      "barky cough",
      "stridor at rest",
    ]);
    // Rule 2 no longer fires (the dangerous conditions are no longer
    // "confirmed" by a shared finding). Rule 3 fires instead (3 unresolved).
    // Both are abstain, but for semantically different reasons.
    const d = decideCollapse(demoted, map, 0);
    expect(d.action).toBe("abstain"); // honest escalation, not over-abstain
  });

  it("end-to-end on a SINGLE-must-not-miss live shape: demote unlocks the ask path", () => {
    // The clean win case: only one unresolved must-not-miss remains after the
    // shared finding is demoted, so Rule 4 (ask) can fire. This is what the
    // demote fix actually enables for cases with one dangerous condition
    // sharing one finding with the treatable.
    const live: Differential = {
      conditions: [
        {
          name: "Epiglottitis",
          likelihood: "must-not-miss",
          positive_evidence: ["stridor at rest"],
          negative_evidence: ["no drooling documented"],
        },
        {
          name: "Croup (viral laryngotracheobronchitis)",
          likelihood: "likely",
          positive_evidence: ["barky cough", "stridor at rest"],
          negative_evidence: [],
        },
      ],
      candidate_guidelines: [],
    };
    const demoted = demoteSharedFindings(live, map);
    const d = decideCollapse(demoted, map, 0);
    expect(d.action).toBe("ask");
    expect(d.target).toBe("Epiglottitis");
  });
});

// ---------------------------------------------------------------------------
// norm() parenthetical strip (via decideCollapse public API).
// ---------------------------------------------------------------------------

describe("norm parenthetical strip — registry routing works on long names", () => {
  const map: ConditionGuidelineMap = { croup: "starship-croup-2020" };

  it('matches "Croup (viral laryngotracheobronchitis)" to registry key "croup"', () => {
    const d: Differential = {
      conditions: [
        {
          name: "Croup (viral laryngotracheobronchitis)",
          likelihood: "likely",
          positive_evidence: ["barky cough"],
          negative_evidence: [],
        },
      ],
      candidate_guidelines: [],
    };
    const decision = decideCollapse(d, map, 0);
    expect(decision.action).toBe("plan");
    expect(decision.guidelineId).toBe("starship-croup-2020");
  });

  it("leaves bare short names alone (back-compat with fixture-style names)", () => {
    const d: Differential = {
      conditions: [
        {
          name: "Croup",
          likelihood: "likely",
          positive_evidence: ["barky cough"],
          negative_evidence: [],
        },
      ],
      candidate_guidelines: [],
    };
    const decision = decideCollapse(d, map, 0);
    expect(decision.action).toBe("plan");
    expect(decision.guidelineId).toBe("starship-croup-2020");
  });
});
