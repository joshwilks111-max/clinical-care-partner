// Regression tests for F-016 (Croup happy path abstained) and F-018
// (cross-condition finding-string drift defeats demote).
//
// Found by /qa on 2026-05-27.
// Report: .gstack/qa-reports/qa-report-localhost-2026-05-27.md
//
// What broke:
//   - Live Croup demo button advertised "→ 2.13 mg dexamethasone" but
//     produced an abstention with copy "No local guideline matches this
//     condition". The eval fixture was a hand-crafted 2-condition
//     differential; the real Turn 1 model returned 3+ must-not-miss
//     conditions for the same note, and the gate's Rule 3a abstained
//     once Turn 1.5 could only ask about one of them.
//   - The abstain copy lied (a guideline DID match the treatable; the
//     blocker was undischarged danger, not the registry).
//
// What fixed:
//   D — decideCollapse returns a reason on every abstain. Turn 2 picks
//       unresolvedDangersAbstention() when reason="unresolved_dangers"
//       and noGuidelineAbstention() when reason="no_treatable".
//   A — Turn 1 prompt discipline (out of scope for these tests; covered
//       by live QA in qa-report-localhost-2026-05-27.md).
//   F-018a — decideCollapse accepts an optional askable set; unresolved
//            must-not-miss conditions NOT in that set are ignored as
//            blockers (they appear in the UI for awareness but cannot
//            be answered, so can't gate). Default behaviour (askable
//            undefined) preserves legacy "any unresolved MNM blocks".
//   F-018b — demoteSharedFindings uses normalized substring containment
//            instead of exact set membership.
//   F-018c — Rule 3b multiple-treatables tie-break prefers a single
//            "likely" over "possible" alternatives.

import { describe, expect, it } from "vitest";

import {
  applyAnswer,
  decideCollapse,
  demoteSharedFindings,
  type ConditionGuidelineMap,
} from "./collapse";
import type { Differential } from "./schemas";

const MAP: ConditionGuidelineMap = {
  croup: "starship-croup-2020",
  anaphylaxis: "ascia-anaphylaxis-2024",
};

// Mirrors registry/guidelines.ts CONDITION_META: only epiglottitis has
// non-empty discriminators in the live v1 registry.
const ASKABLE = new Set<string>(["epiglottitis"]);

describe("F-016D — decideCollapse returns reason on abstain", () => {
  it("Rule 1 (empty conditions) → reason=no_treatable", () => {
    const d: Differential = { conditions: [], candidate_guidelines: [] };
    const decision = decideCollapse(d, MAP, 0);
    expect(decision.action).toBe("abstain");
    expect(decision.reason).toBe("no_treatable");
  });

  it("Rule 2 (positive must-not-miss) → reason=unresolved_dangers", () => {
    const d: Differential = {
      conditions: [
        {
          name: "Epiglottitis",
          likelihood: "must-not-miss",
          positive_evidence: ["drooling", "tripod posture"],
          negative_evidence: [],
        },
      ],
      candidate_guidelines: [],
    };
    const decision = decideCollapse(d, MAP, 0);
    expect(decision.action).toBe("abstain");
    expect(decision.reason).toBe("unresolved_dangers");
  });

  it("Rule 3a (>1 unresolved must-not-miss, all askable) → reason=unresolved_dangers", () => {
    const d: Differential = {
      conditions: [
        {
          name: "Epiglottitis",
          likelihood: "must-not-miss",
          positive_evidence: [],
          negative_evidence: ["drooling"],
        },
        {
          // We force both to be askable by including the second one in
          // the askable set. The legacy default (undefined) would also
          // block here per Rule 3a.
          name: "Anaphylaxis",
          likelihood: "must-not-miss",
          positive_evidence: [],
          negative_evidence: ["urticaria"],
        },
      ],
      candidate_guidelines: [],
    };
    const decision = decideCollapse(
      d,
      MAP,
      0,
      new Set(["epiglottitis", "anaphylaxis"]),
    );
    expect(decision.action).toBe("abstain");
    expect(decision.reason).toBe("unresolved_dangers");
  });

  it("Rule 3b (>1 treatable, no clear likely-leader) → reason=no_treatable", () => {
    const d: Differential = {
      conditions: [
        {
          name: "croup",
          likelihood: "possible",
          positive_evidence: ["barky cough"],
          negative_evidence: [],
        },
        {
          name: "anaphylaxis",
          likelihood: "possible",
          positive_evidence: ["stridor"],
          negative_evidence: [],
        },
      ],
      candidate_guidelines: [],
    };
    const decision = decideCollapse(d, MAP, 0);
    expect(decision.action).toBe("abstain");
    expect(decision.reason).toBe("no_treatable");
  });
});

