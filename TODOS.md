# TODOS — Heidi Take-Home (deliberately deferred, with build triggers)

Each is real and named on purpose — the deferred list IS the senior signal for a 4-day take-home.
Blast radius = a take-home demo, not a deployed clinical system. None is in v1 scope.

| # | Deferred item | Trigger to build | Effort (human/CC) | Priority |
|---|---|---|---|---|
| 1 | **Wrong-guideline auto-abstain guard** | Second clinician-facing pilot, or >5 guidelines | M / S | P2 (audit assertion already ships) |
| 2 | **Model-tier routing** (big model judgment / light model execution) | Real traffic + a cost signal | M / S | P3 |
| 3 | **Deterministic severity mapping** (encode severity criteria as typed rules) | Regulatory hardening / scale beyond demo | L / M | P3 |
| 4 | **Differential-collapse loop** (ambiguous note → discriminating question → narrow dx) — the active *investigate*-before-abstain loop; cf. KnowGuard (arXiv:2509.24816) | The real care-partner product | XL / L | P2 (the headline vision beat) |
| 5 | **LLM-as-judge eval (Layer 2)** clinically-framed applicability rubric | When faithfulness's blind spot needs measuring | M / S | P3 (hook left in tests/evals/; never gating) |
| 6 | **Live-consult transcription + real-time collapse** | The 6-month product, not a 4-day build | XL / L | P3 |
| 7 | **3rd guideline / non-dose skill** (e.g. interaction-check) | Proving the registry beyond dose calculators | S / S | P3 (registry proven; data-entry work) |
| 8 | **Scale retrieval** (live guideline service / data partnership / agentic retrieval over a large medical knowledge space; cf. KnowGuard's systematic knowledge-graph exploration, arXiv:2509.24816) | Corpus outgrows the context window | L / M | P3 |
| 9 | **Production privacy** (on-prem / no-PHI; GDPR/HIPAA) | Real patient data instead of synthetic notes | L / M | P3 (noted as a limitation) |
| 10 | **Mild "watch / observe" croup arm** (no-steroid management) — every croup path currently routes to a dose; the mild arm is observation/discharge with no drug. Needs a *disposition-only* plan shape (`drug`/`dose` nullable) + a completeness-gate exception for the observation arm. | Adding a non-dosing management arm to any guideline | M / S | P2 (clinician-flagged) |

## Notes
- Items 1, 4 are the strongest Loom "if I had another day" beats (1 = nastier-failure safety; 4 = the real product).
- **Item 10 (mild watch arm)** is independent clinician validation: an urgent-care doc (review, 2026-05-25) reconstructed the severity→treatment-arm ladder from the outside and named "watch, low-dose steroid, high-dose steroid, neb adrenaline + secondary care." The build already models the steroid-dose arms (moderate/severe) + escalation/disposition; only the mild *no-drug* arm is deferred (it needs a disposition-only plan shape, a different output *kind* from the dose arms). Deferred to hold v1 scope, not because it was missed.
- **Independent corroboration:** KnowGuard (Harvard Medical School / Zitnik lab, arXiv:2509.24816, under
  review) reached the same *investigate-before-abstain* paradigm this PoC was built around. Its
  knowledge-graph mechanism is precisely items 8 (scale retrieval) and 4 (active multi-round collapse) —
  i.e. the frontier paper *is* our deferred roadmap. We arrived here independently; the citation lives in
  `research/papers.md`. Note their absolute interaction figure differs from the abstract's *reduction* of
  7.27 turns — cite only the abstract's verbatim "−7.27 turns on average."
- The wrong-guideline AUDIT assertion (routed `guideline_id` matches confirmed condition) ships in v1; only the
  auto-abstain *behaviour* is deferred — so "deferred" reads as "demonstrated awareness," not "didn't notice."
- Full WHY for each is in `DESIGN.md` → "Deliberately deferred" and the decision record
  (`~/.claude/plans/async-twirling-pebble.md`).
