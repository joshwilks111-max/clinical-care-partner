# Harness brief — implement the `get_reassessment_plan` tool

**For:** the harness-build session (Next.js 16 + Vercel AI SDK 6 + Bun + Zod take-home repo).
**From:** the dose-calculator skill session.
**Status:** skill side is locked at iteration-2 and assumes this tool exists. Build it to this spec verbatim — if you can't, raise on this brief, don't invent.

> **Companion contract addition (2026-05-28 cleanup):** `load_guideline` also needs to return a `differential_check` field — see the bottom of this brief for the shape. The skill now reads `severity_rows[].description` for severity matching and `differential_check` for the must-not-miss differentials, rather than carrying that clinical content in its own prose. This is so the skill doesn't have to be re-written when the registry's clinical content changes.

---

## What this tool exists for

The dose-calculator skill has four phases:

1. **Triage** — extract age, weight, vitals from the note.
2. **Diagnose** — pick a condition from the registry.
3. **Retrieve** — `load_guideline(condition, region)` returns severity rows + dose rules.
4. **Calculate & present** — `calculate_dose(guideline_id, dose_rule_id, weight_kg)` returns the dose.

Iteration-2 adds a fifth phase:

5. **Reassess** — `get_reassessment_plan(guideline_id, initial_severity, dose_rule_id)` returns the longitudinal "what to do next, when, and what to watch for" plan.

This is the **AI Care Partner** shape — Heidi's own marketing language for the longitudinal product. The Starship croup flowchart is a state machine, not a single-shot calculation: treat → reassess at 2 h (mild/moderate) or 4 h (severe) → re-classify → re-route. Phase 5 surfaces that state machine to the clinician via a structured handoff card.

The tool gives the skill the same shape as `load_guideline`: it's a retrieval, not a computation. The data comes from the guideline JSON file; the tool returns whatever the registry says. The LLM does not author the reassessment window or the branches.

---

## Tool signature

```ts
function get_reassessment_plan(
  guideline_id: string,                          // e.g. "starship-croup-2020"
  initial_severity: string,                      // the severity_row.label that justified the dose, e.g. "moderate"
  dose_rule_id: string                           // for traceability + the freshness check
): Promise<ReassessmentPlanResult>;
```

### Return shape

```ts
type ReassessmentPlanResult =
  | {
      status: "ok";
      tool_call_id: string;                      // harness-generated, ^[a-zA-Z0-9_-]{8,32}$
      guideline_id: string;
      initial_severity: string;
      reassess_in_minutes: number;               // e.g. 120 (mild/moderate) or 240 (severe) for croup
      watch_for: WatchForItem[];                 // signs the clinician should monitor
      next_branches: Branch[];                   // conditional next steps keyed by reassessment severity
      universal_rails: string[];                 // "Escalate at any point if required" etc.
      source_version: string;                    // mirrors the load_guideline citation
      source_url: string;
      trace: string;                             // human-readable derivation
    }
  | {
      status: "refusal";
      reason:
        | "invalid_guideline_id"                 // unknown id
        | "invalid_dose_rule_id"
        | "invalid_severity_label"               // initial_severity not in the guideline's severity_rows
        | "rule_not_verified"                    // guideline freshness check failed
        | "out_of_scope"                         // condition has no reassessment plan modelled yet
        | "no_reassessment_required";            // some rules legitimately don't need follow-up
      message: string;
    };

type WatchForItem = {
  sign: string;                                  // e.g. "Persistent stridor at rest"
  severity_implication: string;                  // e.g. "Indicates ongoing moderate croup"
};

type Branch = {
  if_severity_at_reassessment: string;           // e.g. "mild" — matches a severity_row.label
  action: string;                                // qualitative: "Discharge"; "Admit under general paediatrics"; "Give nebulised adrenaline as required"
  setting: "discharge" | "ward" | "short_stay" | "icu" | "continue_current";
  escalate_to: string | null;                    // e.g. "PICU consult" — null if no escalation implied
  notes: string;                                 // any branch-specific clarifications
};
```

