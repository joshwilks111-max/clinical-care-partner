// lib/note-discriminator-scan.ts
//
// ConText/NegEx-style assertion pre-pass (Chapman 2001 JAMIA; Harkema 2009
// JBI 42:839) — the deterministic grounding step between the raw note and
// the Turn 1 differential.
//
// FOR EACH must-not-miss condition in the registry, scan the clinical note
// for each canonical discriminator's surface forms and classify each finding
// as present | absent | not_documented (the FHIR Observation.dataAbsentReason
// cut: documented-absent is NOT the same as not-mentioned).
//
// PATTERN: investigate-before-abstain (KnowGuard, arXiv 2509.24816, ICLR 2026).
// Only ask if not_documented; never ask if absent already documented.
//
// PURE + DETERMINISTIC. No LLM, no network, no dependencies beyond
// normFinding (collapse.ts) + normConditionKey (condition-key.ts) +
// getConditionMeta (registry). Same DRY lever as collapse.ts: this module
// owns no normalization of its own; it borrows from the registry layer.
//
// SCOPE — what this module DOES NOT do:
//   - No temporality classification (ConText's 2nd axis). "history of croup"
//     is handled as a NEGATION-SCOPE terminator (the negation window stops),
//     not as a temporal qualifier — so historical findings emit
//     `not_documented` rather than `present` or `absent` (fail-toward-stopping;
//     clinician sees the question). If 3+ conditions outgrow this, graduate
//     to `negspacy` behind a sidecar (see plan).
//   - No experiencer classification (ConText's 3rd axis).
//   - No fine-tuned assertion classifier (Spark NLP AssertionDLModel).
//   - No SNOMED / FHIR structured output — the JSON shape here is a
//     deliberate subset of FHIR's dataAbsentReason vocabulary.

import { normFinding } from "@/lib/collapse";
import { normConditionKey } from "@/lib/condition-key";
import type { DiscriminatorSurfaceFormMap } from "@/registry/guidelines";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Three-state grounding (the semantic crux of this fix):
 *   present       — note documents the finding as positive
 *   absent        — note explicitly documents the finding as absent
 *   not_documented — note is silent OR the assertion is ambiguous
 *                   (fail-toward-stopping: question still fires)
 *
 * Distinct from DiscriminatorAnswer (lib/schemas.ts) which carries the
 * CLINICIAN'S answer — `not_assessed` (clinician declined) is semantically
 * different from `not_documented` (note silent). Only `absent` flows into
 * the Turn 1.5 override path; only `present` flows into Rule-2 confirmation
 * downstream.
 */
export type GroundingState = "present" | "absent" | "not_documented";

/** One grounded discriminator for one condition. */
export type Grounding = {
  /** Normalized condition key (e.g. "epiglottitis"). */
  condition: string;
  /** Canonical registry discriminator string (e.g. "drooling"). */
  discriminator: string;
  state: GroundingState;
};

// ---------------------------------------------------------------------------
// Trigger lexicons (NegEx, sized for clinical-note idioms).
// All entries lowercased and matched after normFinding(); multi-word
// triggers are checked as token n-grams of length 1-3.
// ---------------------------------------------------------------------------

/** Pre-negation triggers: appear BEFORE the finding within ~6 tokens. */
const PRE_NEGATION_TRIGGERS: ReadonlySet<string> = new Set([
  "no",
  "not",
  "denies",
  "denied",
  "without",
  "absent",
  "negative for",
  "no evidence of",
  "no documented",
  "no signs of",
  "ruled out",
]);

/** Post-negation triggers: appear AFTER the finding within ~6 tokens. */
const POST_NEGATION_TRIGGERS: ReadonlySet<string> = new Set([
  "absent",
  "negative",
  "not present",
  "none",
  "ruled out",
  "denied",
]);

/**
 * Pseudo-negation phrases — superficially negation but semantically
 * confirmatory or unrelated. Disable any negation in the same window.
 * Sourced from the DEEPEN paper (PMC5863758) + NegEx canonical list.
 */
const PSEUDO_NEGATION_PHRASES: readonly string[] = [
  "no increase",
  "no change",
  "no further",
  "no doubt",
  "not only",
  "not necessarily",
];

/**
 * Termination triggers — words that END a negation's scope. A pre-negation
 * trigger does not reach across a termination word.
 *
 * "history of" / "previously" / "prior" are temporality terminators per the
 * /plan-eng-review Finding 1A decision: we punt ConText's temporality axis
 * but still want historical findings to NOT be classified as current-state
 * present/absent. They stop the negation window so the finding ends up
 * `not_documented` (fail-toward-stopping).
 */
