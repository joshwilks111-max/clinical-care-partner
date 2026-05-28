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
      // Legacy console UI tests — coupled to the turn1/turn1.5/turn2 console
      // state machine that P3.5 replaces with the Heidi-grammar 3-column shell
      // + ChatPanel. These tests:
      //   - console.test.tsx              asserts "no chat composer exists" (negated by v3.1)
      //   - bluey-shell.regression.test.tsx  pins old grid widths + Bluey heeler branding
      //   - safety-check-card.test.tsx     drives the test by clicking legacy [data-demo-id]
      //                                    buttons on <Console />; once Console is rewritten,
      //                                    the driver breaks even though safety-check-card.tsx
      //                                    itself survives. Rewrite this test against the new
      //                                    Console after P3.5 (or scope to safety-check-card
      //                                    component in isolation).
      // All three are slated for delete (console + bluey + their fixtures) or rewrite
      // (safety-check-card) after Phase 3 step 11. Drop these excludes then.
      "app/console/console.test.tsx",
      "app/console/bluey-shell.regression.test.tsx",
      "app/console/safety-check-card.test.tsx",
      // P3-SDK rewrite — useChat + typed tool parts replace the custom
      // postChat + X-Validated-Response header + fence-parsing validator
      // architecture. Tests in these files assert on shapes (ChatMessage
      // union, AssistantContent.dose_card, X-Validated-Response header,
      // onFinish callback, fence-emitted-card Zod schemas) that no longer
      // exist after the rewrite. Re-add unit-test coverage against the
      // new UIMessage / part.type discriminator shapes in a follow-up;
      // until then the live curl smoke + real-Chrome verify are the gates.
      "app/api/chat/route.test.ts",
      "app/console/chat-panel.test.tsx",
      "lib/response-validator.test.ts",
      "skills/dose-calculator/contract.test.ts",
    ],
  },
});
