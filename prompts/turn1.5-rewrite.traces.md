# Turn 1.5 rewrite — live traces

Generated: 2026-05-26T08:45:15.669Z

## Fixture a — Canonical Jack T. croup (14.2 kg moderate)

- parse_ok: true
- validation: ok
- usage: input=1326 output=106

```json
{
  "needs_question": false,
  "recommended_condition": "Croup",
  "recommended_guideline": "starship-croup-2020",
  "rationale_summary": "Classic croup features present; all three epiglottitis discriminators (drooling, tripod, muffled voice) documented absent — must-not-miss adequately excluded."
}
```

## Fixture b — Session croup note (collapse eval shape)

- parse_ok: true
- validation: ok
- usage: input=1327 output=147

```json
{
  "needs_question": true,
  "target_condition": "Epiglottitis",
  "question": "Is the child drooling, sitting in a tripod posture, or showing a muffled voice?",
  "recommended_condition": "Croup",
  "recommended_guideline": "starship-croup-2020",
  "rationale_summary": "Croup features present; epiglottitis discriminators undocumented rather than confirmed absent. One question clarifies must-not-miss before dosing."
}
```

## Fixture c — Cap demo — 25 kg severe croup

- parse_ok: true
- validation: ok
- usage: input=1324 output=155

```json
{
  "needs_question": true,
  "target_condition": "Epiglottitis",
  "question": "Is the child drooling, sitting in a tripod posture, or showing a muffled voice?",
  "recommended_condition": "Croup",
  "recommended_guideline": "starship-croup-2020",
  "rationale_summary": "Severe stridor fits croup; epiglottitis discriminators (drooling/tripod/muffled voice) undocumented rather than excluded — clarify before dosing."
}
```

## Fixture d — Clean differential — must-not-miss ruled out (expect needs_question: false)

- parse_ok: true
- validation: ok
- usage: input=1334 output=105

```json
{
  "needs_question": false,
  "recommended_condition": "Croup",
  "recommended_guideline": "starship-croup-2020",
  "rationale_summary": "Epiglottitis discriminators (drooling, tripod, muffled voice, toxic) all absent; classic croup features present. Proceed with croup guideline."
}
```

---

## Annotations (T10 gate)

| Fixture | Sane target? | Useful question? | Correct pair? | `needs_question:false` when clean? |
|---|---|---|---|---|
| **a** Jack T. | N/A (no question) | N/A | Croup → `starship-croup-2020` ✓ | ✓ (model judged MNM ruled out by negatives) |
| **b** Collapse shape | Epiglottitis ✓ | Drooling/tripod/muffled voice ✓ | Croup → `starship-croup-2020` ✓ | — (expects ask) |
| **c** Cap 25 kg | Epiglottitis ✓ | Same discriminator triad ✓ | Croup → `starship-croup-2020` ✓ | — (expects ask; severe croup) |
| **d** Clean | N/A | N/A | Croup → `starship-croup-2020` ✓ | ✓ |

**Token measurement** (`npx tsx scripts/measure-prompt-tokens.ts`): 862 input tokens, ≤8k PASS, system prefix ≥1024 chars PASS.

**Note:** Fixture (a) vs (b) differ only in negative-evidence wording — model asks in (b) where epiglottitis features are "undocumented" vs explicitly absent in (d). This is acceptable advisory variance; Turn 2 remains the dose gate (case10 abstains at Turn 2 after `present` answer).
