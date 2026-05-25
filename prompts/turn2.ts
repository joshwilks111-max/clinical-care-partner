// prompts/turn2.ts
//
// TURN-2 PROMPT BUILDERS — the EXECUTION half (judgment ends, execution begins).
//
// TWO BOUNDED MODEL STEPS, with the deterministic dose tool BETWEEN them:
//
//   STEP A — SEVERITY CLASSIFICATION (rule-application, NOT clinical opinion).
//     The model READS the guideline's severity table and matches the confirmed
//     CaseState findings to a severity ROW, then names the dose_rule_id for that
//     row. This is reading a rubric, not forming an opinion (DESIGN.md "Severity
//     classification — rule-application, not judgment"). It is BOUNDED: the model
//     may only pick a dose_rule_id from the guideline's ACTUAL dose_rules — the
//     allowed ids are listed verbatim in the prompt and re-checked in code.
//     The model NEVER emits a dose number here; it picks a RULE BY ID.
//
//   [ between A and B, in route code: calculate_dose(...) runs — the
//     DETERMINISTIC tool owns every number. The model cannot set the cap. ]
//
//   STEP B — PLAN SYNTHESIS (Zod-constrained PlanOutput).
//     Given the whole guideline + the ALREADY-COMPUTED dose result, the model
//     writes recommendations that cite the guideline VERBATIM (section + quote
//     per recommendation — schema-enforced) and fills required_fields FROM the
//     guideline. It does NOT recompute the dose: the tool's number is handed in
//     and the plan references it. It does NOT invent guidelines: the registry
//     owns them; the model only cites the text it was given.
//
// ZERO RE-EXTRACTION (DESIGN.md "Two-turn HITL"): turn 2 operates on the
// CONFIRMED CaseState (structured facts the clinician already confirmed) + the
// retrieved guideline. The untrusted note is NOT passed to turn 2 — CaseState
// carries only note_hash + structured facts, so there is no untrusted command
// channel in this turn at all and nothing to re-read.

import { z } from "zod";
import type { Guideline } from "@/registry/guidelines";
import type { CaseState } from "@/lib/case-state";

// ---------------------------------------------------------------------------
// STEP A schema — the severity-classification output (model-facing).
// Small + bounded: the chosen rule id (must be one of the guideline's real ids)
// plus the rule-application reasoning that justifies it (which findings → which
// severity row → which rule). The reasoning is surfaced to the clinician — the
// "show the working" that DESIGN.md wants for the judgment EDGE.
// ---------------------------------------------------------------------------

export const SeverityClassification = z.object({
  /**
   * The severity row the findings matched (e.g. "moderate"). Free-text because
   * each guideline's table names its own rows; surfaced for show-the-working.
   */
  severity_row: z.string().min(1),
  /**
   * The dose_rule_id for that row. MUST be one of the guideline's actual
   * dose_rule_ids — bounded in the prompt AND re-validated in route code (the
   * model picks a rule by id; it never authors the rule).
   */
  dose_rule_id: z.string().min(1),
  /**
   * Rule-application reasoning: which findings mapped to which severity row,
   * read off the guideline's table. NOT clinical opinion — show-the-working.
   */
  reasoning: z.string().min(1),
});

export type SeverityClassification = z.infer<typeof SeverityClassification>;

// ---------------------------------------------------------------------------
// Shared: render the confirmed CaseState facts the model may use. We pass ONLY
// structured, confirmed facts — never the raw note (zero re-extraction).
// ---------------------------------------------------------------------------

function renderConfirmedFacts(caseState: CaseState): string {
  const f = caseState.extracted_facts;
  const lines = [
    `  - condition (clinician-confirmed): ${caseState.selected_condition ?? "(not set)"}`,
    `  - severity (clinician-confirmed): ${caseState.selected_severity ?? "(not set)"}`,
    `  - severity (turn-1 extracted): ${f.severity ?? "(not stated)"}`,
    `  - weight_kg (clinician-confirmed): ${f.weight_kg ?? "(not documented)"}`,
    `  - age: ${f.age ?? "(not stated)"}`,
    `  - condition_hints: ${f.condition_hints.length > 0 ? f.condition_hints.join(", ") : "(none)"}`,
  ];
  return lines.join("\n");
}

