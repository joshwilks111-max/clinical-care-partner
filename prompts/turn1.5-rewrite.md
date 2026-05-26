# Turn 1.5 advisory prompt (rewrite draft)

Shipped implementation: `prompts/turn1.5.ts` (`buildTurn15SystemPrompt`, `buildTurn15UserPrompt`, dynamic `buildTurn15OutputSchema`).

## Role

Diagnostic-completeness assist — **not** a dose gate. One bounded model judgment before the clinician picks a dosing guideline:

- Should we ask **one** high-impact clarifying question about a must-not-miss condition?
- Which **treatable** condition + registry guideline do we recommend?

Turn 2 alone abstains on dose. Turn 1.5 returns `ask`, `ok`, `recorded`, or `error` — never abstention.

## Structured output schema (dynamic Zod)

Enums are built from the Turn 1 differential + `registry/guidelines.ts` metadata:

| Field | Type | When |
|---|---|---|
| `needs_question` | `boolean` | Always |
| `target_condition` | must-not-miss name from differential | Required when `needs_question: true` |
| `question` | string, ends with `?`, no markdown | Required when `needs_question: true` |
| `recommended_condition` | treatable condition from differential | Always |
| `recommended_guideline` | registry id | Always; must pair with `recommended_condition` |
| `rationale_summary` | string, max 200 chars | Always; audit-facing, no chain-of-thought |

Post-parse pair-check: `recommended_guideline ∈ registry[recommended_condition].applicable_guidelines`.

## Anti-anchoring

System prompt instructs: pick the must-not-miss whose answer **rules out the most danger** for *this* differential — do not default to the same target across cases. Eval variance case asserts target varies by fixture.

## Examples (contract intent)

**`needs_question: true`** — Croup likely + Epiglottitis must-not-miss with negative evidence for drooling/tripod/muffled voice but not fully ruled out clinically:

```json
{
  "needs_question": true,
  "target_condition": "Epiglottitis",
  "question": "Is the child drooling, sitting in a tripod posture, or showing a muffled voice?",
  "recommended_condition": "Croup",
  "recommended_guideline": "starship-croup-2020",
  "rationale_summary": "One high-impact question before dosing croup."
}
```

**`needs_question: false`** — Every must-not-miss already ruled out by documented negative evidence:

```json
{
  "needs_question": false,
  "recommended_condition": "Croup",
  "recommended_guideline": "starship-croup-2020",
  "rationale_summary": "Must-not-miss alternatives already absent in note; dose-ready for croup."
}
```

## Token budget

- Target: **≤ 8k tokens** total (system + user) per decide call; informational, not a merge gate.
- Static system prefix should be **≥ 1024-aligned** for provider caching where applicable.
- Measure with: `npx tsx scripts/measure-prompt-tokens.ts`

## Live traces

Run: `npx tsx scripts/draft-turn15-trace.ts`  
Results: `prompts/turn1.5-rewrite.traces.md`
