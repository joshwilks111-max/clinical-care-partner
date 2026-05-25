// app/page.tsx
//
// The structured care-partner console (DESIGN.md "UI states"). This replaces the
// earlier placeholder shell. The page is a thin server component that mounts the
// interactive client console (app/console/console.tsx) — the two-panel workspace
// where the judgment→execution architecture is a visible, persistent seam.

import { Console } from "./console/console";

export default function Home() {
  return <Console />;
}