describe("F-018a — askable set narrows the unresolved-MNM blocker pool", () => {
  it("an unresolved must-not-miss NOT in askable does not block dosing", () => {
    // Foreign body aspiration is must-not-miss with empty positives, but it
    // has no registry discriminators — can't be asked about, so it shouldn't
    // gate. Croup is the leading treatable. Expectation: action=plan.
    const d: Differential = {
      conditions: [
        {
          name: "foreign body aspiration",
          likelihood: "must-not-miss",
          positive_evidence: [],
          negative_evidence: ["no choking episode"],
        },
        {
          name: "croup",
          likelihood: "likely",
          positive_evidence: ["barky cough", "stridor at rest"],
          negative_evidence: ["no cyanosis"],
        },
      ],
      candidate_guidelines: [],
    };
    const decision = decideCollapse(d, MAP, 0, ASKABLE);
    expect(decision.action).toBe("plan");
    expect(decision.guidelineId).toBe("starship-croup-2020");
  });

  it("an unresolved must-not-miss IN askable still blocks", () => {
    // Epiglottitis is in the askable set. Same shape as the test above except
    // the must-not-miss is now askable → it should block as ask (round 0).
    const d: Differential = {
      conditions: [
        {
          name: "Epiglottitis",
          likelihood: "must-not-miss",
          positive_evidence: [],
          negative_evidence: ["no drooling"],
        },
        {
          name: "croup",
          likelihood: "likely",
          positive_evidence: ["barky cough", "stridor at rest"],
          negative_evidence: [],
        },
      ],
      candidate_guidelines: [],
    };
    const decision = decideCollapse(d, MAP, 0, ASKABLE);
    expect(decision.action).toBe("ask");
    expect(decision.target).toBe("Epiglottitis");
  });

  it("legacy default (askable undefined) preserves old behaviour", () => {
    // Same fixture as the first F-018a test but no askable arg. Foreign body
    // aspiration is unresolved must-not-miss; the legacy gate treats every
    // unresolved must-not-miss as blocking → ask at round 0 (one treatable,
    // one unresolved must-not-miss, round < MAX_ROUNDS).
    const d: Differential = {
      conditions: [
        {
          name: "foreign body aspiration",
          likelihood: "must-not-miss",
          positive_evidence: [],
          negative_evidence: ["no choking episode"],
        },
        {
          name: "croup",
          likelihood: "likely",
          positive_evidence: ["barky cough", "stridor at rest"],
          negative_evidence: [],
        },
      ],
      candidate_guidelines: [],
    };
    const decision = decideCollapse(d, MAP, 0);
    expect(decision.action).toBe("ask");
    expect(decision.target).toBe("foreign body aspiration");
  });
});

