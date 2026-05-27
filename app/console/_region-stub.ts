// app/console/_region-stub.ts
//
// LOCAL STUB — provides the Region type + cookie read/write helpers Lane F
// needs to typecheck and run its component tests. This file is owned by
// Lane F (under app/console/) and is NOT the canonical region module.
//
// Lane C owns the real `lib/region.ts` — once that lands during Phase 3
// fan-in, the Lane F components below should be migrated to import from
// `@/lib/region` instead and this file deleted.
//
// The shape is intentionally narrow (Region union, getRegion, setRegion,
// clearSession) so the swap-over is mechanical. If Lane C ships a richer
// surface (e.g. region resolution from Accept-Language), the wider API
// lives over there — this stub stays the minimum the UI needs.
//
// Underscore-prefix so it's obvious in `ls app/console/` that this is a
// scaffolding file, not a real component or test.

export type Region = "NZ" | "AU";

const COOKIE_REGION = "care-partner-region";
const COOKIE_SESSION = "care-partner-session";
const DEFAULT_REGION: Region = "NZ";

/**
 * Client-side cookie read. Returns the chosen region from the cookie,
 * defaulting to NZ when absent or malformed. Defensive against the
 * cookie holding a value outside the union (older client, manual edit).
 */
export function getRegion(): Region {
  if (typeof document === "undefined") {
    return DEFAULT_REGION;
  }
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${COOKIE_REGION}=([^;]*)`),
  );
  const raw = match ? decodeURIComponent(match[1]) : "";
  return raw === "AU" ? "AU" : DEFAULT_REGION;
}

/**
 * Client-side cookie write. Writes both region (1y expiry) and DELETES
 * the session cookie (D16: region switch resets the chat).
 */
export function setRegion(region: Region): void {
  if (typeof document === "undefined") {
    return;
  }
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${COOKIE_REGION}=${encodeURIComponent(
    region,
  )}; path=/; max-age=${oneYear}; SameSite=Lax`;
  // D16 invariant — region change clears the originalNote pin.
  document.cookie = `${COOKIE_SESSION}=; path=/; max-age=0; SameSite=Lax`;
}

/**
 * Delete just the session cookie — the "+ New chat" hard reset path (D16).
 * Region is preserved.
 */
export function clearSession(): void {
  if (typeof document === "undefined") {
    return;
  }
  document.cookie = `${COOKIE_SESSION}=; path=/; max-age=0; SameSite=Lax`;
}
