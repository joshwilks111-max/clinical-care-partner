// vitest.setup.ts
//
// Global test setup. Registers @testing-library/jest-dom's custom matchers
// (toBeInTheDocument, toHaveTextContent, toHaveClass, …) so the jsdom component
// suites (app/console/**) can assert on the DOM. The pure-node safety-spine
// suites import nothing from jsdom and are unaffected by these matchers.
import "@testing-library/jest-dom/vitest";
