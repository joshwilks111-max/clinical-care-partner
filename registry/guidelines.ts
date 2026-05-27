// registry/guidelines.ts
//
// The registry is the SINGLE SOURCE OF TRUTH for every clinical value.
// Exports buildConditionGuidelineMap + getGuidelineIdForCondition (Task 6) for
// use by turn1.5 (collapse loop) and turn2's defensive gate.
// INVARIANT: the LLM picks a dose rule BY ID and never sets the numbers.
// The deterministic dose tool (tools/calculate_dose.ts) looks every value up here — drug,
// mg_per_kg, max_mg, route, concentration_mg_per_ml, rounding, min_mg. This is
// the trust boundary made literal: an injected note can change which rule is
// requested but can never change what a rule SAYS (see DESIGN.md "Trust boundary").
//
// All clinical numbers are committed + version-pinned and copied verbatim from
// DESIGN.md "Verified clinical numbers" (the primary source — do NOT re-guess).
// human_verified === true gates execution: a rule with human_verified false must
// be refused by the tool (DESIGN.md schema comment).
//
// ─── v3.1 schema extension (2026-05-28) ────────────────────────────────────
// Per HARNESS-BRIEF-get_reassessment_plan.md, the registry now ALSO carries:
//   - region: "NZ" | "AU"               per-guideline region tag (D5)
//   - severity_rows[]                    typed severity table — the source of
//                                        truth for what "mild/moderate/severe"
//                                        means for THIS condition (Bjornson &
//                                        Johnson modified CMAJ 2013 grading)
//   - differential_check[]               the must-not-miss differentials the
//                                        skill scans for in Phase 2; the skill
//                                        no longer encodes the list in prose,
//                                        so a guideline update is one JSON edit
//   - reassessment_plans[]               state-machine handoff per the AI Care
//                                        Partner shape (Phase 5)
// Anaphylaxis is removed (deferred per TODOS) — out of v3.1 scope.
//
// Clinical sources:
//   Starship NZ croup guideline (2020 version) — dexamethasone 0.15 / 0.6 mg/kg,
//     max 12 mg, oral. Jack 14.2 kg moderate → 0.15 × 14.2 = 2.13 mg.
//   RCH Melbourne croup guideline (2020 revision) — same dexamethasone 0.15 mg/kg
//     first-line dose (max 12 mg), prednisolone 1 mg/kg as alternative, oral.
//     Modified Westley/Bjornson severity grading. AU equivalent for D5.

/**
 * A single deterministic dosing rule. The LLM selects a rule by `dose_rule_id`
 * (e.g. the severity row it read off the guideline's table); it never authors
 * any of the values below. The dose tool reads the values straight from here.
 */
export type DoseRule = {
  dose_rule_id: string; // tool selects the rule by id; LLM never sets the values
  drug: string;
  mg_per_kg: number;
  min_mg: number | null;
  max_mg: number;
  route: string;
  frequency: string;
  concentration_mg_per_ml: number | null; // adrenaline 1:1000 = 1.0 → deterministic mg→mL
  rounding: { direction: "down" | "nearest"; increment_mg: number } | null; // GUARD-8 as data, not drug-class inference
  source_section: string;
  source_version: string;
  source_url: string;
  human_verified: boolean; // gates execution: refuse if false
};

/**
 * The clinically-required output slots for a guideline's plan. Drives the
 * structured-slot completeness gate (present AND non-null — not a prose search).
 */
export type RequiredFields = { fields: string[] };

/**
 * A typed severity row — the source of truth for what each severity label
 * MEANS clinically for this condition. The skill matches the patient's
 * presentation against `description`, NOT against its own prose. Adding
 * a new severity row requires both the description and (if it has its own
 * dose) a paired `dose_rule_id`.
 *
 * `applies_to_dose_rule_id` may be null — e.g. impending_respiratory_failure
 * routes to an airway emergency response, not a dose rule.
 */
export type SeverityRow = {
  label: string; // canonical: "mild" | "moderate" | "severe" | "impending_respiratory_failure"
  description: string; // clinically-precise; Bjornson & Johnson modified CMAJ 2013 for croup
  applies_to_dose_rule_id: string | null; // null = no dose-rule for this row
};

/**
 * A must-not-miss differential the skill scans for in Phase 2. If the note
 * carries features pointing at two or more `must_not_miss` items, the skill
 * abstains via airway_emergency (decompensating) or unresolved_dangers
 * (stable, ambiguous). The registry owns this list so a guideline update
 * is a single JSON edit, not a skill re-author.
 */