/** The guideline's allowed dose_rule_ids, listed verbatim for the bound. */
function allowedRuleIds(guideline: Guideline): string {
  return guideline.dose_rules
    .map(
      (r) =>
        `  - dose_rule_id "${r.dose_rule_id}"  (drug: ${r.drug}, ${r.mg_per_kg} mg/kg, route: ${r.route})`,
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// STEP A — severity classification prompts.
// ---------------------------------------------------------------------------

/**
 * The TRUSTED system prompt for severity classification. The model reads the
 * guideline's severity table and matches the confirmed findings to a row, then
 * names the dose_rule_id for that row from the ALLOWED set. Bounded + auditable.
 */
export function buildSeveritySystemPrompt(guideline: Guideline): string {
  return [
    "You are the EXECUTION stage of a clinical decision-support care-partner.",
    "The judgment (differential) is DONE and the clinician has confirmed the",
    "condition. Your ONLY job now is RULE-APPLICATION: read the guideline's",
    "severity criteria, match the confirmed findings to a severity ROW, and name",
    "the dose_rule_id for that row. This is reading a rubric, NOT forming a new",
    "clinical opinion and NOT re-diagnosing.",
    "",
    "HARD CONSTRAINTS (non-negotiable):",
    "  - You do NOT compute, state, or estimate any dose, volume, or cap. A",
    "    deterministic tool does ALL arithmetic AFTER you pick the rule. Never",
    "    output a number of mg or mL.",
    "  - You pick the dose_rule_id ONLY from this guideline's actual rules below.",
    "    Do NOT invent a rule id. If the findings genuinely fit no row, pick the",
    "    most conservative applicable first-line row and say so in reasoning.",
    "",
    "ALLOWED dose_rule_ids for this guideline (use VERBATIM):",
    allowedRuleIds(guideline),
    "",
    "SHOW THE WORKING: in `reasoning`, state which findings mapped to which",
    "severity row, quoting the guideline's severity wording. This is surfaced to",
    "the clinician as the audit of the judgment edge.",
    "",
    "THE GUIDELINE (curated, trusted) — read its SEVERITY section:",
    guideline.whole_document_text,
    "",
    "Return ONLY via the required structured output schema (severity_row,",
    "dose_rule_id, reasoning).",
  ].join("\n");
}

/**
 * The USER message for severity classification: the confirmed, structured facts
 * (NOT the raw note). Zero re-extraction — these facts are already confirmed.
 */
export function buildSeverityUserPrompt(caseState: CaseState): string {
  return [
    "Confirmed case facts (already extracted in turn 1 and confirmed by the",
    "clinician — do NOT re-extract, there is no raw note in this turn):",
    renderConfirmedFacts(caseState),
    "",
    "Match these findings to the guideline's severity table, then name the",
    "dose_rule_id for that severity row. Return the structured output.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// STEP B — plan synthesis prompts. The dose is ALREADY computed by the tool and
// handed in; the model writes a cited plan around it and fills required_fields.
// ---------------------------------------------------------------------------

/** A compact, model-facing view of the deterministic dose result for STEP B. */
export type ComputedDoseForPrompt = {
  drug: string;
  route: string;
  frequency: string;
  dose_mg: number;
  dose_ml: number | null;
  calculation_trace: string;
  capped: boolean;
  binding_limit: number | null;
};

function renderComputedDose(dose: ComputedDoseForPrompt): string {
  const lines = [
    `  - drug: ${dose.drug}`,
    `  - route: ${dose.route}`,
    `  - frequency: ${dose.frequency}`,
    `  - dose: ${dose.dose_mg} mg${dose.dose_ml !== null ? ` (${dose.dose_ml} mL)` : ""}`,
    `  - calculation_trace: ${dose.calculation_trace}`,
    `  - capped: ${dose.capped}${dose.capped && dose.binding_limit !== null ? ` (binding limit ${dose.binding_limit} mg)` : ""}`,
  ];
  return lines.join("\n");
}

/** The required-field slot names this guideline's plan must fill. */
function requiredFieldList(guideline: Guideline): string {
  return guideline.required_fields.fields.map((f) => `  - ${f}`).join("\n");
}

/**
 * The TRUSTED system prompt for plan synthesis. The model writes recommendations
 * that cite the guideline VERBATIM and fills required_fields FROM the guideline.
 * It does NOT recompute the dose (the tool's number is authoritative + given) and
 * does NOT invent content beyond the guideline text.
 */
export function buildPlanSystemPrompt(guideline: Guideline): string {
  return [
    "You are the EXECUTION stage of a clinical decision-support care-partner,",
    "synthesising the final plan. The dose has ALREADY been calculated by a",
    "deterministic tool and is given to you below — DO NOT recompute, change, or",
    "second-guess it. Use its exact numbers verbatim in your recommendations.",
    "",
    "GROUNDING (non-negotiable): every recommendation MUST be grounded in THIS",
    "guideline's text. For each recommendation provide:",
    "  - text: the clinician-facing recommendation.",
    "  - source_section, source_version, source_url: the guideline's citation",
    "    (use the values given below verbatim).",
    "  - quote: a VERBATIM span copied from the guideline text that supports the",
    "    recommendation. Do not paraphrase the quote; copy real guideline words.",
    "Never recommend anything not supported by the guideline text. Do not invent",
    "a guideline, a drug, a dose, or a citation.",
    "",
    "REQUIRED FIELDS: fill EVERY one of these slots from the guideline. For each,",
    "set present=true and value=<the real content from the guideline>. If the",
    "guideline genuinely does not cover a slot, set present=false and value=null",
    "(do NOT write 'not specified' as a value — an honest null lets the",
    "completeness gate catch the gap). Slots to fill:",
    requiredFieldList(guideline),
    "  Map them naturally: e.g. diagnosis = the confirmed condition; severity =",
    "  the classified row; drug/dose/route = the computed dose's fields;",
    "  escalation_criteria / disposition / positioning / monitoring = the matching",
    "  guideline sections, cited.",
    "",
    "GUIDELINE CITATION VALUES (use verbatim for source_* fields):",
    `  - source_section: ${guideline.dose_rules[0]?.source_section ?? guideline.condition}`,
    `  - source_version: ${guideline.dose_rules[0]?.source_version ?? ""}`,
    `  - source_url: ${guideline.dose_rules[0]?.source_url ?? ""}`,
    "",
    "THE GUIDELINE (curated, trusted) — cite from this text only:",
    guideline.whole_document_text,
    "",
    "Return ONLY via the required structured output schema (recommendations,",
    "required_fields).",
  ].join("\n");
}

/**
 * The USER message for plan synthesis: the confirmed facts + the deterministic
 * dose result. Again: structured confirmed state only, never the raw note.
 */
export function buildPlanUserPrompt(
  caseState: CaseState,
  severityRow: string,
  dose: ComputedDoseForPrompt,
): string {
  return [
    "Confirmed case facts (turn-1 + clinician confirmation; no raw note here):",
    renderConfirmedFacts(caseState),
    "",
    `Classified severity row: ${severityRow}`,
    "",
    "Deterministic dose result (computed by the tool — use these numbers verbatim,",
    "do NOT recompute):",
    renderComputedDose(dose),
    "",
    "Write the grounded plan: recommendations each citing the guideline verbatim,",
    "and fill every required_fields slot from the guideline. Return the structured",
    "output.",
  ].join("\n");
}
