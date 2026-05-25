// app/console/fixtures.ts
//
// DEMO NOTES + TYPED STATE FIXTURES for the structured console.
//
// Two jobs:
//   1. DEMO_NOTES — the 1-click pre-filled notes (DESIGN.md X5). The reviewer
//      never types: each button POSTs one of these verbatim to /api/turn1. The
//      weightless refusal note + the verified clinical cases (Jack croup, cap
//      25kg severe, anaphylaxis) make the on-camera path deterministic.
//   2. FIXTURE_* — fully-typed example responses for EVERY render state. The
//      view components are testable WITHOUT a live model call by rendering these
//      (jsdom suites do exactly that). They import the REAL wire types from the
//      routes/schemas so a drift in the contract breaks the fixture at compile
//      time — the fixtures can never silently disagree with the server shape.

import type { Turn2Response } from "@/app/api/turn2/route";
import type { Differential, ExtractedFacts } from "@/lib/schemas";
import type { CaseState } from "@/lib/case-state";

// ---------------------------------------------------------------------------
// The turn-1 SUCCESS wire shape. turn1's route returns this inline (it does not
// export a named union), so we describe the success member here, reusing the
// REAL imported field types (Differential, ExtractedFacts, CaseState) — only the
// envelope is local. The refusal/error members are described where consumed.
// ---------------------------------------------------------------------------

export type Turn1Success = {
  status: "ok";
  caseState: CaseState;
  differential: Differential;
  extractedFacts: ExtractedFacts;
  candidateGuidelines: Differential["candidate_guidelines"];
};

export type Turn1Refusal = {
  status: "refusal";
  reason: string;
  message: string;
};

export type Turn1Error = {
  status: "error";
  message: string;
};

/** The full turn-1 response union the console branches on. */
export type Turn1Response = Turn1Success | Turn1Refusal | Turn1Error;

// ---------------------------------------------------------------------------
// DEMO NOTES — the deterministic on-camera path (DESIGN.md X5 + demo cases).
// Verified clinical text; the croup note is the brief's Jack T. case verbatim.
// ---------------------------------------------------------------------------

export type DemoCase = {
  /** Stable key for buttons/tests. */
  id: "refusal" | "croup" | "cap" | "anaphylaxis";
  /** Button label the reviewer clicks. */
  label: string;
  /** One-line "what this demonstrates" caption under the button. */
  caption: string;
  /** The prefilled note POSTed verbatim to /api/turn1. */
  note: string;
};

export const DEMO_NOTES: DemoCase[] = [
  {
    id: "refusal",
    label: "Refusal (no weight)",
    caption: "Weightless note → pre-LLM refusal, zero model calls.",
    // No kg weight present → the pre-LLM gate refuses with no model call.
    note: "Jack T, 3yo. Barky cough, stridor at rest, no cyanosis. ?croup.",
  },
  {
    id: "croup",
    label: "Croup (Jack)",
    caption: "Jack 14.2 kg moderate croup → 2.13 mg dexamethasone.",
    note: "Jack T, 3yo, 14.2 kg. Barky cough, stridor at rest, no cyanosis, not lethargic. ?croup.",
  },
  {
    id: "cap",
    label: "Cap (25kg severe)",
    caption: "25 kg severe croup → 15 mg raw → CAPPED to 12 mg.",
    note: "5yo, 25 kg. Severe croup: persistent stridor at rest, marked distress, lethargic, cyanosis.",
  },
  {
    id: "anaphylaxis",
    label: "Anaphylaxis",
    caption:
      "Adrenaline 0.01 mg/kg IM → 0.14 mL. Same harness, different drug.",
    note: "4yo, 14.2 kg. Acute urticaria, lip swelling and wheeze after peanut. Anaphylaxis.",
  },
];

// ---------------------------------------------------------------------------
// FIXTURE building blocks.
// ---------------------------------------------------------------------------