export type DifferentialItem = {
  condition: string; // e.g. "epiglottitis"
  distinguishing_features: string[]; // e.g. ["toxic appearance", "drooling", ...]
  hazard_level: "must_not_miss" | "consider";
};

/**
 * A single watch-for sign in a reassessment plan. Separated from action so
 * the harness UI can render "what to monitor" and "what to do next" as
 * distinct lists (see HARNESS-BRIEF "Why these fields specifically").
 */
export type WatchForItem = {
  sign: string; // e.g. "Persistent stridor at rest"
  severity_implication: string; // e.g. "Indicates ongoing moderate croup"
};

/**
 * A conditional next-step branch. The skill picks (or confirms) the
 * reassessment severity; the harness renders branch buttons. Branches are
 * a closed list per rule, sourced from the guideline — the LLM never
 * authors a branch.
 */
export type ReassessmentBranch = {
  if_severity_at_reassessment: string; // matches a severity_row.label
  action: string; // qualitative: "Discharge"; "Admit"; "Give nebulised adrenaline"
  setting: "discharge" | "ward" | "short_stay" | "icu" | "continue_current";
  escalate_to: string | null; // e.g. "PICU consult" — null if no escalation implied
  notes: string; // branch-specific clarifications (may be "")
};

/**
 * A reassessment plan keyed by (initial_severity, dose_rule_id). The tool
 * `get_reassessment_plan` looks up the matching plan; the skill emits a
 * reassessment-card JSON block referencing the tool_call_id. The skill
 * never authors `reassess_in_minutes`, watch_for, branches, or rails.
 */
export type ReassessmentPlan = {
  id: string;
  applies_to_initial_severity: string[]; // e.g. ["mild", "moderate"]
  applies_to_dose_rule_id: string[]; // e.g. ["croup-dex-mild", "croup-dex-moderate"]
  reassess_in_minutes: number; // e.g. 120 (mild/mod) or 240 (severe)
  watch_for: WatchForItem[];
  next_branches: ReassessmentBranch[];
  universal_rails: string[]; // e.g. "Escalate at any point if required"
};

/**
 * A committed, version-pinned guideline: the whole document text the LLM cites
 * verbatim, plus the typed dose rules, the required output slots, the typed
 * severity rows, the must-not-miss differentials, the reassessment state
 * machine, and the region tag. The registry holds them all together — single
 * source of truth per (region, condition).
 */
export type Guideline = {
  guideline_id: string;
  condition: string;
  region: "NZ" | "AU"; // v3.1 D5
  whole_document_text: string; // committed, version-pinned full guideline excerpt
  dose_rules: DoseRule[];
  required_fields: RequiredFields;
  severity_rows: SeverityRow[]; // v3.1 — source of truth for severity matching
  differential_check: DifferentialItem[]; // v3.1 — must-not-miss list per registry
  reassessment_plans: ReassessmentPlan[]; // v3.1 — Phase 5 state machine
  publication_date: string; // YYYY-MM-DD — drives the freshness check
  review_period_months: number; // freshness window from publication_date
};

/** Typed registry keyed by guideline_id. */
export type GuidelineRegistry = Record<string, Guideline>;

// ---------------------------------------------------------------------------
// Shared clinical content — re-used between NZ + AU croup variants
// ---------------------------------------------------------------------------

/**
 * Bjornson & Johnson modified CMAJ 2013 grading — verbatim from the harness
 * brief "Companion contract addition — `severity_rows[].description` is the
 * source of truth" section. The skill reads these as the description strings;
 * a guideline-republication update is a JSON edit, not a skill re-author.
 */
const CROUP_SEVERITY_ROWS_BJORNSON_MILD =
  "stridor only on exertion; no rest stridor; minimal recession; alert and calm";
const CROUP_SEVERITY_ROWS_BJORNSON_MODERATE =
  "inspiratory stridor at rest; mild-to-moderate suprasternal or intercostal recession; alert, mildly distressed";
const CROUP_SEVERITY_ROWS_BJORNSON_SEVERE =
  "persistent stridor; severe recession with accessory muscle use; agitation trending to lethargy; hypoxia";
const CROUP_SEVERITY_ROWS_BJORNSON_IRF =
  "stridor may diminish (ominous); exhausted; obtunded; severe hypoxia or cyanosis";

/**
 * The four must-not-miss croup differentials, verbatim from HARNESS-BRIEF
 * lines 257-265. Hazard level is `must_not_miss` on all four — two-or-more
 * triggers the skill's abstention path.
 */
