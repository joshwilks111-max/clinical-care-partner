// lib/note-discriminator-scan.generalisation.test.ts
//
// Proof that the grounded-discriminator feature generalises by DATA, not code.
//
// THE CLAIM: adding a new must-not-miss condition (or any condition with
// discriminator surface forms) needs ZERO scanner-, prompt-, or route-side
// code edits. The scanner is map-driven; the override is registry-driven.
// Drop a row into CONDITION_META.discriminator_surface_forms and everything
// downstream just works.
//
// THE TEST: build a throwaway DiscriminatorSurfaceFormMap with a brand-new
// fake condition ("test-condition") and a fake discriminator ("widget-sign")
// — NOT in the live registry. Scan a note that documents the discriminator
// absent. Assert the scanner emits the canonical key as `absent`.
//
// If this test passes WITHOUT modifying lib/note-discriminator-scan.ts or
// any other source file, the generalisation claim holds.

import { describe, it, expect } from "vitest";

import { scanNote, groundedAbsentFor } from "@/lib/note-discriminator-scan";
import type { DiscriminatorSurfaceFormMap } from "@/registry/guidelines";

describe("scanner generalises by DATA, not code", () => {
  it("a brand-new condition with surface forms grounds correctly with zero source edits", () => {
    // A condition + discriminator that does NOT exist in the live registry.
    // Three surface forms exercise the synonym-coverage path.
    const customMap: DiscriminatorSurfaceFormMap = {
      "test-condition": {
        "widget-sign": ["widget sign", "widgeting", "wpw-like pattern"],
      },
    };

    const note = "Patient assessed; no widget sign documented.";
    const groundings = scanNote(note, customMap);

    // Scanner must emit the canonical discriminator (NOT the surface form)
    // and classify it as absent.
    const widget = groundings.find((g) => g.discriminator === "widget-sign");
    expect(widget).toBeDefined();
    expect(widget!.state).toBe("absent");
    expect(widget!.condition).toBe("test-condition");

    // groundedAbsentFor must return the canonical string for this condition.
    expect(groundedAbsentFor(groundings, "test-condition")).toEqual([
      "widget-sign",
    ]);
  });

  it("multiple new conditions share the scanner — no per-condition code paths", () => {
    const customMap: DiscriminatorSurfaceFormMap = {
      "cond-a": {
        "finding-a": ["finding a"],
      },
      "cond-b": {
        "finding-b": ["finding b"],
        "finding-c": ["finding c"],
      },
    };

    const note = "No finding a, no finding b, no finding c.";
    const groundings = scanNote(note, customMap);

    expect(groundedAbsentFor(groundings, "cond-a").sort()).toEqual([
      "finding-a",
    ]);
    expect(groundedAbsentFor(groundings, "cond-b").sort()).toEqual([
      "finding-b",
      "finding-c",
    ]);
  });

  it("synonym variety: any surface form maps to the canonical key", () => {
    const customMap: DiscriminatorSurfaceFormMap = {
      neologism: {
        canonical: ["alpha", "beta", "gamma", "delta"],
      },
    };

    // Each note uses a different synonym — all should ground to "canonical".
    for (const surfaceForm of ["alpha", "beta", "gamma", "delta"]) {
      const groundings = scanNote(`No ${surfaceForm} present.`, customMap);
      expect(groundedAbsentFor(groundings, "neologism")).toEqual(["canonical"]);
    }
  });
});
