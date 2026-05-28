# Croup — workflow shape

Read this when you need to reason about how the croup workflow flows from initial assessment to reassessment. The **clinical content** — severity rows, dose rules, must-not-miss differentials, universal rails, reassessment windows — lives in the harness's guideline registry and flows through the tool results. This file describes only the **shape of the workflow**, because that shape is what the skill owns and what survives the next guideline publication.

## The workflow is a state machine

Croup management is not a single-shot calculation. It is treat → reassess → re-classify → re-route. The current PoC scope models the entry-point decision (note → initial severity → initial dose) and the immediate reassessment window. Full longitudinal diarisation across the multi-hour clinical course is a later registry concern.

## Phase 3 — initial severity matching

Read the `severity_rows` returned by `load_guideline`. Each row has a `label` (e.g. mild, moderate, severe) and a clinical `description`. Match the patient's presentation to a row by comparing the note's findings against the row description. The matched row's `applies_to_dose_rule_id` is what feeds Phase 4.

## Phase 4 — calculate the dose

`calculate_dose(guideline_id, dose_rule_id, weight_kg)` returns the numeric result keyed by a `tool_call_id`. The skill emits the dose-card JSON block referencing that id; the harness validator pulls the numerics from the validated tool result and renders the rendered card.

## Phase 5 — the reassessment branches

`get_reassessment_plan(guideline_id, initial_severity, dose_rule_id)` returns:
- `reassess_in_minutes` — when to look again, per the registry
- `watch_for` — what clinical signs the clinician should monitor
- `next_branches` — for each possible reassessment-severity, what action follows (discharge, continue review, admit, escalate)
- `universal_rails` — rules that apply across every branch (e.g. "escalate at any point if required")

The skill emits the reassessment-card JSON block referencing the tool_call_id. The harness pulls the structured fields and renders the rendered card.

## The differential check

`load_guideline` also returns a `differential_check` field describing the must-not-miss conditions that overlap with the loaded condition. The skill reads it during Phase 2. If the note contains features pointing strongly to two or more of those conditions, the skill abstains — `airway_emergency` for a decompensating patient, `unresolved_dangers` for a stable patient with ambiguous diagnosis.

## What the skill never authors

- The severity row descriptions (registry).
- The dose rule's mg/kg, max-mg, route (registry, returned via `calculate_dose`).
- The reassessment window, the watch-for signs, the next-branch table, the universal rails (registry, returned via `get_reassessment_plan`).
- The differential check content (registry).
- Citation strings (`source_version`, `source_url` flow through tool results).

This is the architectural promise: the workflow shape is the skill's; the clinical facts are the registry's. When the guideline publishes its next version, the skill markdown stays byte-identical.