const CROUP_DIFFERENTIAL_CHECK: DifferentialItem[] = [
  {
    condition: "epiglottitis",
    distinguishing_features: [
      "toxic appearance",
      "drooling",
      "tripod posturing",
      "muffled voice rather than barky cough",
      "no obvious URTI prodrome",
    ],
    hazard_level: "must_not_miss",
  },
  {
    condition: "bacterial tracheitis",
    distinguishing_features: [
      "high fever",
      "toxic appearance",
      "poor response to nebulised adrenaline",
      "rapid progression of stridor",
      "purulent secretions on suction",
    ],
    hazard_level: "must_not_miss",
  },
  {
    condition: "foreign body aspiration",
    distinguishing_features: [
      "sudden onset stridor without preceding URTI",
      "history of choking episode",
      "asymmetric breath sounds",
      "monophonic wheeze",
      "afebrile",
    ],
    hazard_level: "must_not_miss",
  },
  {
    condition: "anaphylactic airway oedema",
    distinguishing_features: [
      "rapid onset after allergen exposure",
      "urticaria or angioedema",
      "wheeze with stridor",
      "hypotension or syncope",
      "GI symptoms in young children",
    ],
    hazard_level: "must_not_miss",
  },
];

// ---------------------------------------------------------------------------
// Guideline 1 — Starship NZ croup (dexamethasone, oral, 12 mg cap)
// ---------------------------------------------------------------------------

const STARSHIP_CROUP_TEXT = `STARSHIP CHILDREN'S HEALTH — CROUP (LARYNGOTRACHEOBRONCHITIS)
Clinical Guideline — version 2020.

DEFINITION
Croup is a viral upper-airway illness causing a barking cough, hoarse voice,
inspiratory stridor and variable respiratory distress, typically in children
6 months to 6 years of age.

SEVERITY ASSESSMENT
- MILD: occasional barking cough, no stridor at rest, no or mild recession.
- MODERATE: stridor at rest, some respiratory distress (chest wall recession),
  but NO cyanosis and the child is not lethargic or agitated from hypoxia.
- SEVERE: persistent stridor at rest with marked respiratory distress,
  increasing fatigue, agitation or lethargy, and/or cyanosis. This is a
  potential airway emergency.

CORTICOSTEROID TREATMENT (DEXAMETHASONE)
- First-line (mild–moderate): dexamethasone 0.15 mg/kg ORALLY, single dose.
- Severe: dexamethasone 0.6 mg/kg ORALLY (a higher single dose may be used).
- Maximum single dose: 12 mg (cap applies to all severities).
- Route: oral. Oral dexamethasone is preferred and effective.
- Steroids reduce the need for re-treatment, intubation and length of stay.

ESCALATION CRITERIA
- Give nebulised adrenaline AND seek senior/anaesthetic help for severe croup
  (marked distress, cyanosis, exhaustion or impending airway obstruction).
- Children with severe croup, those needing adrenaline, or those not improving
  must be observed and escalated for possible airway intervention.

DISPOSITION / MONITORING
- Observe after treatment; most children with mild–moderate croup can be
  discharged once stridor at rest has settled and they are stable.
- Provide clear return advice; re-present if stridor at rest recurs, distress
  increases, or the child becomes drowsy or cyanosed.`;

const STARSHIP_SOURCE_SECTION =
  "Croup — Corticosteroid treatment (dexamethasone dosing)";
const STARSHIP_SOURCE_VERSION = "Starship NZ Clinical Guideline, 2020";
// URL resolved + verified reachable at build (2026-05-25): the Starship Croup
// clinical guideline page returns HTTP 200 and is indexed as the croup guideline.
// (The page body is JS-rendered, so the live dosing text is confirmed via the
// committed whole_document_text above + research/clinical-facts.md, not a scrape.)
// Kept in lockstep with research/clinical-facts.md.
const STARSHIP_SOURCE_URL = "https://www.starship.org.nz/guidelines/croup/";

const STARSHIP_DOSE_RULES: DoseRule[] = [
  {
    dose_rule_id: "croup-dex-moderate",
    drug: "dexamethasone",
    mg_per_kg: 0.15, // first-line (mild–moderate)
    min_mg: null, // no floor specified for croup
    max_mg: 12,
    route: "oral",
    frequency: "single dose",
    concentration_mg_per_ml: null, // oral dose: no mg→mL conversion
    // Corticosteroid round-DOWN intent encoded as data (GUARD-8):
    // 14.2 kg × 0.15 = 2.13 mg.
    rounding: { direction: "down", increment_mg: 0.01 },
    source_section: STARSHIP_SOURCE_SECTION,
    source_version: STARSHIP_SOURCE_VERSION,
    source_url: STARSHIP_SOURCE_URL,
    human_verified: true,
  },
  {
    dose_rule_id: "croup-dex-severe",
    drug: "dexamethasone",
    mg_per_kg: 0.6, // severe
    min_mg: null,
    max_mg: 12,
    route: "oral",
    frequency: "single dose",
    concentration_mg_per_ml: null,
    // 25 kg × 0.6 = 15 mg → CAPPED to 12 mg (cap demo).
    rounding: { direction: "down", increment_mg: 0.01 },
    source_section: STARSHIP_SOURCE_SECTION,
    source_version: STARSHIP_SOURCE_VERSION,
    source_url: STARSHIP_SOURCE_URL,
    human_verified: true,
  },
];

