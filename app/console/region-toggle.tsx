// app/console/region-toggle.tsx
//
// Footer region picker. Switches between NZ and AU guidelines. Per D5:
// NZ defaults (Heidi's Starship 2020 guideline is the live one); AU is
// the explicit second region (Royal Children's Melbourne 2020 / NSW
// Health 2018).
//
// Behaviour invariants (D16):
//   - Switching region clears the chat session (DELETE session-id cookie).
//   - A confirm dialog fires BEFORE the switch — the audit trail is
//     "user explicitly chose to drop the current originalNote pin".
//   - On confirm: setRegion() writes the region cookie + clears the
//     session cookie; we then call window.location.reload() so the
//     server-rendered route picks up the new region on first request.
//
// State source: lib/region.ts (Lane C). Lane F imports from the local
// stub at ./_region-stub for v1; Phase 3 fan-in migrates this import
// to @/lib/region once Lane C lands.

"use client";

import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getRegion, setRegion, type Region } from "./_region-stub";

const REGIONS: Region[] = ["NZ", "AU"];

export interface RegionToggleProps {
  /**
   * Test seam — when provided, used INSTEAD of window.confirm. Lets the
   * unit test assert that switching triggers the confirm path without
   * stubbing the global. Production callers should omit this.
   */
  confirmFn?: (message: string) => boolean;
  /**
   * Test seam — when provided, used instead of window.location.reload.
   * Lets the unit test assert that confirmed-switch fires a reload
   * without actually reloading jsdom.
   */
  reloadFn?: () => void;
}

export function RegionToggle({ confirmFn, reloadFn }: RegionToggleProps = {}) {
  // Hydration-safe: render the default first, then read the cookie on mount.
  // Reading document.cookie during SSR is impossible; the !mounted flag
  // avoids a hydration mismatch warning for the first render.
  const [region, setLocalRegion] = useState<Region>("NZ");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setLocalRegion(getRegion());
    setMounted(true);
  }, []);

  function handleChange(next: string) {
    const nextRegion = (next === "AU" ? "AU" : "NZ") satisfies Region;
    if (nextRegion === region) {
      return;
    }
    const confirm = confirmFn ?? ((m: string) => window.confirm(m));
    const reload = reloadFn ?? (() => window.location.reload());
    const ok = confirm("Switch region? This clears the current chat.");
    if (!ok) {
      return;
    }
    setRegion(nextRegion);
    setLocalRegion(nextRegion);
    reload();
  }

  return (
    <Select value={mounted ? region : "NZ"} onValueChange={handleChange}>
      <SelectTrigger
        aria-label="Region"
        className="h-7 gap-1 border-[var(--cream-2)] bg-[var(--cream-2)] px-2 py-0 text-[11.5px] font-semibold text-foreground hover:bg-[var(--cream-2)]/80 focus-visible:ring-[var(--claret)] focus-visible:ring-offset-2"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {REGIONS.map((r) => (
          <SelectItem key={r} value={r}>
            {r}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