const CROUP_DIFFERENTIAL: Differential = {
  conditions: [
    // must-not-miss is listed here SECOND on purpose — the view must reorder it
    // FIRST (DESIGN.md D1). Fixture ordering proves the view does the sorting.
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

const CROUP_FACTS: ExtractedFacts = {
  condition_hints: ["croup"],
  severity: "moderate",
  weight_kg: 14.2,
  age: "3yo",
  profession: null,
  setting: null,
};

const CROUP_CASE_STATE: CaseState = {
  note_hash: "fixture-hash-croup",
  extracted_facts: CROUP_FACTS,
  differential: CROUP_DIFFERENTIAL,
  selected_condition: null,
  selected_guideline_id: null,
  selected_severity: null,
};

// ---------------------------------------------------------------------------
// TURN-1 fixtures.
// ---------------------------------------------------------------------------

export const FIXTURE_TURN1_SUCCESS: Turn1Success = {
  status: "ok",
  caseState: CROUP_CASE_STATE,
  differential: CROUP_DIFFERENTIAL,
  extractedFacts: CROUP_FACTS,
  candidateGuidelines: CROUP_DIFFERENTIAL.candidate_guidelines,
};

export const FIXTURE_TURN1_REFUSAL: Turn1Refusal = {
  status: "refusal",
  reason: "weight_missing",
  message:
    "Weight is required to calculate a weight-based dose. I will not estimate a paediatric dose from age.",
};

export const FIXTURE_TURN1_ERROR: Turn1Error = {
  status: "error",
  message:
    "Turn 1 could not produce a structured differential (model or schema error).",
};

// ---------------------------------------------------------------------------
// TURN-2 fixtures — all four `status` members of Turn2Response.
// ---------------------------------------------------------------------------

export const FIXTURE_TURN2_OK: Turn2Response = {
  status: "ok",
  dose: {
    dose_mg: 2.13,
    dose_ml: null,
    drug: "dexamethasone",
    route: "oral",
    frequency: "single dose",
    calculation_trace: "14.2 kg × 0.15 mg/kg = 2.13 mg (under 12 mg cap)",
    capped: false,
    binding_limit: null,
    data_gaps: [],
  },
  plan: {
    recommendations: [
      {
        text: "Give dexamethasone 2.13 mg orally as a single dose.",
        source_section:
          "Croup — Corticosteroid treatment (dexamethasone dosing)",
        source_version: "Starship NZ Clinical Guideline, 2020",
        source_url:
          "https://starship.org.nz/guidelines/croup/ [CONFIRM URL AT BUILD]",
        quote:
          "First-line (mild–moderate): dexamethasone 0.15 mg/kg ORALLY, single dose.",
      },
      {
        text: "Observe after treatment; discharge once stridor at rest has settled.",
        source_section: "Croup — Disposition / monitoring",
        source_version: "Starship NZ Clinical Guideline, 2020",
        source_url:
          "https://starship.org.nz/guidelines/croup/ [CONFIRM URL AT BUILD]",
        quote:
          "Observe after treatment; most children with mild–moderate croup can be discharged once stridor at rest has settled.",
      },
    ],
    required_fields: {
      diagnosis: { present: true, value: "Croup (moderate)" },
      severity: { present: true, value: "moderate" },
      drug: { present: true, value: "dexamethasone" },
      dose: { present: true, value: "2.13 mg" },
      route: { present: true, value: "oral" },
      escalation_criteria: {
        present: true,
        value:
          "Nebulised adrenaline and senior/anaesthetic help if signs of severe croup.",
      },
      disposition: {
        present: true,
        value: "Observe; discharge once stridor at rest settles.",
      },
    },
  },
  provenance: {
    routed_guideline_id: "starship-croup-2020",
    severity_row: "moderate",
    dose_rule_id: "croup-dex-moderate",
    severity_reasoning:
      "Stridor at rest with distress but no cyanosis and not lethargic → moderate row.",
  },
};

// CAP-FIRED success: a valid `ok` plan whose dose trace shows the CAPPED segment
// in the amber accent (DESIGN.md D4). 25 kg severe → 15 mg → 12 mg.
export const FIXTURE_TURN2_CAPPED: Turn2Response = {
  status: "ok",
  dose: {
    dose_mg: 12,
    dose_ml: null,
    drug: "dexamethasone",
    route: "oral",
    frequency: "single dose",
    calculation_trace: "25 kg × 0.6 mg/kg = 15 mg → CAPPED to 12 mg",
    capped: true,
    binding_limit: 12,
    data_gaps: [],
  },
  plan: {
    recommendations: [
      {
        text: "Give dexamethasone 12 mg orally (dose capped at the 12 mg maximum).",
        source_section:
          "Croup — Corticosteroid treatment (dexamethasone dosing)",
        source_version: "Starship NZ Clinical Guideline, 2020",
        source_url:
          "https://starship.org.nz/guidelines/croup/ [CONFIRM URL AT BUILD]",
        quote: "Maximum single dose: 12 mg (cap applies to all severities).",
      },
    ],
    required_fields: {
      diagnosis: { present: true, value: "Croup (severe)" },
      severity: { present: true, value: "severe" },
      drug: { present: true, value: "dexamethasone" },
      dose: { present: true, value: "12 mg (capped)" },
      route: { present: true, value: "oral" },
      escalation_criteria: {
        present: true,
        value:
          "Nebulised adrenaline + senior/anaesthetic help; airway emergency.",
      },
      disposition: { present: true, value: "Admit and observe; escalate." },
    },
  },
  provenance: {
    routed_guideline_id: "starship-croup-2020",
    severity_row: "severe",
    dose_rule_id: "croup-dex-severe",
    severity_reasoning:
      "Marked distress, lethargy and cyanosis → severe row (0.6 mg/kg).",
  },
};

// AMBER deliberate abstention (the dose-tool/no-guideline shape).
export const FIXTURE_TURN2_ABSTENTION: Turn2Response = {
  status: "abstention",
  reason: "no_matching_guideline",
  headline:
    "No local guideline matches this condition. I will not guess a plan from outside the registry.",
  detail: "Only croup and anaphylaxis are in the committed registry for v1.",
  source: "no-guideline",
};

// THE MONEY-SHOT: faithful-but-INCOMPLETE. escalation_criteria is null → the
// completeness gate fired. The missing field name is the headline.
export const FIXTURE_TURN2_INCOMPLETE: Turn2Response = {
  status: "incomplete",
  missing: ["escalation_criteria"],
  headline:
    "Plan is faithful but INCOMPLETE — missing required field(s): escalation_criteria.",
  plan: {
    recommendations: [
      {
        text: "Give dexamethasone 2.13 mg orally as a single dose.",
        source_section:
          "Croup — Corticosteroid treatment (dexamethasone dosing)",
        source_version: "Starship NZ Clinical Guideline, 2020",
        source_url:
          "https://starship.org.nz/guidelines/croup/ [CONFIRM URL AT BUILD]",
        quote:
          "First-line (mild–moderate): dexamethasone 0.15 mg/kg ORALLY, single dose.",
      },
    ],
    required_fields: {
      diagnosis: { present: true, value: "Croup (moderate)" },
      severity: { present: true, value: "moderate" },
      drug: { present: true, value: "dexamethasone" },
      dose: { present: true, value: "2.13 mg" },
      route: { present: true, value: "oral" },
      // The dropped slot — present:false / value:null fires the gate.
      escalation_criteria: { present: false, value: null },
      disposition: {
        present: true,
        value: "Observe; discharge once stridor at rest settles.",
      },
    },
  },
  provenance: {
    routed_guideline_id: "starship-croup-2020",
    severity_row: "moderate",
    dose_rule_id: "croup-dex-moderate",
    severity_reasoning:
      "Stridor at rest, distress, no cyanosis → moderate row.",
  },
};

// RED technical error (the ONLY red state). Distinct from amber abstention.
export const FIXTURE_TURN2_ERROR: Turn2Response = {
  status: "error",
  message:
    "Turn 2 plan synthesis failed (model or schema error). The model could not be reached.",
};