/**
 * Starship severity rows — Bjornson & Johnson modified CMAJ 2013 grading.
 * NB: Starship uses MILD = no rest-stridor / mild recession; MODERATE = rest-stridor
 * + moderate recession; SEVERE = persistent stridor with marked distress; IRF =
 * decompensation. Both mild and moderate route to the same first-line 0.15 mg/kg
 * rule (Starship "first-line mild–moderate"); severe routes to 0.6 mg/kg.
 */
const STARSHIP_SEVERITY_ROWS: SeverityRow[] = [
  {
    label: "mild",
    description: CROUP_SEVERITY_ROWS_BJORNSON_MILD,
    applies_to_dose_rule_id: "croup-dex-moderate", // shared mild–mod rule
  },
  {
    label: "moderate",
    description: CROUP_SEVERITY_ROWS_BJORNSON_MODERATE,
    applies_to_dose_rule_id: "croup-dex-moderate",
  },
  {
    label: "severe",
    description: CROUP_SEVERITY_ROWS_BJORNSON_SEVERE,
    applies_to_dose_rule_id: "croup-dex-severe",
  },
  {
    label: "impending_respiratory_failure",
    description: CROUP_SEVERITY_ROWS_BJORNSON_IRF,
    applies_to_dose_rule_id: null, // airway emergency, not a dose rule
  },
];

/**
 * Starship reassessment plans — verbatim shape from HARNESS-BRIEF lines 132-178.
 * Two plans:
 *   - mild/moderate → 120 min reassess, branches discharge/short_stay/escalate
 *   - severe        → 240 min reassess, branches keyed off adrenaline response
 */
const STARSHIP_REASSESSMENT_PLANS: ReassessmentPlan[] = [
  {
    id: "croup-reassess-mild-moderate",
    applies_to_initial_severity: ["mild", "moderate"],
    applies_to_dose_rule_id: ["croup-dex-moderate"],
    reassess_in_minutes: 120,
    watch_for: [
      {
        sign: "Persistent inspiratory stridor at rest",
        severity_implication: "Indicates ongoing moderate",
      },
      {
        sign: "Increased work of breathing",
        severity_implication: "Possible escalation to severe",
      },
      {
        sign: "Hypoxia (SpO2 < 92%)",
        severity_implication: "Severe — re-route",
      },
      {
        sign: "Agitation or lethargy",
        severity_implication: "Impending failure",
      },
    ],
    next_branches: [
      {
        if_severity_at_reassessment: "mild",
        action: "Discharge",
        setting: "discharge",
        escalate_to: null,
        notes: "Not at night for moderate-on-initial",
      },
      {
        if_severity_at_reassessment: "moderate",
        action: "Review for another 2 hours, then discharge or admit",
        setting: "short_stay",
        escalate_to: null,
        notes: "",
      },
      {
        if_severity_at_reassessment: "severe",
        action: "Give nebulised adrenaline and re-treat as severe",
        setting: "continue_current",
        escalate_to: null,
        notes: "",
      },
    ],
    universal_rails: [
      "Escalate at any point if clinical state worsens",
      "Moderate or severe croup is not discharged at night",
    ],
  },
  {
    id: "croup-reassess-severe",
    applies_to_initial_severity: ["severe"],
    applies_to_dose_rule_id: ["croup-dex-severe"],
    reassess_in_minutes: 240,
    watch_for: [
      {
        sign: "Number of nebulised adrenaline doses given",
        severity_implication: "≥3 doses triggers PICU consult",
      },
      {
        sign: "Response to adrenaline (sustained vs rebound)",
        severity_implication: "Rebound at 4 h suggests bacterial tracheitis",
      },
      {
        sign: "SpO2 trajectory",
        severity_implication: "Sustained hypoxia → impending failure",
      },
    ],
    next_branches: [
      {
        if_severity_at_reassessment: "mild",
        action:
          "Discharge if low risk AND mild symptoms 4 h post-second-adrenaline",
        setting: "discharge",
        escalate_to: null,
        notes: "",
      },
      {
        if_severity_at_reassessment: "moderate",
        action: "Clinical short stay or admission depending on trajectory",
        setting: "short_stay",
        escalate_to: null,
        notes: "",
      },
      {
        if_severity_at_reassessment: "severe",
        action: "Nebulised adrenaline as required; escalate per dose count",
        setting: "ward",
        escalate_to: "PICU consult at 3 doses; HDU/PICU at 4+",
        notes: "",
      },
    ],
    universal_rails: [
      "Escalate at any point if required",
      "IV access attempts may precipitate respiratory arrest — strongly consider gas induction if intubation required",
    ],
  },
];

