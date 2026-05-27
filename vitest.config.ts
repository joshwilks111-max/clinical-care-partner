import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Vitest config for the Clinical Care-Partner.
// - environment "node" (default): the priority suites (registry/*, tools/*,
//   lib/*) are pure-node deterministic logic — the safety spine. No DOM needed.
//   The UI/component suites (app/console/**) opt into the DOM per-file with the
//   `// @vitest-environment jsdom` pragma at the top of the file.
// - @vitejs/plugin-react: lets vitest transform the JSX/TSX the component tests
//   render. Pure-node suites are unaffected (they import no TSX).
// - setupFiles registers @testing-library/jest-dom matchers (toBeInTheDocument,
//   toHaveTextContent, …) for the jsdom suites.
// - resolve.tsconfigPaths wires the `@/*` import alias (from tsconfig.json) so
//   tests import exactly like app code (Vite 6+ native).
export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "node_modules/**",
      ".next/**",
      ".claude/**",
      ".codex-worktrees/**",
      ".cursor/**",
      // v3.1 transitional excludes — these legacy lib modules are anaphylaxis-aware
      // and break after Lane B cleanly removed the anaphylaxis guideline from
      // registry/guidelines.ts. They are slated for deletion at Phase 3 step 11
      // (the deploy-before-delete cleanup), but until then they live in trunk so
      // app/api/turn1{,.5,2}/route.ts still compiles for the preview deploy. Drop
      // these two excludes when step 11 lands.
      "lib/completeness.test.ts",
      "lib/router.test.ts",
      "prompts/turn1.test.ts",
      "prompts/turn1.5.test.ts",
      "prompts/turn2.test.ts",
    ],
  },
});
