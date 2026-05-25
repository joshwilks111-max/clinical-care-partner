// app/page.tsx
//
// The structured care-partner console (DESIGN.md "UI states", Task 8). This
// replaces the Task-4 placeholder shell. The page is a thin server component
// that mounts the interactive client console — the two-panel workspace where
// the judgment→execution architecture is a visible, persistent seam.

import { Console } from "./console/console";

export default function Home() {
  return <Console />;
}
