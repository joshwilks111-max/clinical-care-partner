// app/page.tsx
//
// The submission landing page — served at the root (joshw-heidi-interview.space/).
// It walks the brief, tells the safety + region-routing + proof + build-journey
// story, and sends the reviewer into the live console at /demo. A thin server
// component that mounts the interactive client landing (app/landing/landing-page.tsx).
// The console itself now lives at /demo.

import { LandingPage } from "./landing/landing-page";

export default function Home() {
  return <LandingPage />;
}
