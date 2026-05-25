import { defineConfig } from "vitest/config";

// Vitest config for the Clinical Care-Partner.
// - environment "node": the priority suites (registry/*, tools/*, lib/*) are
//   pure-node deterministic logic — the safety spine. No DOM needed.
//   Later UI/component tests that need the DOM can opt in per-file with the
//   `// @vitest-environment jsdom` pragma (install jsdom + a React plugin when
//   that lands).
// - resolve.tsconfigPaths wires the `@/*` import alias (from tsconfig.json) so
//   tests import exactly like app code, no plugin required (Vite 6+ native).
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
