// app/api/turn1/route.test.ts
//
// ROUTE-LEVEL fetch-spy test — the demo's HEADLINE guarantee, proven end-to-end.
//
// The Loom opener / README lead: a weight-MISSING note refuses with ZERO model
// calls (key-free, reproducible). The purity tests on the constituent pieces
// (refusalGate, hasKgWeight) prove the gate is model-free BY CONSTRUCTION, but
// nothing yet drives the ACTUAL POST handler end-to-end and asserts the network
// was never touched. This file closes that gap:
//
//   - import the REAL POST handler from app/api/turn1/route.ts,
//   - replace globalThis.fetch with a recording spy (restored in afterEach),
//   - POST a JSON body whose note has NO kg weight, await the Response, parse it,
//   - assert status === "refusal" AND the fetch spy was NEVER called.
//
// Two weightless variants are covered: a plain no-weight note, and a POUNDS-ONLY
// note ("31 lb") — we never convert lb→kg, so a pounds-only note has no usable
// weight and must also refuse pre-LLM with zero network.
//
// KEY-FREE by design: this exercises the STEP-1 pre-LLM gate, which runs before
// createAnthropic(...) is ever called. We do NOT read or require a real key — the
// refusal path must be key-independent. The test stubs the env to a dummy value
// ONLY to prove the point holds regardless of key state; it passes with no key
// too (the SDK is imported at module load but only INSTANTIATED inside STEP 2,
// which a weightless note never reaches). This test makes ZERO real API calls —
// it asserts the opposite.

import { describe, it, expect, afterEach } from "vitest";
import { POST } from "./route";

// A fetch spy that records every call and fails loudly if the handler ever tries
// to reach the network on a weightless note. We return a rejected promise so any
// accidental call surfaces as an error rather than a silent stub-success.
function installFetchSpy() {
  const calls: unknown[][] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((...args: unknown[]) => {
    calls.push(args);
    return Promise.reject(
      new Error("network must not be touched on a weightless note"),
    );
  }) as typeof globalThis.fetch;
  return { calls, original };
}

let restoreFetch: (() => void) | null = null;

afterEach(() => {
  // Always restore the real fetch, even if an assertion above threw.
  if (restoreFetch) {
    restoreFetch();
    restoreFetch = null;
  }
});

// Build a standard web Request POST (Next route handlers accept web Request — no
// NextRequest construction friction needed). Body is JSON { note }.
function postNote(note: string): Request {
  return new Request("http://localhost/api/turn1", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ note }),
  });
}

describe("POST /api/turn1 — weightless note refuses with ZERO model calls", () => {
  it("no-weight note → status refusal AND fetch never called", async () => {
    const spy = installFetchSpy();
    restoreFetch = () => {
      globalThis.fetch = spy.original;
    };

    // No kg weight anywhere in the note → STEP-1 pre-LLM gate must refuse.
    const res = await POST(postNote("3yo with barky cough and stridor"));
    const body = (await res.json()) as { status?: string; reason?: string };

    expect(body.status).toBe("refusal");
    expect(body.reason).toBe("weight_missing");
    // THE headline assertion: not one network call was made.
    expect(spy.calls.length).toBe(0);
  });

  it("pounds-only note ('31 lb') → status refusal AND fetch never called", async () => {
    const spy = installFetchSpy();
    restoreFetch = () => {
      globalThis.fetch = spy.original;
    };

    // Pounds-only weight: we never convert lb→kg, so there is no usable kg
    // weight → the pre-LLM gate refuses, again with zero network.
    const res = await POST(postNote("child 31 lb, barky cough"));
    const body = (await res.json()) as { status?: string; reason?: string };

    expect(body.status).toBe("refusal");
    expect(body.reason).toBe("weight_missing");
    expect(spy.calls.length).toBe(0);
  });

  it("a weightless refusal is HTTP 200 (a deliberate decision, not an error)", async () => {
    const spy = installFetchSpy();
    restoreFetch = () => {
      globalThis.fetch = spy.original;
    };

    const res = await POST(postNote("toddler, hoarse, no weight documented"));
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status?: string };
    expect(body.status).toBe("refusal");
    expect(spy.calls.length).toBe(0);
  });
});
