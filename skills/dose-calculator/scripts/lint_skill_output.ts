#!/usr/bin/env bun
/**
 * lint_skill_output.ts — the mechanical safety oracle for invariant 5
 * ("never author a number").
 *
 * Reads a markdown file containing the skill's output and fails if any
 * digit-unit token (e.g. `2.13 mg`, `12mg`, `0.5 mL`) appears OUTSIDE the
 * fenced ```dose-card JSON block. The dose-card block is the contract;
 * the prose must remain qualitative so the harness validator owns every
 * number the clinician ever sees.
 *
 * Usage:
 *   bun scripts/lint_skill_output.ts <path-to-output.md>
 *   bun scripts/lint_skill_output.ts -            # reads from stdin
 *
 * Exit codes:
 *   0  → clean, no digit-unit tokens in prose
 *   1  → at least one violation found
 *   2  → file unreadable / bad arguments
 */

const DIGIT_UNIT = /\b\d+\.?\d*\s*(?:mg|ml|mcg|µg|micrograms?)\b/gi;
const DOSE_CARD_FENCE = /```dose-card\s*\n[\s\S]*?\n```/g;
const REASSESS_FENCE = /```reassessment-card\s*\n[\s\S]*?\n```/g;

type Violation = { token: string; line: number; column: number };

function stripStructuredBlocks(source: string): string {
  // Replace each structured block with whitespace of equal length so line
  // numbers stay correct in the residual prose.
  return source
    .replace(DOSE_CARD_FENCE, (match) => " ".repeat(match.length))
    .replace(REASSESS_FENCE, (match) => " ".repeat(match.length));
}

function findViolations(prose: string): Violation[] {
  const lines = prose.split("\n");
  const out: Violation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    DIGIT_UNIT.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DIGIT_UNIT.exec(line)) !== null) {
      out.push({ token: m[0], line: i + 1, column: m.index + 1 });
    }
  }
  return out;
}

async function readInput(arg: string): Promise<string> {
  if (arg === "-") {
    const chunks: Uint8Array[] = [];
    // @ts-ignore — Bun-specific stdin stream
    for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
    return new TextDecoder().decode(Buffer.concat(chunks));
  }
  return await Bun.file(arg).text();
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: bun scripts/lint_skill_output.ts <path-or-->");
    process.exit(2);
  }
  let source: string;
  try {
    source = await readInput(arg);
  } catch (e) {
    console.error(`error: cannot read ${arg}: ${(e as Error).message}`);
    process.exit(2);
  }
  const prose = stripStructuredBlocks(source);
  const violations = findViolations(prose);
  if (violations.length === 0) {
    console.log("ok: no digit-unit tokens in prose");
    process.exit(0);
  }
  for (const v of violations) {
    console.error(
      `violation: ${arg}:${v.line}:${v.column}: '${v.token}' is a digit-unit token in prose (must live in the dose-card JSON block)`,
    );
  }
  console.error(`${violations.length} violation(s) — invariant 5 broken`);
  process.exit(1);
}

main();