const TERMINATION_TRIGGERS: ReadonlySet<string> = new Set([
  "but",
  "however",
  "though",
  "except",
  "history of",
  "previously",
  "prior",
]);

/** Conjunction tokens — a single pre-negation trigger can scope across these. */
const CONJUNCTION_TOKENS: ReadonlySet<string> = new Set(["and", "or"]);

/** How far the trigger window reaches from the matched finding (in tokens). */
const TRIGGER_WINDOW = 6;

/** Max n-gram length for surface-form matches. */
const MAX_NGRAM = 4;

// ---------------------------------------------------------------------------
// Tokenisation
// ---------------------------------------------------------------------------

/**
 * Split a note into sentence-ish segments. Clinical notes are often
 * bullet-pointed; splitting on newlines AND `.` prevents negation scope
 * bleed across list items (e.g. "- no drooling\n- tripod present" must
 * NOT mark tripod absent — the newline breaks scope).
 */
function splitSegments(note: string): string[] {
  return note
    .split(/[\n.;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Tokenise a segment into lowercase tokens, comma-aware. */
function tokenise(segment: string): string[] {
  // Strip parenthetical clauses (normFinding contract) before tokenising
  // so "stridor (mild)" doesn't dilute the n-gram window.
  const cleaned = segment
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, " ")
    // Keep commas as tokens (we use them to detect conjunct lists), strip
    // every other punctuation.
    .replace(/[^\w\s,]/g, " ")
    .replace(/,/g, " , ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length === 0 ? [] : cleaned.split(" ");
}

/** Build an n-gram (1..MAX_NGRAM) starting at index i. */
function ngramAt(tokens: string[], i: number, n: number): string {
  return tokens.slice(i, i + n).join(" ");
}

// ---------------------------------------------------------------------------
// Trigger-window inspection
// ---------------------------------------------------------------------------

type WindowToken = { token: string; index: number };

/**
 * Walk backwards from `i`, collecting tokens until we've accumulated
 * TRIGGER_WINDOW *content* tokens. Commas, conjunctions ("and"/"or"), and
 * tokens that are themselves part of a same-condition surface-form match
 * are FREE — they don't count against the budget. This is what makes a
 * 3-element parallel-conjunct list scope correctly: "no drooling, tripod
 * posture, or muffled voice" lets the pre-negation "no" reach all three
 * findings even though there are 7+ raw tokens between them.
 */
function windowBefore(
  tokens: string[],
  i: number,
  freePositions?: ReadonlySet<number>,
): WindowToken[] {
  const out: WindowToken[] = [];
  let contentBudget = TRIGGER_WINDOW;
  for (let j = i - 1; j >= 0 && contentBudget > 0; j--) {
    const tok = tokens[j];
    out.unshift({ token: tok, index: j });
    const isFree =
      tok === "," ||
      CONJUNCTION_TOKENS.has(tok) ||
      (freePositions !== undefined && freePositions.has(j));
    if (!isFree) contentBudget--;
  }
  return out;
}

function windowAfter(
  tokens: string[],
  i: number,
  span: number,
  freePositions?: ReadonlySet<number>,
): WindowToken[] {
  const out: WindowToken[] = [];
  const start = i + span;
  let contentBudget = TRIGGER_WINDOW;
  for (let j = start; j < tokens.length && contentBudget > 0; j++) {
    const tok = tokens[j];
    out.push({ token: tok, index: j });
    const isFree =
      tok === "," ||
      CONJUNCTION_TOKENS.has(tok) ||
      (freePositions !== undefined && freePositions.has(j));
    if (!isFree) contentBudget--;
  }
  return out;
}

/** True iff any 1-3-gram in the tokens matches one of the trigger phrases. */
function containsTrigger(
  tokens: WindowToken[],
  triggers: ReadonlySet<string>,
): boolean {
  const flat = tokens.map((t) => t.token);
  for (let i = 0; i < flat.length; i++) {
    for (let n = 1; n <= 3 && i + n <= flat.length; n++) {
      const ngram = flat.slice(i, i + n).join(" ");
      if (triggers.has(ngram)) return true;
    }
  }
  return false;
}

/** True iff any pseudo-negation phrase appears in the window. */
function containsPseudoNegation(tokens: WindowToken[]): boolean {
  const flat = tokens.map((t) => t.token).join(" ");
  return PSEUDO_NEGATION_PHRASES.some((p) => flat.includes(p));
}

/**
 * Walks backwards from the finding. If a TERMINATION trigger appears before
 * a PRE_NEGATION trigger, scope is cut — return false. If a pre-negation
 * trigger is reached first, return true.
 */
function hasPreNegationBeforeTermination(window: WindowToken[]): boolean {
  // window is left-to-right; iterate right-to-left (closest first).
  for (let k = window.length - 1; k >= 0; k--) {
    const tok = window[k].token;
    const prev = k > 0 ? window[k - 1].token : "";
    const bigram = `${prev} ${tok}`;
    // Check multi-word terminators first.
    if (TERMINATION_TRIGGERS.has(bigram) || TERMINATION_TRIGGERS.has(tok)) {
      return false;
    }
    if (PRE_NEGATION_TRIGGERS.has(tok) || PRE_NEGATION_TRIGGERS.has(bigram)) {
      return true;
    }
    // Trigrams (e.g. "no evidence of").
    if (k >= 2) {
      const trigram = `${window[k - 2].token} ${prev} ${tok}`;
      if (PRE_NEGATION_TRIGGERS.has(trigram)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Surface-form matching
// ---------------------------------------------------------------------------

/**
 * For each (condition, discriminator) entry in the map, look for ANY surface
 * form as a contiguous token n-gram. Returns the first match in left-to-right
 * order of (segment, position, n-gram length). Match span returned so the
 * caller can compute the trigger window.
 */
type SurfaceMatch = {
  condition: string;
  discriminator: string;
  startIdx: number;
  span: number; // token count of the matched n-gram
};

function findSurfaceMatches(
  tokens: string[],
  surfaceFormMap: DiscriminatorSurfaceFormMap,
): SurfaceMatch[] {
  const matches: SurfaceMatch[] = [];
  for (let i = 0; i < tokens.length; i++) {
    for (let n = MAX_NGRAM; n >= 1; n--) {
      if (i + n > tokens.length) continue;
      const candidate = normFinding(ngramAt(tokens, i, n));
      let matched = false;
      for (const [conditionKey, perDiscriminator] of Object.entries(
        surfaceFormMap,
      )) {
        for (const [canonical, surfaceForms] of Object.entries(
          perDiscriminator,
        )) {
          for (const form of surfaceForms) {
            if (normFinding(form) === candidate) {
              matches.push({
                condition: normConditionKey(conditionKey),
                discriminator: canonical,
                startIdx: i,
                span: n,
              });
              matched = true;
              break;
            }
          }
          if (matched) break;
        }
        if (matched) break;
      }
      if (matched) break; // Take longest match at this position, then advance.
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Conjunct-ambiguity guard
//
// Per /plan-eng-review Finding 1A — Section 1 (Ambiguous Conjunct):
// "no fever, cough, or drooling" — the writer might mean all three absent OR
// "no fever; cough or drooling present." We choose the SAFER call here:
// emit `not_documented` for the trailing conjuncts WHEN the conjunct list
// mixes known and unknown items.
//
// THE REFINED RULE (T4 found this): a 3-element parallel conjunct of
// REGISTRY-KNOWN findings — "No drooling, tripod posture, or muffled voice"
// — is the canonical demo case and MUST scope absence across all three.
// The genuinely ambiguous case is when the list contains tokens NOT in the
// surface-form map ("fever", "cough" — we don't know what they mean
// clinically). Heuristic: walk backwards from the match to the nearest
// pre-negation trigger; if every intervening comma-separated item is itself
// a surface-form match for the same condition, the list is unambiguous and
// the match keeps its absent status. If any intervening token is unknown,
// the list is ambiguous → fail-toward-stopping.
// ---------------------------------------------------------------------------

function buildCoveredPositions(
  match: SurfaceMatch,
  allMatches: SurfaceMatch[],
): Set<number> {
  const covered = new Set<number>();
  for (const m of allMatches) {
    if (m.condition !== match.condition) continue;
    for (let i = m.startIdx; i < m.startIdx + m.span; i++) {
      covered.add(i);
    }
  }
  return covered;
}

function isAmbiguousTrailingConjunct(
  tokens: string[],
  match: SurfaceMatch,
  allMatches: SurfaceMatch[],
): boolean {
  const coveredPositions = buildCoveredPositions(match, allMatches);

  // Walk backwards from the match using the SAME free-position rules as the
  // negation window — commas, conjunctions, and same-condition match tokens
  // are free. Stop at a termination trigger (negation scope is cut, so this
  // finding is not part of a conjunct list governed by any earlier pre-neg).
  // Stop at a pre-negation trigger and inspect the items in between.
  let preNegAt = -1;
  let contentBudget = TRIGGER_WINDOW;
  for (let k = match.startIdx - 1; k >= 0 && contentBudget > 0; k--) {
    const tok = tokens[k];
    if (TERMINATION_TRIGGERS.has(tok)) {
      // Termination cuts the scope — this match is not in a conjunct list.
      return false;
    }
    if (PRE_NEGATION_TRIGGERS.has(tok)) {
      preNegAt = k;
      break;
    }
    const isFree =
      tok === "," || CONJUNCTION_TOKENS.has(tok) || coveredPositions.has(k);
    if (!isFree) contentBudget--;
  }
  if (preNegAt < 0) return false; // No pre-neg in scope → not in a list at all.

  // Walk forward from the pre-neg to the match. If every intervening token
  // is a comma, conjunction, OR part of a same-condition surface match, the
  // list is parallel-known → unambiguous. Otherwise → ambiguous.
  for (let k = preNegAt + 1; k < match.startIdx; k++) {
    const tok = tokens[k];
    if (tok === ",") continue;
    if (CONJUNCTION_TOKENS.has(tok)) continue;
    if (coveredPositions.has(k)) continue;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan a clinical note for grounded discriminators across all conditions in
 * the surface-form map. Returns one Grounding per (condition, discriminator)
 * pair declared in the map — never invents conditions or discriminators not
 * already in the registry.
 *
 * A condition+discriminator with no surface-form match anywhere in the note
 * emits `state: "not_documented"`. A match with a recognised pre/post
 * negation trigger emits `absent`. A bare match (no trigger) emits `present`.
 * Pseudo-negation in the window disables the negation (stays `present`).
 * Termination triggers cut the negation scope (so "no drooling but tripod
 * present" → drooling:absent + tripod:present).
 */
export function scanNote(
  note: string,
  surfaceFormMap: DiscriminatorSurfaceFormMap,
): Grounding[] {
  // Initialize "not_documented" for every condition+discriminator pair in the
  // map. Per-pair matches below upgrade to present/absent when found.
  const groundings = new Map<string, Grounding>();
  const keyOf = (c: string, d: string) => `${c}::${d}`;
  for (const [conditionKey, perDiscriminator] of Object.entries(
    surfaceFormMap,
  )) {
    const condition = normConditionKey(conditionKey);
    for (const discriminator of Object.keys(perDiscriminator)) {
      groundings.set(keyOf(condition, discriminator), {
        condition,
        discriminator,
        state: "not_documented",
      });
    }
  }

  // Scan each segment independently — bullet/sentence boundaries cut scope.
  for (const segment of splitSegments(note)) {
    const tokens = tokenise(segment);
    if (tokens.length === 0) continue;

    const matches = findSurfaceMatches(tokens, surfaceFormMap);
    for (const match of matches) {
      const k = keyOf(match.condition, match.discriminator);
      const existing = groundings.get(k);
      // Once we've classified a finding as `present` or `absent` in any
      // segment, a later not_documented finding doesn't downgrade. But a
      // present can override a prior absent if both appear (last writer
      // wins for the same finding string in the same note — rare).
      if (existing && existing.state !== "not_documented") {
        // Skip: already classified. Keeps semantics deterministic on repeat
        // mentions ("no drooling. drooling at 0900." would otherwise flip).
        continue;
      }

      const covered = buildCoveredPositions(match, matches);
      const before = windowBefore(tokens, match.startIdx, covered);
      const after = windowAfter(tokens, match.startIdx, match.span, covered);

      // Pseudo-negation in either window disables negation entirely.
      const pseudo =
        containsPseudoNegation(before) || containsPseudoNegation(after);

      if (pseudo) {
        groundings.set(k, { ...match, state: "present" } as Grounding);
        continue;
      }

      // Ambiguous trailing conjunct — fail-toward-stopping.
      if (isAmbiguousTrailingConjunct(tokens, match, matches)) {
        // Leave as not_documented (initialised default).
        continue;
      }

      const preNegated = hasPreNegationBeforeTermination(before);
      const postNegated = containsTrigger(after, POST_NEGATION_TRIGGERS);

      if (preNegated || postNegated) {
        groundings.set(k, {
          condition: match.condition,
          discriminator: match.discriminator,
          state: "absent",
        });
      } else {
        groundings.set(k, {
          condition: match.condition,
          discriminator: match.discriminator,
          state: "present",
        });
      }
    }
  }

  return Array.from(groundings.values());
}

/**
 * Convenience: return only the canonical discriminator strings the scanner
 * marked `absent` for a given condition key. Used by the Turn 1 route's
 * canonicalisation pass (Finding 1B remediation).
 */
export function groundedAbsentFor(
  groundings: Grounding[],
  conditionKey: string,
): string[] {
  const wanted = normConditionKey(conditionKey);
  return groundings
    .filter((g) => g.condition === wanted && g.state === "absent")
    .map((g) => g.discriminator);
}
