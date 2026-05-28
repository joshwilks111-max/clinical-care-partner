# Refusal taxonomy

Each `RefusalKind` is a closed-union value. Surface the kind verbatim, then a one-line plain-English gloss, then a safe next action. Do not invent kinds, do not compute an alternative.

## weight_missing
**When**: the clinical note has no weight, and the user (clinician) either was not asked or declined to provide one.
**Why it's typed**: weight-based paediatric dosing is unsafe without a documented weight (ISMP 2025-26 Targeted Medication Safety BP).
**Safe next action**: ask for weight; if escalation is needed, fall back to a paper protocol or call pharmacy.

## implausible_weight
**When**: weight was provided but falls outside clinically plausible bounds for the stated age (e.g. "14200" for a 3 yo — looks like a g/kg unit error).
**Why it's typed**: a 100× dose-magnitude error is a leading paediatric mortality vector; the calculator refuses rather than amplify a likely unit error.
**Safe next action**: ask for confirmation in kilograms; clinician owns the resolution.

## invalid_dose_rule_id
**When**: the `dose_rule_id` does not match a rule in the loaded guideline.
**Why it's typed**: defensive — guards against the skill picking a rule that drifted between `load_guideline` and `calculate_dose`.
**Safe next action**: re-run the workflow from Phase 3 (Retrieve).

## rule_not_verified
**When**: the guideline returned but its freshness check failed (publication date stale, review overdue, source unreachable for verification).
**Why it's typed**: NHS DCB0129 explicitly flags currency of clinical reference data as a hazard category. Calculating from a possibly-stale rule without flagging it is a quiet safety violation.
**Safe next action**: clinician should consult the current local guideline directly; the skill abstains rather than serve stale evidence.

## airway_emergency
**When**: the patient picture is actively decompensating — drooling, tripod posturing, muffled voice with toxic appearance, hypoxia despite supportive measures, agitation-trending-lethargy.
**Why it's typed**: in a true airway emergency, steroid dosing is not the right next action. Escalation is. Routing this to a "please clarify the diagnosis" UI would actively waste time.
**Safe next action**: escalate per local airway-emergency protocol; no airway manipulation; senior airway support; prepare for gas induction.

## unresolved_dangers
**When**: the patient is currently stable but two or more must-not-miss differentials remain unresolved (the note's features fit two or more conditions on the guideline's `differential_check`, with no signs of decompensation).
**Why it's typed**: distinct from `airway_emergency` because the right next action is clarification, not escalation.
**Safe next action**: clinician confirms the working diagnosis, or the skill calls `ask_user({kind:"condition"})` once.

## out_of_scope
**When**: the condition is not in the registry (e.g. asthma exacerbation, anaphylaxis when only croup is supported).
**Why it's typed**: the harness validator routes this to a "use the appropriate tool" UI rather than letting the skill hallucinate a guideline.
**Safe next action**: clinician uses the relevant condition-specific tool or guideline directly.