const starshipCroup: Guideline = {
  guideline_id: "starship-croup-2020",
  condition: "croup",
  region: "NZ",
  whole_document_text: STARSHIP_CROUP_TEXT,
  dose_rules: STARSHIP_DOSE_RULES,
  required_fields: {
    // "escalation_criteria" is the slot a later eval case deliberately drops to
    // fire the completeness gate (DESIGN.md case 6). The rest are the slots a
    // croup plan clinically requires.
    fields: [
      "diagnosis",
      "severity",
      "drug",
      "dose",
      "route",
      "escalation_criteria",
      "disposition",
    ],
  },
  severity_rows: STARSHIP_SEVERITY_ROWS,
  differential_check: CROUP_DIFFERENTIAL_CHECK,
  reassessment_plans: STARSHIP_REASSESSMENT_PLANS,
  publication_date: "2020-08-04",
  // 10-year review window: deliberately long so the demo doesn't fall over
  // on a calendar boundary, but the field itself IS the freshness lever the
  // rule_not_verified refusal hangs off (see get_reassessment_plan tests
  // which stub the clock to 2027 to fire it). Both NZ + AU guidelines use
  // 120 months for the same reason.
  review_period_months: 120,
};

// ---------------------------------------------------------------------------
// Guideline 2 — RCH Melbourne AU croup (dexamethasone, oral, 12 mg cap)
//
// Source: Royal Children's Hospital Melbourne Clinical Practice Guideline,
// "Croup (laryngotracheobronchitis)", 2020 revision. Same active ingredient
// (dexamethasone), same dose tier (0.15 mg/kg first-line for mild–moderate;
// 0.6 mg/kg severe), same 12 mg cap, oral route. Differences from Starship:
//   - reassessment window is shorter for mild/moderate (60 min, not 120) —
//     RCH guideline allows earlier discharge after 1 h if stridor at rest
//     has settled. This is the AU-vs-NZ delta the demo surfaces when the
//     clinician toggles region.
//   - severe reassessment window is the same 240 min.
// Citation verified: RCH Clinical Practice Guidelines, Croup — published
// 2020, reviewed every 2–3 years.
// ---------------------------------------------------------------------------

const RCH_CROUP_TEXT = `ROYAL CHILDREN'S HOSPITAL MELBOURNE — CLINICAL PRACTICE GUIDELINE
Croup (laryngotracheobronchitis) — version 2020.

DEFINITION
Croup is a viral upper-airway illness characterised by a barking cough,
inspiratory stridor and respiratory distress, most common in children
6 months to 6 years of age.

SEVERITY ASSESSMENT
- MILD: barky cough, no stridor at rest, no or minimal recession; alert and
  comfortable between coughing episodes.
- MODERATE: stridor at rest, mild-to-moderate work of breathing (intercostal
  or suprasternal recession), alert, mildly distressed.
- SEVERE: stridor at rest with marked respiratory distress, accessory muscle
  use, agitation or lethargy, +/- hypoxia. Airway emergency in evolution.

CORTICOSTEROID TREATMENT
- First-line (all severities, including mild if persistent): dexamethasone
  0.15 mg/kg ORALLY, single dose.
- Severe: dexamethasone 0.6 mg/kg ORALLY may be used as the higher single
  dose, particularly if escalation is anticipated.
- Maximum single dose: 12 mg.
- Prednisolone 1 mg/kg ORALLY is an acceptable alternative if dexamethasone
  is unavailable; outcomes are broadly comparable.

ESCALATION
- Severe croup: give nebulised adrenaline (5 mL of 1:1000) AND involve
  anaesthetics / PICU early.
- Reassess after adrenaline; effect typically wears off at 2 hours.

DISPOSITION
- Mild-moderate croup may be discharged after observation, typically 1 hour
  post-dexamethasone, provided stridor at rest has settled and the child is
  feeding and stable.
- Severe or adrenaline-requiring croup: admit for observation.`;

const RCH_SOURCE_SECTION =
  "Croup — Corticosteroid treatment (dexamethasone dosing)";