describe("F-018b — demoteSharedFindings: normalized substring match", () => {
  it("demotes when treatable anchor and MNM finding are IDENTICAL (canonical-strings prompt path)", () => {
    // The Turn 1 prompt's FINDING-STRING DISCIPLINE asks the model to use
    // identical strings for shared findings. When followed, exact equality
    // (a subset of one-directional containment) catches the genuine "same
    // finding, repeated verbatim across conditions" case the demote was
    // designed for. This is the primary path post-adversarial-review #2.
    const d: Differential = {
      conditions: [
        {
          name: "foreign body aspiration",
          likelihood: "must-not-miss",
          positive_evidence: ["stridor at rest"],
          negative_evidence: [],
        },
        {
          name: "croup",
          likelihood: "likely",
          positive_evidence: ["stridor at rest", "barky cough"],
          negative_evidence: [],
        },
      ],
      candidate_guidelines: [],
    };
    const demoted = demoteSharedFindings(d, MAP);
    const fb = demoted.conditions.find(
      (c) => c.name === "foreign body aspiration",
    );
    expect(fb?.positive_evidence).toEqual([]);
    expect(
      fb?.negative_evidence.some((s) =>
        s.includes("[shared / non-discriminating]"),
      ),
    ).toBe(true);
  });

  it("demotes when treatable anchor CONTAINS the MNM finding (longer anchor, shorter MNM)", () => {
    // One-directional: anchor ⊇ MNM matches. This is the safe direction —
    // the treatable's longer phrasing already covers the MNM's generic.
    const d: Differential = {
      conditions: [
        {
          name: "foreign body aspiration",
          likelihood: "must-not-miss",
          positive_evidence: ["stridor"],
          negative_evidence: [],
        },
        {
          name: "croup",
          likelihood: "likely",
          positive_evidence: ["stridor at rest"],
          negative_evidence: [],
        },
      ],
      candidate_guidelines: [],
    };
    const demoted = demoteSharedFindings(d, MAP);
    const fb = demoted.conditions.find(
      (c) => c.name === "foreign body aspiration",
    );
    expect(fb?.positive_evidence).toEqual([]);
  });

  // F-018 + Adversarial #2 (2026-05-27) — Critical safety regression test.
  // The earlier bidirectional findingShared let a GENERIC anchor on a treatable
  // strip discriminating qualifier-bearing positives off a must-not-miss.
  // Worked example: Croup over-lists "rash", meningococcaemia has "purpuric
  // rash" — bidirectional would demote the MNM's purpuric qualifier into the
  // audit trail. One-directional protects against this.
  it("DOES NOT demote when MNM finding has a discriminating qualifier and anchor is the generic stem", () => {
    const d: Differential = {
      conditions: [
        {
          name: "meningococcaemia",
          likelihood: "must-not-miss",
          // Discriminating qualifier ("purpuric") — must NOT be stripped.
          positive_evidence: ["purpuric rash"],
          negative_evidence: [],
        },
        {
          name: "croup",
          likelihood: "likely",
          // Generic anchor — would have stripped MNM under bidirectional.
          positive_evidence: ["rash"],
          negative_evidence: [],
        },
      ],
      candidate_guidelines: [],
    };
    const demoted = demoteSharedFindings(d, MAP);
    const mng = demoted.conditions.find((c) => c.name === "meningococcaemia");
    // The purpuric qualifier survives — MNM stays as positive must-not-miss.
    expect(mng?.positive_evidence).toEqual(["purpuric rash"]);
    expect(
      mng?.negative_evidence.some((s) =>
        s.includes("[shared / non-discriminating]"),
      ),
    ).toBe(false);
    // Rule 2 (positive must-not-miss → abstain) MUST still fire downstream.
    const decision = decideCollapse(demoted, MAP, 0);
    expect(decision.action).toBe("abstain");
    expect(decision.reason).toBe("unresolved_dangers");
  });

  it("DOES NOT demote when MNM finding is LONGER than treatable anchor (qualifier survives)", () => {
    // Same shape as the canonical F-018 motivating case BEFORE the prompt
    // started enforcing identical strings — proves one-directional refuses
    // to strip qualifier text even when the strings differ in length.
    const d: Differential = {
      conditions: [
        {
          name: "foreign body aspiration",
          likelihood: "must-not-miss",
          positive_evidence: ["stridor at rest in a toddler"],
          negative_evidence: [],
        },
        {
          name: "croup",
          likelihood: "likely",
          positive_evidence: ["stridor at rest"],
          negative_evidence: [],
        },
      ],
      candidate_guidelines: [],
    };
    const demoted = demoteSharedFindings(d, MAP);
    const fb = demoted.conditions.find(
      (c) => c.name === "foreign body aspiration",
    );
    // The MNM's qualifier-bearing string survives. The prompt asks the
    // model to use identical strings — this is the belt-and-braces safety
    // net for the case where it doesn't.
    expect(fb?.positive_evidence).toEqual(["stridor at rest in a toddler"]);
  });

  it("does NOT demote a finding that only appears on must-not-miss conditions (no benign anchor)", () => {
    // Two must-not-miss, both with "stridor", but no treatable. Demote leaves
    // them alone — Rule 2 will (correctly) abstain on multiple dangers.
    const d: Differential = {
      conditions: [
        {
          name: "epiglottitis",
          likelihood: "must-not-miss",
          positive_evidence: ["stridor"],
          negative_evidence: [],
        },
        {
          name: "bacterial tracheitis",
          likelihood: "must-not-miss",
          positive_evidence: ["stridor"],
          negative_evidence: [],
        },
      ],
      candidate_guidelines: [],
    };
    const demoted = demoteSharedFindings(d, MAP);
    expect(
      demoted.conditions.every((c) => c.positive_evidence.length > 0),
    ).toBe(true);
  });
});

