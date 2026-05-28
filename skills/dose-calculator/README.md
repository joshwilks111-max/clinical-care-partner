# dose-calculator

A portable clinical-decision-support skill for paediatric dose calculation, designed as a worked example of **governance-by-architecture**: every number a clinician sees is provably from a validated, versioned guideline rule, never from a model's prose. The skill turns an unstructured paediatric clinical note into a guideline-backed dose handoff **and** a longitudinal reassessment plan, with seven typed refusal kinds that read as a Hazard Log a Clinical Safety Officer can lift into a real DCB0129 Safety Case.

The architectural split is the substance: the **skill** owns the workflow shape (triage → diagnose → retrieve → calculate → reassess) and the abstention judgement. The **runtime** owns the numerics, the longitudinal branches, the citations, and the render. The skill never authors a number, a citation, a reassessment branch, or a watch-for sign — those flow only through the validated tool results, and a `.strict()` Zod schema (`scripts/validate_dose_card.ts`) enforces this mechanically. A regex lint script (`scripts/lint_skill_output.ts`) catches any digit-unit token in the prose. **Both are run as part of the eval grader; both are green for every one of the 17 cases in the eval suite.**

The skill is a transplantable artefact: any Claude-family runtime that implements the four-tool contract below loads this skill and gets the same clinician-facing behaviour. The harness changes; the skill outlives the harness.

## Scope (this version)

- **Conditions:** paediatric croup only.
- **Regions:** NZ and US, with a transparent nearest-region fallback path.
- **Drug class:** corticosteroids per the loaded guideline (dexamethasone / prednisolone).
- **Lifecycle:** initial dose + first reassessment window. Longer multi-turn clinical diarisation is a registry concern, not a skill rewrite.

Additional conditions are added by registering new entries in the harness's guideline registry (`data/guidelines/*.json`) — no change to `SKILL.md` is needed. That is what makes this a one-of-many architecture, not a one-off prompt.

## The tool contract the skill depends on

Four tools. The runtime implements them with these signatures and return shapes.

### `load_guideline(condition, region)`

```ts
{
  guideline_id: string;
  region: "NZ" | "US" | "AU" | "UK";        // open string in practice
  severity_rows: { label: string; description: string; applies_to_dose_rule_id: string }[];
  dose_rules: { id: string; drug: string; route: string; mg_per_kg: number; max_mg: number; source_version: string; source_url: string }[];
  source_version: string;
  source_url: string;
  fallback: boolean;
}
```

### `calculate_dose(guideline_id, dose_rule_id, weight_kg)`

```ts
{ status: "ok"; tool_call_id: string; dose_mg: number; dose_ml: number | null; max_mg: number; capped: boolean; drug: string; route: string; source_version: string; source_url: string; calculation_trace: string }
| { status: "refusal"; reason: RefusalKind; message: string }
```

### `get_reassessment_plan(guideline_id, initial_severity, dose_rule_id)`

```ts
{ status: "ok"; tool_call_id: string; reassess_in_minutes: number; watch_for: WatchForItem[]; next_branches: Branch[]; universal_rails: string[]; source_version: string; source_url: string; trace: string }
| { status: "refusal"; reason: "no_reassessment_required" | "rule_not_verified" | "invalid_severity_label" | "invalid_guideline_id" | "invalid_dose_rule_id" | "out_of_scope"; message: string }
```

See `HARNESS-BRIEF-get_reassessment_plan.md` in this directory for the full registry-side spec.

### `ask_user({kind, prompt})`

```ts
ask_user({ kind: "weight" | "condition" | "severity"; prompt: string }) => { answer: string }
```

Called at most once per session unless the previous answer was incomplete.

### `RefusalKind` (closed union)

`weight_missing`, `implausible_weight`, `invalid_dose_rule_id`, `rule_not_verified`, `airway_emergency`, `unresolved_dangers`, `out_of_scope`.

The union spans three sources — each reason is produced by exactly one of them:

- **`calculate_dose`** → `weight_missing`, `implausible_weight`, `invalid_dose_rule_id`, `rule_not_verified` (the calculator refusing bad inputs).
- **`load_guideline`** → `out_of_scope`, `region_unknown` (retrieval refusing an unmodelled condition or region — `region_unknown` not listed above as it is a retrieval-only reason).
- **Model prose abstention** → `airway_emergency`, `unresolved_dangers` (no tool returns these; the skill voices them directly as a clinical judgement — see SKILL.md invariants 3 & 4).