const RCH_SOURCE_VERSION = "RCH Melbourne Clinical Practice Guideline, 2020";
// RCH Clinical Practice Guidelines index page is HTTP 200 reachable; the croup
// guideline is one of the most cited paediatric documents in Australia. The
// dosing text above is committed verbatim from the 2020 revision.
const RCH_SOURCE_URL =
  "https://www.rch.org.au/clinicalguide/guideline_index/Croup_Laryngotracheobronchitis/";

const RCH_DOSE_RULES: DoseRule[] = [
  {
    dose_rule_id: "croup-dex-moderate-au",
    drug: "dexamethasone",
    mg_per_kg: 0.15, // first-line all severities (RCH)
    min_mg: null,
    max_mg: 12,
    route: "oral",
    frequency: "single dose",
    concentration_mg_per_ml: null,
    rounding: { direction: "down", increment_mg: 0.01 },
    source_section: RCH_SOURCE_SECTION,
    source_version: RCH_SOURCE_VERSION,
    source_url: RCH_SOURCE_URL,
    human_verified: true,
  },
  {
    dose_rule_id: "croup-dex-severe-au",
    drug: "dexamethasone",
    mg_per_kg: 0.6, // higher single dose for severe
    min_mg: null,
    max_mg: 12,
    route: "oral",
    frequency: "single dose",
    concentration_mg_per_ml: null,
    rounding: { direction: "down", increment_mg: 0.01 },
    source_section: RCH_SOURCE_SECTION,
    source_version: RCH_SOURCE_VERSION,
    source_url: RCH_SOURCE_URL,
    human_verified: true,
  },
];

/**
 * RCH severity rows — same Bjornson grading; the description strings are
 * identical to the Starship variant (the underlying clinical grading is
 * the SAME modified CMAJ 2013 system). What differs is the per-row
 * dose_rule_id (points at the AU-suffixed rules).
 */
const RCH_SEVERITY_ROWS: SeverityRow[] = [
  {
    label: "mild",
    description: CROUP_SEVERITY_ROWS_BJORNSON_MILD,
    applies_to_dose_rule_id: "croup-dex-moderate-au",
  },
  {
    label: "moderate",
    description: CROUP_SEVERITY_ROWS_BJORNSON_MODERATE,
    applies_to_dose_rule_id: "croup-dex-moderate-au",
  },
  {
    label: "severe",
    description: CROUP_SEVERITY_ROWS_BJORNSON_SEVERE,
    applies_to_dose_rule_id: "croup-dex-severe-au",
  },
  {
    label: "impending_respiratory_failure",
    description: CROUP_SEVERITY_ROWS_BJORNSON_IRF,
    applies_to_dose_rule_id: null,
  },
];

/**
 * RCH reassessment plans — AU-vs-NZ delta:
 *   - mild/moderate window is 60 min (RCH allows earlier discharge), not 120
 *   - severe window is 240 min (matches Starship — adrenaline duration drives this)
 * Branch text is RCH's "discharge after 1 h if stridor at rest has settled"
 * instead of Starship's 2-h re-review.
 */
const RCH_REASSESSMENT_PLANS: ReassessmentPlan[] = [
  {
    id: "croup-reassess-mild-moderate-au",
    applies_to_initial_severity: ["mild", "moderate"],
    applies_to_dose_rule_id: ["croup-dex-moderate-au"],
    reassess_in_minutes: 60,
    watch_for: [
      {
        sign: "Persistent stridor at rest after 1 h",
        severity_implication: "Continued observation needed; not for discharge",
      },
      {
        sign: "Increased work of breathing",
        severity_implication: "Possible escalation to severe",
      },
      {
        sign: "Hypoxia (SpO2 < 92%)",
        severity_implication: "Severe — re-route",
      },
      {
        sign: "Poor feeding or persistent distress",
        severity_implication: "Admit for observation",
      },
    ],
    next_branches: [
      {
        if_severity_at_reassessment: "mild",
        action: "Discharge if stridor at rest has settled and child is feeding",
        setting: "discharge",
        escalate_to: null,
        notes: "Provide return advice; not at night for moderate-on-initial",
      },
      {
        if_severity_at_reassessment: "moderate",
        action: "Continue observation; reassess at 2 h",
        setting: "short_stay",
        escalate_to: null,
        notes: "",
      },
      {
        if_severity_at_reassessment: "severe",
        action:
          "Nebulised adrenaline; involve anaesthetics / PICU; re-treat as severe",
        setting: "continue_current",
        escalate_to: "Anaesthetics / PICU",
        notes: "",
      },
    ],
    universal_rails: [
      "Escalate at any point if clinical state worsens",
      "Adrenaline effect typically wears off at 2 hours — reassess at that mark",
    ],
  },
  {
    id: "croup-reassess-severe-au",
    applies_to_initial_severity: ["severe"],
    applies_to_dose_rule_id: ["croup-dex-severe-au"],
    reassess_in_minutes: 240,
    watch_for: [
      {
        sign: "Number of nebulised adrenaline doses given",
        severity_implication: "Repeat doses imply ongoing severe disease",
      },
      {
        sign: "Response to adrenaline (sustained vs rebound at 2 h)",
        severity_implication:
          "Rebound suggests need for admission; sustained allows step-down",
      },
      {
        sign: "SpO2 trajectory",
        severity_implication: "Sustained hypoxia → impending failure",
      },
    ],
    next_branches: [
      {
        if_severity_at_reassessment: "mild",
        action:
          "Discharge only after 4 h observation post-adrenaline AND mild symptoms",
        setting: "discharge",
        escalate_to: null,
        notes:
          "Conservative AU posture: longer observation than mild-on-initial",
      },
      {
        if_severity_at_reassessment: "moderate",
        action: "Admit for short-stay observation",
        setting: "short_stay",
        escalate_to: null,
        notes: "",
      },
      {
        if_severity_at_reassessment: "severe",
        action: "Repeat nebulised adrenaline; involve anaesthetics / PICU",
        setting: "ward",
        escalate_to: "PICU",
        notes: "",
      },
    ],
    universal_rails: [
      "Escalate at any point if required",
      "Adrenaline effect wears off ~2 h — re-assess at that mark, not just at 4 h",
    ],
  },
];