describe("F-018c — Rule 3b: single 'likely' wins against 'possible' alternatives", () => {
  it("one likely + multiple possible treatables → plan the likely", () => {
    const d: Differential = {
      conditions: [
        {
          name: "croup",
          likelihood: "likely",
          positive_evidence: ["barky cough", "stridor at rest"],
          negative_evidence: [],
        },
        {
          name: "anaphylaxis",
          likelihood: "possible",
          positive_evidence: ["stridor"],
          negative_evidence: ["no urticaria"],
        },
      ],
      candidate_guidelines: [],
    };
    const decision = decideCollapse(d, MAP, 0);
    expect(decision.action).toBe("plan");
    expect(decision.guidelineId).toBe("starship-croup-2020");
  });

  it("multiple 'likely' treatables → still abstain (genuine tie)", () => {
    const d: Differential = {
      conditions: [
        {
          name: "croup",
          likelihood: "likely",
          positive_evidence: ["barky cough"],
          negative_evidence: [],
        },
        {
          name: "anaphylaxis",
          likelihood: "likely",
          positive_evidence: ["stridor", "urticaria"],
          negative_evidence: [],
        },
      ],
      candidate_guidelines: [],
    };
    const decision = decideCollapse(d, MAP, 0);
    expect(decision.action).toBe("abstain");
    expect(decision.reason).toBe("no_treatable");
  });
});

describe("F-016 end-to-end: the live Croup case path", () => {
  it("Turn 1.5 ask Epiglottitis → answer absent → Turn 2 gate passes → plan", () => {
    // Mirrors the Turn 1 output from the live croup demo run that motivated
    // F-016 (canonical finding strings via the F-018 prompt; askable set
    // limited to epiglottitis).
    const initial: Differential = {
      conditions: [
        {
          name: "foreign body aspiration",
          likelihood: "must-not-miss",
          positive_evidence: ["stridor at rest"],
          negative_evidence: ["no choking episode"],
        },
        {
          name: "croup",
          likelihood: "likely",
          positive_evidence: ["barky cough", "stridor at rest", "age 3 years"],
          negative_evidence: ["no cyanosis", "not lethargic"],
        },
        {
          name: "Epiglottitis",
          likelihood: "must-not-miss",
          positive_evidence: ["stridor at rest"],
          negative_evidence: ["drooling", "tripod posture", "muffled voice"],
        },
      ],
      candidate_guidelines: [],
    };

    // Step 1: clinician answers "absent" on Epiglottitis discriminators.
    const afterAnswer = applyAnswer(
      initial,
      "Epiglottitis",
      ["drooling", "tripod posture", "muffled voice"],
      false,
    );
    const epi = afterAnswer.conditions.find((c) => c.name === "Epiglottitis");
    expect(epi?.likelihood).toBe("possible");

    // Step 2: Turn 2 gate runs demote + decideCollapse with askable=ASKABLE.
    const demoted = demoteSharedFindings(afterAnswer, MAP);
    // After demote, both MNM's "stridor at rest" should be demoted (Croup is
    // benign anchor for it). Foreign body aspiration becomes unanswerable
    // (not in askable) → not a blocker.
    const fb = demoted.conditions.find(
      (c) => c.name === "foreign body aspiration",
    );
    expect(fb?.positive_evidence).toEqual([]);

    const decision = decideCollapse(demoted, MAP, /* round */ 1, ASKABLE);
    expect(decision.action).toBe("plan");
    expect(decision.guidelineId).toBe("starship-croup-2020");
  });
});
