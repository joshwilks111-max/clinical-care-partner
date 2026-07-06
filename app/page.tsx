// app/page.tsx
//
// The submission landing page — served at the root. It walks the brief, tells
// the safety + region-routing + proof + build-journey story, and shows the full
// trace inline via a static walkthrough. A thin server component that mounts the
// interactive client landing (app/landing/landing-page.tsx). The live AI console
// (/demo, /api/chat) was retired; its code remains in git history.

import { LandingPage } from "./landing/landing-page";

export const metadata = {
  title: "Care Partner — a clinical AI you can trust on the number",
  description:
    "An AI care partner for paediatric croup that proves its dose, cites its source, and refuses to guess. NZ + AU. Built for the Heidi take-home.",
};

export default function Home() {
  return <LandingPage />;
}
