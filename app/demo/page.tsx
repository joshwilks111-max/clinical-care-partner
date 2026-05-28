// app/demo/page.tsx
//
// The structured care-partner console (DESIGN.md "UI states"). The interactive
// two-panel workspace where the judgment→execution architecture is a visible,
// persistent seam. Lives at /demo; the landing page at / links here ("Open the
// demo"). A thin server component that mounts the interactive client console.

import { Console } from "../console/console";

export const metadata = {
  title: "Demo · Clinical care partner",
  description:
    "The live console. Paste a paediatric note or pick a demo case; watch the differential, the deterministic dose, and the citations render inline.",
};

export default function DemoPage() {
  return <Console />;
}