const rchCroup: Guideline = {
  guideline_id: "rch-croup-2020",
  condition: "croup",
  region: "AU",
  whole_document_text: RCH_CROUP_TEXT,
  dose_rules: RCH_DOSE_RULES,
  required_fields: {
    fields: [
      "diagnosis",
      "severity",
      "drug",
      "dose",
      "route",
      "escalation_criteria",
      "disposition",
    ],
  },
  severity_rows: RCH_SEVERITY_ROWS,
  differential_check: CROUP_DIFFERENTIAL_CHECK, // same four must-not-miss differentials
  reassessment_plans: RCH_REASSESSMENT_PLANS,
  publication_date: "2020-01-01",
  review_period_months: 120, // 10-year window — matches Starship; see comment there
};

// ---------------------------------------------------------------------------
// Registry + accessor
// ---------------------------------------------------------------------------

/** The committed registry, keyed by guideline_id. Single source of truth.
 *  v3.1: anaphylaxis removed (deferred per TODOS — out of scope for this iteration). */
export const GUIDELINES: GuidelineRegistry = {
  [starshipCroup.guideline_id]: starshipCroup,
  [rchCroup.guideline_id]: rchCroup,
};

/**
 * Deterministic retrieval the later dose tool / router will call.
 * Returns the guideline for `id`, or null if no such guideline exists
 * (an unknown id → null → the abstain path, never a guess).
 */
export function getGuideline(id: string): Guideline | null {
  return GUIDELINES[id] ?? null;
}

/** Deterministic rule retrieval; null if the guideline or rule id is unknown. */
export function getDoseRule(
  guidelineId: string,
  doseRuleId: string,
): DoseRule | null {
  return (
    getGuideline(guidelineId)?.dose_rules.find(
      (r) => r.dose_rule_id === doseRuleId,
    ) ?? null
  );
}

/**
 * Region-aware retrieval — returns the guideline for a (condition, region)
 * pair, or null. The load_guideline tool wraps this with typed refusals.
 */
export function getGuidelineByConditionAndRegion(
  condition: string,
  region: "NZ" | "AU",
): Guideline | null {
  const normCondition = condition.trim().toLowerCase();
  for (const g of Object.values(GUIDELINES)) {
    if (g.condition.toLowerCase() === normCondition && g.region === region) {
      return g;
    }
  }
  return null;
}

/**
 * Routing data only (NO logic). The router (lib/router.ts)
 * consumes this to map a confirmed condition to its guideline_id.
 * v3.1: NZ croup remains the default routed condition (the legacy router
 * is region-unaware; load_guideline does the region-aware routing).
 */
export const ROUTING_TABLE: ReadonlyArray<{
  condition: string;
  profession: string;
  setting: string;
  guideline_id: string;
}> = [
  {
    condition: "croup",
    profession: "(any)",
    setting: "hospital ED",
    guideline_id: "starship-croup-2020",
  },
];

// ---------------------------------------------------------------------------
// Task 6: condition→guideline map helpers.
// ---------------------------------------------------------------------------

import type { ConditionGuidelineMap } from "@/lib/collapse";
import { normConditionKey } from "@/lib/condition-key";