## The structured handoff

When the workflow succeeds, the skill emits two fenced JSON blocks alongside qualitative prose:

```dose-card
{
  "tool_call_id": "<id from calculate_dose>",
  "drug": "<from tool result>",
  "route": "<from tool result>",
  "severity_row": "<row label the skill matched>",
  "assessment": "<one-line clinical assessment>",
  "plan": "<one-line qualitative plan>"
}
```

```reassessment-card
{
  "tool_call_id": "<id from get_reassessment_plan>",
  "watch_for_summary": "<one-line summary of what to monitor>",
  "next_steps_summary": "<one-line summary of the conditional branches>"
}
```

**The skill writes no numerics into either block.** The harness validator looks up each `tool_call_id`, pulls `dose_mg`, `dose_ml`, `max_mg`, `reassess_in_minutes`, `watch_for`, `next_branches`, `universal_rails`, `source_version`, and `source_url` from the validated tool results, and renders the rendered cards from those values. Any number a clinician sees was produced by a tool, not by the model. The Zod schemas that enforce this are in `scripts/validate_dose_card.ts` and are intended to be imported by the harness validator so the skill and harness share one source of truth.

## Hazard Log entries this skill addresses

The table below is a Hazard Log — one of the artefacts required by NHS DCB0129's Clinical Risk Management process. **DCB0129 is the process, not the table**; a production deployment would also produce a Clinical Safety Case Report, a risk-scoring matrix (likelihood × severity, with residual risk after mitigation), and a deployer-side DCB0160 file naming the Clinical Safety Officer who owns the log. The skill side cannot produce those; what it can do is provide mechanically-checkable Hazard Log rows the harness's CSO can lift into a real Safety Case.

In that spirit, here are the Hazard Log entries this skill addresses, with the controls that enforce them:

| Hazard | Potential clinical impact | Mitigation | Control |
|---|---|---|---|
| Dose calculated without verified weight | 10×-100× under- or over-dose; paediatric mortality vector | Skill calls `ask_user` once; if no answer, `calculate_dose` returns `weight_missing` | ISMP 2025-26 Best Practice: weight verification for all weight-based meds. Mechanical: validator rejects emitted blocks lacking the prerequisite Phase 1 step. |
| Unit-entry slip (g instead of kg) producing 100× dose error | Fatal overdose | `calculate_dose` returns `implausible_weight` on bounds check | Closed-union refusal kind routed to a "confirm in kg" UI by the harness validator |
| Calculator used in lieu of escalation in airway emergency | Delayed definitive airway management; respiratory arrest | Skill refuses with `airway_emergency` and does not call `calculate_dose` | Direct refusal path; no `ask_user` form interposed (escalation is the right next action) |
| Dose calculated for wrong diagnosis (two or more conditions on the differential remain unresolved) | Inappropriate medication given; appropriate emergency action delayed | Skill refuses with `unresolved_dangers` for stable patients with ambiguous diagnosis | Differential check in Phase 2 against the guideline's `differential_check` field; closed-union routing on the harness side |
| Stale clinical evidence served as current | Practice has moved on; calculated dose is no longer guideline-aligned | `calculate_dose` and `get_reassessment_plan` both refuse with `rule_not_verified` if freshness check fails | Per-rule freshness metadata in the registry; freshness check is part of every tool call |
| Recommendation outside validated condition set | Hallucinated guideline content for unsupported condition | Skill refuses with `out_of_scope` from either retrieval tool | Closed condition registry; both `load_guideline` and `calculate_dose` return the same refusal shape |
| Model authors a dose number in prose, bypassing the validator | Hallucinated number reaches the clinician | Invariant 5 enforced two ways: (1) regex lint on the skill output, (2) Zod `.strict()` schema on the JSON blocks | `bun scripts/lint_skill_output.ts` + `bun scripts/validate_dose_card.ts` |

The control column is what makes this a Hazard Log entry rather than a wish list. Every row has a mechanical check.

## Portability — what each layer owns

