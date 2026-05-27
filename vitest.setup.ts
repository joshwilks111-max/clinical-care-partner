// vitest.setup.ts
//
// Global test setup. Registers @testing-library/jest-dom's custom matchers
// (toBeInTheDocument, toHaveTextContent, toHaveClass, …) so the jsdom component
// suites (app/console/**) can assert on the DOM. The pure-node safety-spine
// suites import nothing from jsdom and are unaffected by these matchers.
import "@testing-library/jest-dom/vitest";

import { vi } from "vitest";

// next/font/google is a build-time transform that doesn't exist under raw
// Vitest — calling Inter()/Geist_Mono() at module load throws
// "Inter is not a function". Stub each named export the app currently uses
// (Inter + Geist_Mono today; add more here as the typography surface grows)
// so anything that imports app/layout.tsx — e.g. the bluey-shell regression
// test that asserts metadata.title — works without a per-file mock.
const fontStub = () => ({
  variable: "--font-stub",
  className: "font-stub",
  style: { fontFamily: "stub" },
});
vi.mock("next/font/google", () => ({
  Inter: fontStub,
  Geist: fontStub,
  Geist_Mono: fontStub,
}));