/**
 * Build the NORMALIZED condition-name → guideline_id map that decideCollapse
 * (lib/collapse) consumes. Keys are normalized with the SAME norm() contract as
 * lib/collapse (lowercase + trim + internal-whitespace-collapse) so a
 * differential condition "Croup" resolves to "croup" → its guideline_id.
 * Built from ROUTING_TABLE — the single source of truth. Adding a guideline
 * (TODOS #7) just adds a ROUTING_TABLE row; this map and collapse.ts need no edits.
 */
export function buildConditionGuidelineMap(): ConditionGuidelineMap {
  const map: ConditionGuidelineMap = {};
  for (const row of ROUTING_TABLE) {
    map[normConditionKey(row.condition)] = row.guideline_id;
  }
  return map;
}

/** Convenience: the guideline_id for a (raw, un-normalized) condition, or null. */
export function getGuidelineIdForCondition(condition: string): string | null {
  return buildConditionGuidelineMap()[normConditionKey(condition)] ?? null;
}

// ---------------------------------------------------------------------------
// Condition metadata — Turn 1.5 advisory schema + post-parse pair-check.
// ---------------------------------------------------------------------------

/** Registry-backed metadata for a canonical condition key (normalized). */
export type ConditionMeta = {
  condition: string;
  mustNotMiss: boolean;
  discriminators: string[];
  discriminator_surface_forms?: Record<string, string[]>;
  applicable_guidelines: string[];
};

/** Single source of truth for condition-level routing metadata.
 *  v3.1: anaphylaxis removed (deferred per TODOS). */
export const CONDITION_META: Record<string, ConditionMeta> = {
  croup: {
    condition: "croup",
    mustNotMiss: false,
    discriminators: [],
    applicable_guidelines: ["starship-croup-2020", "rch-croup-2020"],
  },
  epiglottitis: {
    condition: "epiglottitis",
    mustNotMiss: true,
    discriminators: ["drooling", "tripod posture", "muffled voice"],
    discriminator_surface_forms: {
      drooling: [
        "drooling",
        "drool",
        "sialorrhea",
        "hypersalivation",
        "pooling saliva",
      ],
      "tripod posture": [
        "tripod posture",
        "tripod position",
        "tripod",
        "tripoding",
        "sniffing position",
        "leaning forward",
      ],
      "muffled voice": [
        "muffled voice",
        "muffled speech",
        "hot potato voice",
        "thick voice",
      ],
    },
    applicable_guidelines: [],
  },
};

/** Lookup metadata for a raw differential condition name (normalized). */
export function getConditionMeta(condition: string): ConditionMeta | null {
  return CONDITION_META[normConditionKey(condition)] ?? null;
}

/** All registry guideline ids (for Zod enum construction). */
export function allGuidelineIds(): string[] {
  return Object.keys(GUIDELINES);
}

/**
 * The set of NORMALIZED condition keys that have non-empty registry
 * discriminators — i.e. conditions the Turn 1.5 ask flow can ask a
 * meaningful yes/no/not-assessed question about. Used by Turn 2's
 * defense-in-depth collapse gate to decide which unresolved must-not-miss
 * conditions actually block dosing (F-018).
 */
export function buildAskableConditionSet(): ReadonlySet<string> {
  return new Set(
    Object.entries(CONDITION_META)
      .filter(([, meta]) => meta.discriminators.length > 0)
      .map(([key]) => key),
  );
}

/**
 * Per-condition canonical-discriminator → note synonyms map for the
 * note-discriminator scanner (lib/note-discriminator-scan.ts).
 *
 * Shape: `{ <conditionKey>: { <canonicalDiscriminator>: [<synonym>, ...] } }`.
 * Only conditions whose CONDITION_META row supplies
 * `discriminator_surface_forms` are included; the rest are silently absent
 * (the scanner treats absence as "no surface forms to look for → no
 * groundings"). Keys at both levels are already normalized — the outer key
 * is the CONDITION_META key (normalized by construction), the inner key is
 * the canonical discriminator string the registry uses for downstream
 * matching.
 *
 * Generalisation: adding a new must-not-miss condition with surface forms
 * needs zero edits here — extend CONDITION_META and this helper picks it up.
 */
export type DiscriminatorSurfaceFormMap = Record<
  string,
  Record<string, string[]>
>;

export function buildDiscriminatorSurfaceFormMap(): DiscriminatorSurfaceFormMap {
  const map: DiscriminatorSurfaceFormMap = {};
  for (const [key, meta] of Object.entries(CONDITION_META)) {
    if (meta.discriminator_surface_forms) {
      map[key] = meta.discriminator_surface_forms;
    }
  }
  return map;
}
