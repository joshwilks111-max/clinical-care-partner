# TODOS — Heidi Take-Home (deliberately deferred, with build triggers)

Each is real and named on purpose — the deferred list IS the senior signal for a 4-day take-home.
Blast radius = a take-home demo, not a deployed clinical system. None is in v1 scope.

| # | Deferred item | Trigger to build | Effort (human/CC) | Priority |
|---|---|---|---|---|
| 1 | **Wrong-guideline auto-abstain guard** | Second clinician-facing pilot, or >5 guidelines | M / S | P2 (audit assertion already ships) |
| 2 | **Model-tier routing** (big model judgment / light model execution) | Real traffic + a cost signal | M / S | P3 |
| 3 | **Deterministic severity mapping** (encode severity criteria as typed rules) | Regulatory hardening / scale beyond demo | L / M | P3 |
| 4 | **Differential-collapse loop** (ambiguous note → discriminating question → narrow dx) | The real care-partner product | XL / L | P2 (the headline vision beat) |
| 5 | **LLM-as-judge eval (Layer 2)** clinically-framed applicability rubric | When faithfulness's blind spot needs measuring | M / S | P3 (hook left in tests/evals/; never gating) |
| 6 | **Live-consult transcription + real-time collapse** | The 6-month product, not a 4-day build | XL / L | P3 |
| 7 | **3rd guideline / non-dose skill** (e.g. interaction-check) | Proving the registry beyond dose calculators | S / S | P3 (registry proven; data-entry work) |
| 8 | **Scale retrieval** (live guideline service / data partnership / agentic retrieval) | Corpus outgrows the context window | L / M | P3 |
| 9 | **Production privacy** (on-prem / no-PHI; GDPR/HIPAA) | Real patient data instead of synthetic notes | L / M | P3 (noted as a limitation) |

## Notes
- Items 1, 4 are the strongest Loom "if I had another day" beats (1 = nastier-failure safety; 4 = the real product).
- The wrong-guideline AUDIT assertion (routed `guideline_id` matches confirmed condition) ships in v1; only the
  auto-abstain *behaviour* is deferred — so "deferred" reads as "demonstrated awareness," not "didn't notice."
- Full WHY for each is in `DESIGN.md` → "Deliberately deferred" and the decision record
  (`~/.claude/plans/async-twirling-pebble.md`).