---

## Why these fields specifically

- **`reassess_in_minutes`** — the Starship flowchart is explicit: 2 h reassessment for mild/moderate post-dexamethasone, 4 h for severe (with adrenaline). The number IS the guideline data; the tool returns it, the harness renders it. Skill never authors a number, same invariant as the dose-card.
- **`watch_for`** — separates "what to monitor" from "what to do" so the harness UI can render two lists. The PromptHub case study explicitly cites batch testing for clinical reasoning chains — having `watch_for` as structured data makes evals possible (e.g., "for croup-moderate, the plan MUST include 'stridor at rest' as a watch-for sign").
- **`next_branches`** — the conditional dispatch table from the flowchart. The skill picks the severity label (or asks the clinician to confirm); the harness renders branch buttons. Branches are a closed list per rule, sourced from the guideline.
- **`universal_rails`** — the Starship flowchart's rail items ("Escalate at any point if required", "Moderate or severe croup is NOT discharged at night"). These are per-guideline, not per-branch. Render them as a persistent banner.
- **`tool_call_id`** — same `^[a-zA-Z0-9_-]{8,32}$` regex as `calculate_dose`'s id. The skill threads it into the emitted `reassessment-card` JSON block; the harness validator looks it up.
- **`source_version` + `source_url`** — mirror `calculate_dose`. The same Heidi-Evidence-style citation chip carries through to the reassessment card. Clinician sees one citation, not two competing ones.

---

## What the skill emits (the contract back to you)

When `get_reassessment_plan` returns `status: "ok"`, the skill appends a second fenced JSON block alongside the dose-card:

\`\`\`reassessment-card
{
  "tool_call_id": "<the get_reassessment_plan call id>",
  "watch_for_summary": "<the skill's one-line summary of what to monitor>",
  "next_steps_summary": "<the skill's one-line summary of the branch logic>"
}
\`\`\`

The Zod schema for what the skill emits is locked at `scripts/validate_dose_card.ts` in this directory:

```ts
export const ReassessmentCardEmittedSchema = z
  .object({
    tool_call_id: z.string().regex(/^[a-zA-Z0-9_-]{8,32}$/),
    watch_for_summary: z.string().min(1),
    next_steps_summary: z.string().min(1),
  })
  .strict();
