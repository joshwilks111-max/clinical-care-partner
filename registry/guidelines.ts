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
// Clinical sources:
//   Starship NZ croup guideline (2020 version) — dexamethasone 0.15 / 0.6 mg/kg,
//     max 12 mg, oral. Jack 14.2 kg moderate → 0.15 × 14.2 = 2.13 mg.
//   ASCIA AU/NZ anaphylaxis guideline (2024 version) — adrenaline 0.01 mg/kg IM,
//     max 0.5 mg, 1:1000 = 1.0 mg/mL. Jack 14.2 kg → 0.142 mg → 0.14 mL.

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
 * A committed, version-pinned guideline: the whole document text the LLM cites
 * verbatim, plus the typed dose rules and the required output slots. The
 * registry holds DoseRule and RequiredFields together — single source of truth.
 */
export type Guideline = {
  guideline_id: string;
  condition: string;
  whole_document_text: string; // committed, version-pinned full guideline excerpt
  dose_rules: DoseRule[];
  required_fields: RequiredFields;
};

/** Typed registry keyed by guideline_id. */
export type GuidelineRegistry = Record<string, Guideline>;

// ---------------------------------------------------------------------------
// Guideline 1 — Starship croup (dexamethasone, oral, 12 mg cap)
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

const starshipCroup: Guideline = {
  guideline_id: "starship-croup-2020",
  condition: "croup",
  whole_document_text: STARSHIP_CROUP_TEXT,
  dose_rules: [
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
  ],
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
};

// ---------------------------------------------------------------------------
// Guideline 2 — ASCIA anaphylaxis (adrenaline, IM, 0.5 mg cap)
// ---------------------------------------------------------------------------

const ASCIA_ANAPHYLAXIS_TEXT = `ASCIA — ACUTE MANAGEMENT OF ANAPHYLAXIS
Guidelines for health professionals — version 2024 (Australasian Society of
Clinical Immunology and Allergy, AU/NZ).

DEFINITION
Anaphylaxis is a severe, life-threatening, generalised hypersensitivity
reaction. Suspect anaphylaxis with any acute onset of typical skin features
PLUS respiratory and/or cardiovascular and/or persistent severe GI symptoms,
OR acute hypotension/airway/breathing compromise after a likely allergen.

FIRST-LINE TREATMENT — INTRAMUSCULAR ADRENALINE
- Adrenaline (epinephrine) is FIRST-LINE and must not be delayed.
- Dose: 0.01 mg/kg of 1:1000 adrenaline by INTRAMUSCULAR injection into the
  mid-anterolateral thigh.
- 1:1000 adrenaline = 1.0 mg/mL, so 0.01 mg/kg = 0.01 mL/kg.
- Maximum single dose: 0.5 mg (0.5 mL of 1:1000).
- Repeat every 5 minutes as needed if no response.

POSITIONING
- Lay the person flat (or allow sitting if breathing is difficult); do NOT
  stand or walk the patient — sudden upright posture can cause collapse.

ESCALATION CRITERIA
- Call for emergency help / resuscitation team immediately.
- Give high-flow oxygen and IV fluids for hypotension; prepare for repeat
  adrenaline and possible adrenaline infusion if poor response.
- Monitor continuously (airway, breathing, circulation, pulse oximetry, ECG,
  blood pressure) and escalate to senior/critical-care support.

MONITORING / OBSERVATION
- Observe for a minimum period after recovery; biphasic reactions can occur.`;

const ASCIA_SOURCE_SECTION =
  "Acute management of anaphylaxis — First-line intramuscular adrenaline";
const ASCIA_SOURCE_VERSION = "ASCIA AU/NZ Guidelines, 2024";
// URL resolved + content-verified at build (2026-05-25): the ASCIA HP guideline
// PDF returns HTTP 200 and page 4 states verbatim "INTRAMUSCULAR INJECTION (IMI)
// OF ADRENALINE (1:1,000) ... (0.01mg per kg up to 0.5mg per dose)" and
// "Adrenaline 1:1,000 ampoules contain 1mg adrenaline per 1mL" — matching the
// registry's 0.01 mg/kg IM, 0.5 mg cap, 1.0 mg/mL exactly. Kept in lockstep with
// research/clinical-facts.md.
const ASCIA_SOURCE_URL =
  "https://www.allergy.org.au/images/ASCIA_HP_Guidelines_Acute_Management_Anaphylaxis_2024.pdf";

