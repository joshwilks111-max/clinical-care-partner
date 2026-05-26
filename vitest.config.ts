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
    ],
  },
});
