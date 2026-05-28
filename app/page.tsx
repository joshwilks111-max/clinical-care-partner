// app/page.tsx
//
// The submission landing page — served at the root (joshw-heidi-interview.space/).
// It walks the brief, tells the safety + region-routing + proof + build-journey
// story, and sends the reviewer into the live console at /demo. A thin server
// component that mounts the interactive client landing (app/landing/landing-page.tsx).
// The console itself now lives at /demo.

import { LandingPage } from "./landing/landing-page";

export const metadata = {
  title: "Care Partner — a clinical AI you can trust on the number",
  description:
    "An AI care partner for paediatric croup that proves its dose, cites its source, and refuses to guess. NZ + AU. Built for the Heidi take-home.",
};

export default function Home() {
  return <LandingPage />;
}
