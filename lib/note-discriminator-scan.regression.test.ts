// lib/note-discriminator-scan.regression.test.ts
//
// IRON-RULE REGRESSION TEST (mandated by /plan-eng-review test review).
//
// The load-bearing safety case for the entire grounded-discriminator feature:
// when a clinician documents the epiglottitis discriminators as PRESENT
// (not absent), the system MUST still abstain. This pins the post-fix
// behaviour against the failure mode that would be catastrophic — dosing
// croup-protocol drugs when the clinician actually flagged epiglottitis
// findings as positive.
//
// The chain we assert:
//   1. The note-discriminator scanner reads "drooling, tripod posture,
//      muffled voice present" and classifies all three as `present`.
//   2. groundedAbsentFor() returns an EMPTY list for epiglottitis (none are
//      absent). The Turn 1 canonicalisation pass therefore does NOT replace
//      anything in negative_evidence with canonical registry strings.
//   3. The Turn 1.5 override (shouldOverrideToNoQuestion) does NOT fire,
//      because the registry strings are not all in negative_evidence.
//   4. The Turn 2 collapse gate (decideCollapse) — when given a differential
//      where epiglottitis has positive_evidence — fires Rule 2
//      (`unresolved_dangers`) and returns `action: "abstain"`. NO dose.
//
// This test exercises the seam at the Turn 1.5 override + decideCollapse
// layers directly (the LLM is the only thing in the chain that decides to
// put findings in positive_evidence — that's its job; the deterministic
// spine downstream of it must refuse to dose past those positives).

import { describe, it, expect } from "vitest";

import {
  scanNote,
  groundedAbsentFor,
  type Grounding,
} from "@/lib/note-discriminator-scan";
import { decideCollapse, type ConditionGuidelineMap } from "@/lib/collapse";
import {
  shouldOverrideToNoQuestion,
  type Turn15ModelOutput,
} from "@/prompts/turn1.5";
import {
  buildDiscriminatorSurfaceFormMap,
  buildConditionGuidelineMap,
  buildAskableConditionSet,
} from "@/registry/guidelines";
import type { Differential } from "@/lib/schemas";

const POSITIVE_NOTE =
  "3yo, 14.2 kg, drooling, tripod posture, muffled voice all present. Stridor at rest.";

describe("REGRESSION — discriminators PRESENT must still abstain", () => {
  it("scanner: positive findings classify as `present`, none `absent`", () => {
    const surfaceFormMap = buildDiscriminatorSurfaceFormMap();
    const groundings = scanNote(POSITIVE_NOTE, surfaceFormMap);

    // All three discriminators must be `present`, NOT absent.
    const drooling = groundings.find((g) => g.discriminator === "drooling");
    const tripod = groundings.find((g) => g.discriminator === "tripod posture");
    const muffled = groundings.find((g) => g.discriminator === "muffled voice");

    expect(drooling?.state).toBe("present");
    expect(tripod?.state).toBe("present");
    expect(muffled?.state).toBe("present");

    // The Turn 1 canonicalisation pass only rewrites for `absent` findings.
    expect(groundedAbsentFor(groundings, "epiglottitis")).toEqual([]);
  });

  it("turn 1.5 override: does NOT fire when discriminators are positive (no false ok)", () => {
    // Simulate the post-Turn-1 differential: epiglottitis has the
    // discriminators in POSITIVE_evidence (the LLM correctly extracted
    // them). negative_evidence is empty for this condition.
    const positiveDiff: Differential = {
      conditions: [
        {
          name: "Croup",
          likelihood: "likely",
          positive_evidence: ["barky cough", "stridor at rest"],
          negative_evidence: [],
        },
        {
          name: "Epiglottitis",
          likelihood: "must-not-miss",
          positive_evidence: ["drooling", "tripod posture", "muffled voice"],
          negative_evidence: [],
        },
      ],
      candidate_guidelines: [
        { guideline_id: "starship-croup-2020", label: "Starship croup (NZ)" },
      ],
    };

    const llmAsk: Turn15ModelOutput = {
      needs_question: true,
      target_condition: "Epiglottitis",
      question: "Are drooling, tripod posture, or muffled voice present?",
      recommended_condition: "Croup",
      recommended_guideline: "starship-croup-2020",
      rationale_summary: "Croup leads; epiglottitis must be ruled out.",
    };

    const override = shouldOverrideToNoQuestion(llmAsk, positiveDiff);
    // Override does NOT fire — the registry discriminators are in POSITIVE,
    // not negative. The question still gets asked (and Rule 2 in
    // decideCollapse will then abstain regardless).
    expect(override.kind).toBe("none");
  });

  it("turn 2 collapse gate: Rule 2 fires when epiglottitis has positive evidence", () => {
    // Even if a malicious or buggy client somehow got past Turn 1.5, the
    // Turn 2 collapse gate runs decideCollapse again as defence-in-depth.
    // Rule 2 (any positive must-not-miss → abstain) is the load-bearing
    // safety check. This test pins that it fires.
    const positiveDiff: Differential = {
      conditions: [
        {
          name: "Croup",
          likelihood: "likely",
          positive_evidence: ["barky cough", "stridor at rest"],
          negative_evidence: [],
        },
        {
          name: "Epiglottitis",
          likelihood: "must-not-miss",
          positive_evidence: ["drooling", "tripod posture", "muffled voice"],
          negative_evidence: [],
        },
      ],
      candidate_guidelines: [
        { guideline_id: "starship-croup-2020", label: "Starship croup (NZ)" },
      ],
    };

    const map: ConditionGuidelineMap = buildConditionGuidelineMap();
    const askable = buildAskableConditionSet();

    const decision = decideCollapse(positiveDiff, map, 0, askable);

    // The load-bearing assertion: action MUST be abstain, with the
    // unresolved_dangers reason (Rule 2 — positive must-not-miss).
    expect(decision.action).toBe("abstain");
    expect(decision.reason).toBe("unresolved_dangers");
  });
});