```

**Import this schema directly into the harness validator** — do not redefine. One source of truth, no drift. The `.strict()` is load-bearing: any extra key (including any numeric the model tries to slip in) fails validation.

The harness validator looks up `tool_call_id`, pulls `reassess_in_minutes`, `watch_for`, `next_branches`, `universal_rails`, `source_version`, `source_url` from the tool result, and renders the final reassessment card. The skill never authors a number, a branch, a watch-for sign, or a citation. Same architecture as the dose-card; same safety property.

---

## Registry-side: what the guideline JSON needs to carry

The tool reads from `data/guidelines/<guideline-id>.json`. To support reassessment, each guideline file gets a new top-level field:

```ts
// data/guidelines/starship-croup-2020.json — proposed addition
{
  // ... existing fields (severity_rows, dose_rules, source_version, source_url) ...
  "reassessment_plans": [
    {
      "id": "croup-reassess-mild-moderate",
      "applies_to_initial_severity": ["mild", "moderate"],
      "applies_to_dose_rule_id": "croup-dex-mild OR croup-dex-moderate",   // matches either
      "reassess_in_minutes": 120,
      "watch_for": [
        { "sign": "Persistent inspiratory stridor at rest", "severity_implication": "Indicates ongoing moderate" },
        { "sign": "Increased work of breathing", "severity_implication": "Possible escalation to severe" },
        { "sign": "Hypoxia (SpO2 < 92%)", "severity_implication": "Severe — re-route" },
        { "sign": "Agitation or lethargy", "severity_implication": "Impending failure" }
      ],
      "next_branches": [
        { "if_severity_at_reassessment": "mild", "action": "Discharge", "setting": "discharge", "escalate_to": null, "notes": "Not at night for moderate-on-initial" },
        { "if_severity_at_reassessment": "moderate", "action": "Review for another 2 hours, then discharge or admit", "setting": "short_stay", "escalate_to": null, "notes": "" },
        { "if_severity_at_reassessment": "severe", "action": "Give nebulised adrenaline and re-treat as severe", "setting": "continue_current", "escalate_to": null, "notes": "" }
      ],
      "universal_rails": [
        "Escalate at any point if clinical state worsens",
        "Moderate or severe croup is not discharged at night"
      ]
    },
    {
      "id": "croup-reassess-severe",
      "applies_to_initial_severity": ["severe"],
      "applies_to_dose_rule_id": "croup-dex-severe",
      "reassess_in_minutes": 240,
      "watch_for": [
        { "sign": "Number of nebulised adrenaline doses given", "severity_implication": "≥3 doses triggers PICU consult" },
        { "sign": "Response to adrenaline (sustained vs rebound)", "severity_implication": "Rebound at 4 h suggests bacterial tracheitis" },
        { "sign": "SpO2 trajectory", "severity_implication": "Sustained hypoxia → impending failure" }
      ],
      "next_branches": [
        { "if_severity_at_reassessment": "mild", "action": "Discharge if low risk AND mild symptoms 4 h post-second-adrenaline", "setting": "discharge", "escalate_to": null, "notes": "" },
        { "if_severity_at_reassessment": "moderate", "action": "Clinical short stay or admission depending on trajectory", "setting": "short_stay", "escalate_to": null, "notes": "" },
        { "if_severity_at_reassessment": "severe", "action": "Nebulised adrenaline as required; escalate per dose count", "setting": "ward", "escalate_to": "PICU consult at 3 doses; HDU/PICU at 4+", "notes": "" }
      ],
      "universal_rails": [
        "Escalate at any point if required",
        "IV access attempts may precipitate respiratory arrest — strongly consider gas induction if intubation required"
      ]
    }
  ]
}
```

Source: Starship NZ croup guideline (published 2020-08-04, review every 2 years) and the Starship management flowchart image (verified 2026-05-24, in `references/croup-flowchart.md` in this directory). Numbers and branch logic are the guideline's, not authored.

---

## Selection logic

The tool's job is to find the right `reassessment_plan` entry for the given `(guideline_id, initial_severity, dose_rule_id)`:

1. Look up `guideline_id` → if not found, return `{status: "refusal", reason: "invalid_guideline_id"}`.
2. Run the freshness check (publication date + review period from the guideline file). If stale, return `{status: "refusal", reason: "rule_not_verified"}`.
3. Find the `reassessment_plan` where `applies_to_initial_severity` includes `initial_severity` AND `applies_to_dose_rule_id` includes `dose_rule_id`.
4. If not found because `initial_severity` is not in the guideline's `severity_rows`, return `{status: "refusal", reason: "invalid_severity_label"}`.
5. If not found because no reassessment plan is modelled for this (severity, rule) combination, return `{status: "refusal", reason: "no_reassessment_required"}`. NB: this is a valid clinical state, not an error — a one-shot drug with no follow-up is a legitimate case.
6. Return the matched plan in the success shape.

---

## Same `out_of_scope` rule as lock #6 from yesterday

If the harness wires `get_reassessment_plan` for an unknown condition (e.g. someone calls with `guideline_id: "unknown-asthma-guideline"`), it must return `{status: "refusal", reason: "out_of_scope", message: string}` — mirroring the existing `load_guideline` and `calculate_dose` behaviour. This keeps the skill's refusal-handling path uniform across all three retrieval tools.

---

## Anti-goals

- **Do not let the LLM compute `reassess_in_minutes` or any clinical branch.** The skill must abstain rather than guess if the tool refuses. No fallback authoring.
- **Do not duplicate fields from `load_guideline`.** The reassessment plan does not re-return the severity rows or the dose rules — those came from the prior tool call. Just return what's new.
- **Do not couple to a UI framework.** The tool returns structured data; the harness chooses how to render it (the locked decision is the two-panel console, but the tool should be UI-agnostic).
- **Do not add reassessment plans for conditions not in the registry.** Croup only for this iteration. Anaphylaxis, asthma, etc. come later via the same pattern.

---

## Eval cases to add

When the harness session adds `get_reassessment_plan`, the skill side already has these expected cases:

- **case-11 longitudinal-reassessment**: success path, moderate croup → dose-card + reassessment-card. Verifies the second tool fires and the second JSON block emits with valid schema.
- **case-9 rule_not_verified**: stale guideline → `get_reassessment_plan` returns refusal. Verifies the skill surfaces the refusal kind verbatim without emitting a reassessment-card.

Both are in `evals/cases.jsonl` after iteration-2; the harness session can read them as the contract for what its tool needs to support.

---

## Where to find the rest of the locked contract

- `claude-memory/heidi-interview-assignment/dose-calculator-skill-contract-locked` (in gbrain) — yesterday's seven locks.
- `SKILL.md` (this directory) — the four-phase workflow + safety invariants. Phase 5 is the new section; iteration-2 SKILL.md will reference this tool by name.
- `README.md` (this directory) — the portability claim and how the JSON blocks render.
- `scripts/validate_dose_card.ts` — both Zod schemas, the source of truth for what the skill emits. Import them.
- `evals/cases.jsonl` — twelve eval cases at iteration-2.

---

## Sign-off

When the tool is built, run from the harness root:

```sh
bun test  # the unit tests for get_reassessment_plan
bun ../skills/dose-calculator/scripts/validate_dose_card.ts <a sample skill output>  # round-trip check
```

Both green = the contract is honoured. Raise on this brief if anything is unclear; do not invent fields.

---

## Companion contract addition — `differential_check` on `load_guideline`

The skill no longer carries the must-not-miss differential list in its own prose (cleanup pass 2026-05-28 — the skill should not encode clinical facts that change when the guideline changes). Instead, `load_guideline` returns an additional field:

```ts
{
  // ... existing fields (severity_rows, dose_rules, source_version, source_url, fallback) ...
  differential_check: DifferentialItem[];
}

