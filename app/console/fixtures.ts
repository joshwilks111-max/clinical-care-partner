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
  id:
    | "croup-mild"
    | "croup"
    | "croup-severe"
    | "anaphylaxis"
    | "transcript-croup";
  /** Which demo group the button sits in (Notes vs Transcripts). */
  group: "note" | "transcript";
  /** Button label the reviewer clicks. */
  label: string;
  /** One-line "what this demonstrates" caption under the button. */
  caption: string;
  /** The prefilled note POSTed verbatim to /api/turn1. */
  note: string;
};

export const DEMO_NOTES: DemoCase[] = [
  // --- NOTES (structured clinical notes) ---
  {
    id: "croup-mild",
    group: "note",
    label: "Croup — Mild",
    caption: "Mild croup, 12.8 kg → 1.92 mg dexamethasone, safe for home.",
    note: `Patient: Mia H.
DOB: 08/07/2021
Age: 3 years
Weight: 12.8 kg

Presenting complaint:
Mia presented with a 1-day history of barky, seal-like cough and mild hoarseness. Parents report symptoms began overnight, with no preceding choking event or fever. No noisy breathing noted at rest at home, though parents heard occasional inspiratory sounds when she was upset or crying.

History:
- Onset of coryzal symptoms 2 days ago; barky cough began early this morning
- No stridor noted at rest; intermittent stridor when agitated or crying
- Low-grade fever (up to 37.8°C); settled with paracetamol
- No cyanosis, no apnoea, no drooling
- Normal oral intake; tolerating fluids well
- Fully vaccinated and developmentally on track for age
- No history of asthma, recurrent croup, or chronic respiratory illness
- No known drug allergies; no recent travel or sick contacts

Examination:
- Alert, interactive, in no acute respiratory distress; sitting comfortably
- No audible stridor at rest; mild intermittent inspiratory stridor with crying
- No chest wall recession; no use of accessory muscles
- RR 26, HR 110, SpO2 99% on room air, T 37.6°C
- Chest: clear air entry bilaterally, no wheeze or crackles
- ENT: mild pharyngeal erythema; no tonsillar exudate, no drooling, no stridor at rest
- CVS: normal S1/S2, no murmurs
- Neurological: alert, playful, developmentally appropriate

Assessment:
Mia presents with features consistent with mild croup (laryngotracheobronchitis), likely viral in aetiology. No stridor at rest, no signs of moderate–severe respiratory distress, no features suggestive of bacterial tracheitis, epiglottitis, or foreign body aspiration.

Plan:
- Administer corticosteroids as per local guidelines for mild croup
- Parents educated on return precautions: worsening stridor at rest, increased work of breathing, cyanosis, or drooling
- Safe for discharge with outpatient follow-up if symptoms persist beyond 48 hours`,
  },
  {
    id: "croup",
    group: "note",
    label: "Croup — Moderate",
    caption: "Jack 14.2 kg moderate croup → 2.13 mg dexamethasone.",
    note: `Patient: Jack T.
DOB: 12/03/2022
Age: 3 years
Weight: 14.2 kg

Presenting complaint:
Jack presented with a 2-day history of barky cough, hoarse voice, and low-grade fever. Symptoms worsened overnight, with increased work of breathing and stridor noted at rest this morning. No history of choking, foreign body aspiration, or recent travel. No known sick contacts outside the household.

History:
- Onset of URTI symptoms 2 days ago, including rhinorrhoea and dry cough
- Barking cough began yesterday evening, hoarseness and intermittent inspiratory stridor overnight
- Mild fever (up to 38.4°C) controlled with paracetamol
- No cyanosis or apnoea reported
- Fully vaccinated and developmentally appropriate for age
- No history of asthma or other chronic respiratory illness
- No previous episodes of croup
- No drug allergies

Examination:
- Alert, mildly distressed, sitting upright with audible inspiratory stridor at rest
- Barky cough noted during assessment
- Mild suprasternal and intercostal recession
- RR 32, HR 124, SpO2 97% on room air, T 37.9°C
- Chest: clear air entry bilaterally, no wheeze or crackles
- ENT: mild erythema of oropharynx, no tonsillar exudate
- CVS: normal S1/S2, no murmurs
- Neurological: alert, interactive, normal tone and reflexes

Assessment:
Jack presents with classic features of moderate croup (laryngotracheobronchitis), likely viral in origin. No signs of severe respiratory distress or impending airway obstruction. No signs suggestive of bacterial tracheitis or other differentials (e.g. foreign body, epiglottitis).

Plan:
- Administer corticosteroids
- Plan as per local guidelines for croup`,
  },
  {
    id: "croup-severe",
    group: "note",
    label: "Croup — Severe",
    caption: "25 kg severe croup → 15 mg raw → CAPPED to 12 mg.",
    note: `Patient: Thomas R.
DOB: 14/09/2019
Age: 5 years
Weight: 25 kg

Presenting complaint:
Thomas presented as an emergency transfer from a rural GP with a 3-day progressive barky cough, now with marked respiratory distress. Parents report symptoms began with a mild URTI but have deteriorated rapidly over the past 12 hours. Persistent stridor at rest since this morning; parents noted bluish discolouration around his lips approximately 2 hours prior to arrival.

History:
- URTI symptoms for 3 days; barky cough onset day 2
- Severe inspiratory stridor at rest since this morning; stridor now audible without a stethoscope
- High fever (up to 39.8°C); not responding well to paracetamol
- Cyanosis around lips noted at home approximately 2 hours ago (resolved en route)
- Increasingly lethargic; not interested in eating or drinking since morning
- No previous episodes of croup; fully vaccinated including Hib
- No history of asthma, airway anomaly, or previous intubation
- No known drug allergies

Examination:
- Pale, lethargic, appears toxic; preference for sitting forward position
- Audible inspiratory and early expiratory stridor at rest
- Marked suprasternal, intercostal, and subcostal recession; use of accessory muscles
- RR 42, HR 148, SpO2 90% on room air (improved to 95% on 2 L/min O2 via face mask), T 39.5°C
- Chest: reduced air entry bilaterally at bases; no wheeze
- ENT: no drooling; pharynx erythematous; no tonsillar exudate; no muffled voice (soft stridor)
- CVS: tachycardia, normal S1/S2
- Neurological: lethargic but rousable; responds to name; decreased interest in surroundings

Assessment:
Thomas presents with severe croup (laryngotracheobronchitis). Features of impending airway obstruction: persistent stridor at rest, marked recession, oxygen requirement, lethargy, and prior cyanosis. Must exclude bacterial tracheitis (toxic appearance, high fever, poor response to treatment) and epiglottitis (drooling absent, no muffled voice, presentation atypical). Requires urgent intervention.

Plan:
- Administer corticosteroids as per local guidelines for severe croup (maximum dose applies)
- Nebulised adrenaline and continuous monitoring
- Senior and anaesthetic review: potential for rapid airway deterioration
- ICU escalation pathway activated`,
  },
  {
    id: "anaphylaxis",
    group: "note",
    label: "Anaphylaxis",
    caption:
      "Adrenaline 0.01 mg/kg IM → 0.14 mL. Same harness, different drug.",
    note: `Patient: Sophie M.
DOB: 22/11/2021
Age: 4 years
Weight: 14.2 kg

Presenting complaint:
Sophie presented with an acute allergic reaction following accidental ingestion of peanut butter at a birthday party approximately 25 minutes ago. Parents report rapid onset of lip swelling, widespread urticaria, and wheeze shortly after ingestion. No previous documented anaphylaxis; known peanut allergy, family had forgotten to bring epi-pen.

History:
- Known peanut allergy diagnosed at age 2 following mild reaction (hives only); no prior anaphylaxis
- Accidental ingestion approximately 25 minutes ago (single cracker with trace peanut butter)
- Rapid onset within 10 minutes: perioral tingling → lip swelling → widespread urticaria → wheeze
- No vomiting, no stridor, no loss of consciousness
- No prior treatment administered (no epi-pen available at venue)
- No other known food allergies; no medication allergies
- No history of asthma or eczema
- Fully vaccinated; developmentally appropriate

Examination:
- Alert and frightened; cooperative with examination
- Widespread urticaria over trunk and arms; moderate lip and periorbital angioedema
- No stridor; expiratory wheeze heard bilaterally
- Mild intercostal recession; no cyanosis
- RR 36, HR 138, SpO2 95% on room air, BP 88/56 mmHg, T 37.2°C
- Chest: diffuse bilateral expiratory wheeze; no crackles
- Skin: urticaria and angioedema as above; no petechiae or purpura
- CVS: tachycardia, regular rhythm; peripheral pulses present; capillary refill 3 seconds
- Neurological: alert, anxious, GCS 15

Assessment:
Sophie presents with anaphylaxis (multi-system IgE-mediated hypersensitivity reaction) to peanut: urticaria and angioedema, bronchospasm, cardiovascular involvement (hypotension, tachycardia), onset within 30 minutes of ingestion. Severity: moderate–severe.

Plan:
- Adrenaline 0.01 mg/kg IM (anterolateral mid-thigh) as per local anaphylaxis guideline — administer immediately
- Supplemental oxygen; IV access; continuous monitoring
- Antihistamine and systemic corticosteroid after adrenaline
- Observe minimum 4–6 hours post adrenaline (biphasic reaction risk)
- Allergy/immunology referral and prescription for self-injectable adrenaline prior to discharge`,
  },

  // --- TRANSCRIPTS (free-form dialogue — proves "note AND/OR transcript" intake) ---
  {
    id: "transcript-croup",
    group: "transcript",
    label: "Transcript (croup)",
    caption: "Dialogue with weight → full differential → dose.",
    // Weight-PRESENT and phrased "14.2 kg" (NOT "kilos") — the pre-LLM gate's
    // regex (route.ts KG_WEIGHT_PRESENT) matches kg|kgs|kilograms? but NOT
    // "kilos", so "kilos" here would WRONGLY refuse. hasKgWeight(note) MUST be
    // true (locked by a unit test in fixtures-weight-gate.test.ts).
    note: [
      "Doctor: Hi, what's brought you in today?",
      "Parent: It's Jack, he's 3. He's had this awful barky cough since last night and a wheezy noise when he breathes in.",
      "Doctor: Is the noisy breathing there even when he's resting quietly?",
      "Parent: Yeah, even just sitting on my lap. He's not blue around the lips though, and he's still alert and grizzly, not floppy.",
      "Doctor: Good. And how much does he weigh?",
      "Parent: He was 14.2 kg at his check-up last week.",
      "Doctor: Okay. This looks like croup — barky cough with stridor at rest.",
    ].join("\n"),
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
        source_url: "https://www.starship.org.nz/guidelines/croup/",
        quote:
          "First-line (mild–moderate): dexamethasone 0.15 mg/kg ORALLY, single dose.",
      },
      {
        text: "Observe after treatment; discharge once stridor at rest has settled.",
        source_section: "Croup — Disposition / monitoring",
        source_version: "Starship NZ Clinical Guideline, 2020",
        source_url: "https://www.starship.org.nz/guidelines/croup/",
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
        source_url: "https://www.starship.org.nz/guidelines/croup/",
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
        source_url: "https://www.starship.org.nz/guidelines/croup/",
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
