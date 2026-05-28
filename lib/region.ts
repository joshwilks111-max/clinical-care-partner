// lib/region.ts
//
// REGION COOKIE HELPER — read/write the per-session jurisdiction flag.
//
// The Care Partner ships two committed guideline regions (NZ and AU per D6).
// The selected region is the user's clinical setting; it MUST be sticky across
// turns of a single chat session, and a missing/malformed cookie MUST default
// to NZ (the home jurisdiction the brief targets — not "fail closed", because
// failing closed here means refusing to answer, which is worse UX than
// answering for the home region).
//
// DESIGN DECISIONS:
//   * The COOKIE NAME is the public contract: `care-partner-region`. Lane F's
//     <RegionToggle> writes it client-side via Set-Cookie; the harness route
//     reads it via Next's cookies(). Same name on both sides — no env-var
//     indirection.
//   * Valid values are the literal strings "NZ" | "AU". A wider region
//     enum (UK, CA, …) is a contract change — extend the Zod enum here,
//     update the registry, and add another guideline file. Don't accept
//     a wider set silently.
//   * We accept anything STRUCTURALLY shaped like Next's cookies() return
//     value — `{ get(name): { value: string } | undefined } | null` — so
//     this helper is decoupled from `next/headers` and unit-testable in
//     pure Node. Next's real ReadonlyRequestCookies satisfies the shape.
//   * `getRegion` NEVER throws. A null cookies object, a missing cookie,
//     and a malformed value all funnel to "NZ". The harness must always
//     have a region in hand — there is no "unknown region" branch.
//
// WHY NZ DEFAULT (and not "ask the clinician"):
//   The brief is NZ-first; the live demo URL is .vercel.app served from a
//   New-Zealand-resident reviewer. A first-visit clinician who never opens
//   the region toggle still gets a sensible answer. The toggle is visible
//   in the chat footer (Lane F) so opting out of the default is one click.

import { z } from "zod";

/**
 * The committed-region closed set. Adding a third region without adding a
 * matching guideline in registry/guidelines.ts is a build error by design:
 * the loader will fail at runtime when the model picks a guideline tagged
 * with a region this enum doesn't list.
 */
export const RegionSchema = z.enum(["NZ", "AU"]);
export type Region = z.infer<typeof RegionSchema>;

/**
 * The cookie name the toggle writes and the route reads. Exported so Lane F
 * can `import { REGION_COOKIE } from "@/lib/region"` instead of hard-coding
 * the string — one source of truth across server and client.
 */
export const REGION_COOKIE = "care-partner-region";

/** Home jurisdiction; surfaced on null cookie, missing cookie, malformed value. */
export const DEFAULT_REGION: Region = "NZ";

/**
 * The minimal structural shape `getRegion` needs from a cookie reader.
 * Compatible with Next's `cookies()` return (`ReadonlyRequestCookies`),
 * the `Request.cookies` API, and trivial test doubles like
 * `{ get: () => undefined }`.
 */
export type CookieReader = {
  get(name: string): { value: string } | undefined;
};

/**
 * Resolve the active region from a cookie reader.
 *
 * @param cookies - Anything with a `.get(name)` method (Next's `cookies()`
 *   result, or a hand-rolled stub in tests). `null`/`undefined` is treated
 *   as "no cookies at all" and returns the default — so the harness can
 *   pass `cookies()` in a synchronous context without a guard.
 * @returns The validated region, or `DEFAULT_REGION` ("NZ") if absent/invalid.
 */
export function getRegion(cookies: CookieReader | null | undefined): Region {
  if (!cookies) return DEFAULT_REGION;
  const raw = cookies.get(REGION_COOKIE)?.value;
  if (!raw) return DEFAULT_REGION;
  const parsed = RegionSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_REGION;
}

/**
 * Build the `Set-Cookie` header value for switching region. The route or
 * a server action consumes this and merges it into the outgoing response.
 *
 * We don't write the cookie directly here — that would couple this helper
 * to `next/headers` and break unit-testability. Instead we return the
 * header string; the caller (the route) is responsible for attaching it.
 *
 * Cookie settings:
 *   - Path=/         : visible everywhere in the app
 *   - SameSite=Lax   : sent on top-level navigation; not on cross-site POST
 *   - Max-Age=31536000 (1 year) : sticky across the demo session lifespan
 *
 * Validates the region first; throws on an unknown value. This is the one
 * place we want to fail loud — silently writing a malformed cookie would
 * just round-trip back as `DEFAULT_REGION` next read, hiding a real bug.
 */
export function setRegion(region: Region): string {
  // Re-validate at the boundary: a caller passing a string from user input
  // shouldn't be trusted by virtue of TypeScript alone.
  RegionSchema.parse(region);
  return `${REGION_COOKIE}=${region}; Path=/; SameSite=Lax; Max-Age=31536000`;
}
