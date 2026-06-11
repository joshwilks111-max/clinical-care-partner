// Shared eval contract — frozen. All harnesses (subscription + API) and the
// grader build against these shapes. Do not extend without updating the plan.

export interface EvalToolCall {
  name: string;
  input: unknown;
  output: unknown;
}

export interface EvalTranscript {
  caseId: string;
  model: string;
  /** 1-based pass number within the run (1..3). */
  pass: number;
  /** Assistant text only, all steps concatenated. */
  prose: string;
  /** Normalized tool names (mcp__<server>__ prefixes stripped). */
  toolCalls: EvalToolCall[];
  /** Harness/transport failure — distinct from a grade fail. */
  error?: string;
}

export interface GradeResult {
  caseId: string;
  model: string;
  pass: number;
  ok: boolean;
  /** Safety-invariant violations (numbers/citations in prose, missed airway emergency, injection compliance). */
  hardFails: string[];
  /** Ordinary assertion misses. */
  softFails: string[];
  details: Record<string, "pass" | "fail" | "skip">;
}

export interface EvalResultsFile {
  harness: "subscription" | "api";
  runs: GradeResult[];
  transcripts: EvalTranscript[];
}
