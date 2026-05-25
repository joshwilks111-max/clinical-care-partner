# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/); versions use `MAJOR.MINOR.PATCH.MICRO`.

## [1.0.0.0] - 2026-05-25

First complete deliverable for the Heidi take-home: a clinical decision-support care-partner PoC with a deterministic safety spine, plus the brief-conformance pass that makes every requirement legible to a cold reviewer.

### Added
- **Free-text note/transcript intake.** A "paste your own note or transcript" textarea on the console, alongside the one-click demo buttons. Proves the brief's "accepts unstructured clinical text (a note AND/OR transcript)" live, without removing the no-typing demo path.
- **Two transcript demos.** `Transcript (croup)` (a doctor–parent dialogue with a weight → full differential → dose) and `Transcript (no weight)` (the same dialogue with no weight → the pre-LLM refusal gate fires live). Demonstrates transcript parsing *and* the safety thesis on messy real-world input.
- **One-page architecture PNG** (`docs/architecture.png`) rendered from the Mermaid source, linked from the README — the brief's PNG/PDF deliverable.
- **Retrieval rationale in the README** (§3): "whole-document injection — the right tool for a two-document corpus", with the measured corpus size (~800 tokens) and the deferred large-corpus path.

### Changed
- `runTurn1` now takes a raw note string; both the demo buttons and the paste box route through the single `runTurn1(note) → /api/turn1` path, so pasted text is wrapped in the same untrusted-note delimiters as demos. The single path is the trust-boundary enforcement.
- Demo row grouped into **Notes** and **Transcripts** for legibility.
- README/research/DESIGN corpus figure corrected from an asserted "~10K tokens" to the measured **~800 tokens** (one source of truth).
- The left-panel note display preserves transcript line breaks (`whitespace-pre-line`).

### Fixed
- **Forged-delimiter defence (security).** A pasted note containing the literal `NOTE_OPEN`/`NOTE_CLOSE` markers is now sanitised before wrapping (`sanitizeUntrustedNote`), so a paste cannot close the untrusted region early. Blast radius was already bounded (turn 1 emits a structured differential, never a dose); this is defence-in-depth on the newly user-reachable free-text path.

### Tests
- 221 passing (up from 211): paste-path coverage, both transcript buttons, the forged-delimiter test, and regression locks on the weight gate (`hasKgWeight` passes the weight-present fixture, fails the weight-absent one) and the prompt-layer delimiter wrap.