const asciaAnaphylaxis: Guideline = {
  guideline_id: "ascia-anaphylaxis-2024",
  condition: "anaphylaxis",
  whole_document_text: ASCIA_ANAPHYLAXIS_TEXT,
  dose_rules: [
    {
      dose_rule_id: "anaphylaxis-adrenaline-im",
      drug: "adrenaline",
      mg_per_kg: 0.01,
      min_mg: null,
      max_mg: 0.5,
      route: "IM",
      frequency: "repeat every 5 minutes as needed",
      concentration_mg_per_ml: 1.0, // 1:1000 = 1.0 mg/mL → tool derives mL deterministically
      // ASCIA gives weight-band volumes (0.01 mL/kg of 1:1000). Encoding the
      // rounding to nearest 0.01 mg keeps the derived volume consistent with the
      // verified figure: 14.2 kg × 0.01 = 0.142 mg → nearest 0.01 = 0.14 mg →
      // 0.14 mL at 1.0 mg/mL. (At 1.0 mg/mL, 0.01 mg increment == 0.01 mL
      // increment, so this is the mL-band rounding expressed in mg.)
      rounding: { direction: "nearest", increment_mg: 0.01 },
      source_section: ASCIA_SOURCE_SECTION,
      source_version: ASCIA_SOURCE_VERSION,
      source_url: ASCIA_SOURCE_URL,
      human_verified: true,
    },
  ],
  required_fields: {
    fields: [
      "diagnosis",
      "drug",
      "dose",
      "route",
      "positioning",
      "escalation_criteria",
      "monitoring",
    ],
  },
};

// ---------------------------------------------------------------------------
// Registry + accessor
// ---------------------------------------------------------------------------

/** The committed registry, keyed by guideline_id. Single source of truth. */
export const GUIDELINES: GuidelineRegistry = {
  [starshipCroup.guideline_id]: starshipCroup,
  [asciaAnaphylaxis.guideline_id]: asciaAnaphylaxis,
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
 * Routing data only (NO logic). The router (lib/router.ts)
 * consumes this to map a confirmed condition to its guideline_id.
 * One guideline per condition. Setting is "hospital ED" per DESIGN.md's table;
 * profession is "(any)".
 */
export const ROUTING_TABLE: ReadonlyArray<{
  condition: string;
  profession: string; // "(any)" — not used to discriminate in v1
  setting: string;
  guideline_id: string;
}> = [
  {
    condition: "croup",
    profession: "(any)",
    setting: "hospital ED",
    guideline_id: "starship-croup-2020",
  },
  {
    condition: "anaphylaxis",
    profession: "(any)",
    setting: "hospital ED",
    guideline_id: "ascia-anaphylaxis-2024",
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
  /**
   * Optional: per-canonical-discriminator note synonyms used by the
   * NegEx-style note-discriminator scanner (lib/note-discriminator-scan.ts).
   * Maps a canonical discriminator string (must appear in `discriminators`)
   * to the surface forms the scanner looks for in the raw note. The canonical
   * key is what flows into Turn 1's negative_evidence and what the Turn 1.5
   * override matches by string identity — every entry's key MUST also be in
   * the `discriminators` array.
   *
   * When ABSENT (current croup, anaphylaxis), the scanner emits no
   * groundings for that condition — same behaviour as before this field
   * existed.
   */
  discriminator_surface_forms?: Record<string, string[]>;
  applicable_guidelines: string[];
};

/** Single source of truth for condition-level routing metadata. */
export const CONDITION_META: Record<string, ConditionMeta> = {
  croup: {
    condition: "croup",
    mustNotMiss: false,
    discriminators: [],
    applicable_guidelines: ["starship-croup-2020"],
  },
  anaphylaxis: {
    condition: "anaphylaxis",
    mustNotMiss: false,
    discriminators: [],
    applicable_guidelines: ["ascia-anaphylaxis-2024"],
  },
  epiglottitis: {
    condition: "epiglottitis",
    mustNotMiss: true,
    discriminators: ["drooling", "tripod posture", "muffled voice"],
    // Per-discriminator note synonyms for the NegEx-style scanner.
    // Sources: textbook teaching (Starship NZ paediatric notes idioms;
    // "hot potato voice" is the classic clinical mnemonic; "sniffing
    // position" is the anaesthetics-formal alias for tripod posture).
    // Each canonical key MUST appear in `discriminators` above.
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