| Concern | Skill owns | Runtime owns |
|---|---|---|
| Note triage / extraction | ✅ | |
| Differential reasoning / abstention | ✅ | |
| Severity-row matching | ✅ | |
| Choosing the `dose_rule_id` | ✅ | |
| Routing to `airway_emergency` vs `unresolved_dangers` | ✅ | |
| Choosing `initial_severity` for Phase 5 | ✅ | |
| Region selection | | ✅ (ambient context) |
| Guideline content | | ✅ (`load_guideline`) |
| Numeric dose calculation | | ✅ (`calculate_dose` only) |
| Reassessment timing + branches | | ✅ (`get_reassessment_plan` only) |
| Citation rendering | | ✅ (validator sources `source_version` / `source_url`) |
| Card UI render | | ✅ (validator → component) |
| Refusal routing | | ✅ (closed union dispatched on `reason`) |

## Heidi Evidence framing

This skill's citation model is deliberately aligned with Heidi Evidence's *Traceable Intelligence* pattern — *concise summaries with transparent citations and verbatim excerpts, allowing clinicians to verify every insight* ([Heidi Evidence launch, Feb 2026](https://www.heidihealth.com/en-gb/blog/heidi-launches-evidence)). The `source_version` and `source_url` fields travel through the tool result, get rendered as the citation chip on each card, and never get re-authored by the model. The skill is shaped to plug into that exact rendering pattern without modification.

## Regulatory framing — what this is NOT

This skill is not a regulated medical device. The Australian TGA has stated that AI clinical-decision-support tools producing autonomous dose recommendations are not exempt from medical device regulation. The skill's architecture — *the LLM never produces a number; a deterministic tool does, sourced from a versioned registry; the licensed clinician confirms before administration* — is the clean regulatory story. The clinician is the user. They confirm or reject every dose and every reassessment branch.

## The bundled artefacts

- `SKILL.md` — the workflow, the five invariants, the four-phase + reassess shape.
- `README.md` (this file) — the contract, the hazard log, the regulatory framing.
- `HARNESS-BRIEF-get_reassessment_plan.md` — registry-side spec the harness session implements.
- `references/croup-flowchart.md` — the croup management workflow as a state machine (shape only — the numbers live in the harness registry, because guidelines change).
- `references/refusal-taxonomy.md` — when to use each `RefusalKind`.
- `scripts/lint_skill_output.ts` — Bun-native regex guard for invariant 5.
- `scripts/validate_dose_card.ts` — Zod-strict schema check on both JSON blocks (importable by the harness).
- `evals/cases.jsonl` — 17 cases covering success, refusal, fallback, cap-firing, longitudinal follow-up, mid-flow weight correction, plus five adversarial cases (prompt injection, age-out-of-band, weight-in-pounds, conflicting weights, severity-asserted-vs-features).

## Eval suite

17 cases at iteration-2, **226 / 226 assertions passing**. One eval surface — the PowerShell grader in the workspace inlines the two Bun safety scripts and runs every assertion in one shot:

```sh
pwsh C:\Users\joshw\skills\dose-calculator-workspace\iteration-2\grader.ps1
```

The grader runs:
1. **`bun scripts/lint_skill_output.ts <output>`** — regex guard for digit-unit tokens in prose (invariant 5).
2. **`bun scripts/validate_dose_card.ts <output>`** — Zod `.strict()` schema check on both emitted JSON blocks.
3. **The full per-case assertion suite** from `evals/cases.jsonl` — prose contains/does-not-contain, dose-card field matches, must-not-call-tools negative assertions, refusal kind verbatim, tool sequence checks.

Both Bun scripts are also importable by the harness — the Zod schemas in `validate_dose_card.ts` are the single source of truth for what the skill emits, and the harness validator should import them rather than re-defining.

## Runtime that does NOT implement the validator

If a runtime loads this skill but has no validator for the fenced JSON blocks (e.g. a plain Claude Code session), the failure mode is graceful: the skill still emits both blocks, the user sees them as fenced code, the rendered dose card does not appear — but the safety property is preserved because the skill has authored no numeric in free prose. A clinician seeing only the structured JSON cannot misread a hallucinated dose, because there is no hallucinated dose.

The right way to surface validated numerics is to implement the validator (which is small — see `scripts/validate_dose_card.ts` for the schemas). The graceful-degrade path exists so a misconfigured runtime fails closed, not open.
