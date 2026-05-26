// prompts/turn1.5-sanitize.ts
//
// Sanitization helpers shared by Turn 1.5 prompt builders.

import { NOTE_OPEN, NOTE_CLOSE } from "@/prompts/turn1";

export const DISCRIMINATORS_OPEN = "<<<UNTRUSTED_DISCRIMINATORS>>>";
export const DISCRIMINATORS_CLOSE = "<<<END_UNTRUSTED_DISCRIMINATORS>>>";

export const MAX_DISCRIMINATORS = 8;
export const MAX_DISCRIMINATOR_LEN = 120;

export function sanitizeDiscriminator(s: string): string {
  let out = s
    .split(DISCRIMINATORS_OPEN)
    .join("")
    .split(DISCRIMINATORS_CLOSE)
    .join("")
    .split(NOTE_OPEN)
    .join("")
    .split(NOTE_CLOSE)
    .join("");

  // eslint-disable-next-line no-control-regex
  out = out.replace(/[\x00-\x1F\x7F]/g, " ");
  out = out.replace(/https?:\/\/\S+/gi, " ");
  out = out.replace(/www\.\S+/gi, " ");
  out = out.replace(/[`[\]()<>#*_]/g, " ");
  out = out.replace(/\s+/g, " ").trim();

  if (out.length > MAX_DISCRIMINATOR_LEN) {
    out = out.slice(0, MAX_DISCRIMINATOR_LEN).trim();
  }
  return out;
}

export function sanitizeDiscriminators(list: string[]): string[] {
  return list
    .map(sanitizeDiscriminator)
    .filter((s) => s.length > 0)
    .slice(0, MAX_DISCRIMINATORS);
}