type DifferentialItem = {
  condition: string;              // e.g. "epiglottitis"
  distinguishing_features: string[]; // e.g. ["toxic appearance", "drooling", "tripod posturing", "muffled voice rather than barky cough", "no obvious URTI prodrome"]
  hazard_level: "must_not_miss" | "consider"; // must_not_miss conditions trigger abstention if two or more are unresolved
};
```

Source for croup registry: `references/croup-flowchart.md` previously listed these (epiglottitis, bacterial tracheitis, foreign body aspiration, anaphylactic airway oedema); the registry JSON entry for `starship-croup-2020` should carry them now, with `hazard_level: "must_not_miss"` on all four.

The skill reads `differential_check` in Phase 2 and abstains via `airway_emergency` or `unresolved_dangers` when two or more `must_not_miss` items have features present in the note. The harness's `load_guideline` mock should return the field consistently with the existing severity_rows structure.

## Companion contract addition — `severity_rows[].description` is the source of truth

The skill no longer uses its own prose to define what "mild" / "moderate" / "severe" mean for a given condition. It reads `severity_rows[].description` and matches the patient's note against that description. Make sure the description strings on each row are clinically precise — they are what the model uses to pick a row.

For Starship croup, the descriptions should mirror the Bjornson & Johnson modified CMAJ 2013 grading (recorded in `heidi-take-home-croup-clinical-facts` in gbrain), e.g.:
- mild: "stridor only on exertion; no rest stridor; minimal recession; alert and calm"
- moderate: "inspiratory stridor at rest; mild-to-moderate suprasternal or intercostal recession; alert, mildly distressed"
- severe: "persistent stridor; severe recession with accessory muscle use; agitation trending to lethargy; hypoxia"
- impending_respiratory_failure: "stridor may diminish (ominous); exhausted; obtunded; severe hypoxia or cyanosis"

These strings live in `data/guidelines/starship-croup-2020.json`, not in the skill.
