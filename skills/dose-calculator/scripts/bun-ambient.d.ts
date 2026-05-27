// skills/dose-calculator/scripts/bun-ambient.d.ts
//
// Ambient declarations so the harness's `npx tsc --noEmit` does NOT trip
// on the Bun-runtime CLI tails inside this directory's TypeScript files.
//
// These files (validate_dose_card.ts, lint_skill_output.ts) ship as a
// hybrid: a Bun-CLI when invoked directly via `bun run`, AND a
// re-importable Zod-schema module when consumed from the harness via
// `@skills/dose-calculator/scripts/validate_dose_card`. The CLI tails
// reference `Bun.file(...)` and `import.meta.main`, which are runtime-
// resolved by Bun but type-errors under Node's @types/node alone.
//
// This d.ts file is NOT part of the upstream skill workspace —
// it's a Phase-1 (P1.5/P1.6) harness-side adapter. Lane D's refresh
// workflow ("REFRESH skills/dose-calculator/* from ~/skills if newer")
// must preserve this file: it lives ONLY in the harness.
//
// Why not `npm i -D @types/bun`? That package's globals.d.ts redefines
// the global `fetch` type with Bun-specific properties (`preconnect`,
// `BunFetchRequestInit`), which breaks ~11 existing test files that
// mock `fetch` with `vi.fn(fetch)` — verified during P1.6. The targeted
// ambient declarations below give us just the two symbols we need
// without hijacking the global `fetch` shape.

declare const Bun: {
  file(path: string): {
    text(): Promise<string>;
  };
};

interface ImportMeta {
  /** Bun-only: true when this module is the entrypoint of `bun run <file>`. */
  main?: boolean;
}
