# Next Steps

The architecture is a thin harness over a registry of deterministic skills. The dose pipeline is
one skill. What makes it a product — rather than a croup calculator — is that the harness doesn't
know what croup is. It dispatches. The next skill wedges into that same seam without touching
the dose pipeline.

---

## First skill to build: interaction-check

Drug–drug or drug–allergy check. The same evidence-citation pattern as the dose skills, small
enough to ship in one session.

The seam is a `SkillResult` discriminated union at the skill boundary:

```ts
type SkillResult =
  | { kind: "dose"; result: DoseOutput }
  | { kind: "interaction"; result: InteractionOutput }
  | { kind: "disposition"; result: DispositionOutput };
```

The harness dispatches, the skill returns whichever shape is appropriate, the UI renders it. No
forking the dose pipeline. No new route — same `api/turn2` handler, different registry skill.

The reason to start here: the interaction-check has the same evidence structure (a guideline
reference, a cited output, a completeness gate) and zero dose math — so it proves the registry
generalises beyond dosing without the complexity of a new calculation shape.

---

## Build trigger

When the second clinician asks for it. Not before.

---

## What's already deferred (TODOS.md carries the full list)

The two frontier-paper beats:

- **Active differential-collapse loop** (TODOS #4) — multi-round investigate-before-abstain over a
  knowledge graph. KnowGuard (arXiv:2509.24816, ICLR 2026) arrived at the same paradigm
  independently; their systematic knowledge-graph exploration is the scale path from the
  one-round collapse we ship. This is the "real product" beat, not a 4-day take-home build.
- **Scale retrieval** (TODOS #8) — once the guideline corpus outgrows the context window,
  the whole-document injection approach graduates to agentic retrieval. The architecture
  already names the seam (the `get_guideline` call in the deterministic router); the registry
  is the abstraction that makes the swap clean.

Both are conscious deferrals, not oversights. The design judgment under test was what NOT to build
in four days. The deferred list is the evidence.
