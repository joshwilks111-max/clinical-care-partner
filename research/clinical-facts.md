# research/clinical-facts.md — verified clinical numbers (primary source)

**This file is the single source of truth the registry pulls from.** The `DoseRule` JSON in
`registry/` encodes exactly these numbers; the `calculate_dose` tool reads them; the eval asserts
against them. Do NOT re-guess any number here — change it here first, with a source, then propagate.

Numbers below are locked in DESIGN.md ("Verified clinical numbers — do NOT re-guess"). Where a
primary-source URL could not be confirmed with certainty, the source is **named** and the URL is
flagged **[CONFIRM URL AT BUILD]** rather than invented.

---

## Croup — dexamethasone (Starship NZ guideline)

| Field | Value | Notes |
|---|---|---|
| Drug | dexamethasone | |
| First-line (mild–moderate) | **0.15 mg/kg** | single oral dose |
| Severe | **0.6 mg/kg** | |
| Max (hard cap) | **12 mg** | binding limit — fires visibly when raw exceeds it |
| Route | **oral only** | |
| Rounding | round **down** to **0.01 mg** | corticosteroid round-down intent, encoded as data (GUARD-8) |

**Worked — Jack T., 14.2 kg, moderate:**
`14.2 kg × 0.15 mg/kg = 2.13 mg` (under the 12 mg cap) → **2.13 mg**, oral.

**Worked — cap demo, 25 kg, severe:**
`25 kg × 0.6 mg/kg = 15 mg → CAPPED to 12 mg`. Assert `capped === true`, `binding_limit === 12`,
`dose_mg === 12`.

**Primary source:** Starship Children's Health (Te Whatu Ora / Starship NZ) — **Croup** clinical
guideline. Severity definitions used for the differential/severity rows: *moderate* = stridor at
rest, no cyanosis; *severe* = marked distress / cyanosis / lethargy.
URL: **[CONFIRM URL AT BUILD]** — Starship clinical-guidelines site (`starship.org.nz`), Croup page,
version-pinned. The committed registry entry stores `source_url` + `source_version`; both must
resolve to the live Starship Croup guideline section before the README ships.

---

## Anaphylaxis — adrenaline (ASCIA AU/NZ guideline)

| Field | Value | Notes |
|---|---|---|
| Drug | adrenaline (epinephrine) | |
| Dose | **0.01 mg/kg IM** | intramuscular |
| Max (hard cap) | **0.5 mg** | |
| Concentration | **1:1000 = 1.0 mg/mL** | drives the deterministic mg→mL conversion |
| Route | **IM** | |

**Worked — Jack T., 14.2 kg:**
`14.2 kg × 0.01 mg/kg = 0.142 mg` (under the 0.5 mg cap). At 1.0 mg/mL →
`0.142 mg ÷ 1.0 mg/mL = 0.142 mL → 0.14 mL`. Assert `dose_mg === 0.14`, `dose_ml === 0.14`, route IM.
(The volume conversion is deterministic via `concentration_mg_per_ml` — the LLM never converts units.)

> Note on the demo number: DESIGN.md fixes the demo assertions at `dose_mg === 0.14` and
> `dose_ml === 0.14` (rounded for the on-camera demo). The raw computed dose is 0.142 mg; the
> registry `rounding` field defines how it is presented. Keep the registry rounding rule and these
> assertions in lockstep — if rounding changes, update both here and the eval.

**Primary source:** ASCIA (Australasian Society of Clinical Immunology and Allergy) — AU/NZ
anaphylaxis / adrenaline guidance (the standard AU/NZ first-dose reference).
URL: **[CONFIRM URL AT BUILD]** — ASCIA site (`allergy.org.au`), anaphylaxis guidelines page,
version-pinned. The committed registry entry stores `source_url` + `source_version`; confirm both
resolve to the live ASCIA section before the README ships.

---

## Why two guidelines (not one)

Different **drug / route / cap / unit-conversion**: dexamethasone (oral, 12 mg cap, no volume
conversion) vs adrenaline (IM, 0.5 mg cap, mg→mL via concentration). Two distinct shapes prove a
reusable **harness**, not a croup-specific hack — a single condition can't be distinguished from a
hardcoded tool.

## Provenance discipline

- Every registry `DoseRule` carries `source_section`, `source_version`, `source_url`, and
  `human_verified`. `human_verified: false` **gates execution** (the tool refuses to run an
  unverified rule).
- Citations in the app are **clickable links to the real Starship/ASCIA section** — provenance is a
  visible seam, not an assertion.
- If any **[CONFIRM URL AT BUILD]** above cannot be resolved to a live primary-source section, do not
  ship a guessed URL: keep the source *name* + version and surface "URL pending verification" rather
  than fabricate a link. A wrong citation URL is a safety/trust defect in a clinical tool.
