// components/icons/bluey-heeler.tsx
//
// The Bluey heeler mark. Original geometric design — deliberately distinct
// from Ludo Studio's Bluey character (we share the dog-breed silhouette, not
// the IP). Uses currentColor so the surrounding tile's text color sets the
// fill (and so the icon inherits theme tokens, not a hard-coded hex).
//
// Provenance: hand-authored paths from variant-B-balanced.html (the canonical
// visual reference for the 3-column shell rebuild). DO NOT replace with a
// Bluey TV-show illustration or any Ludo Studio asset.

import type { SVGProps } from "react";

import { cn } from "@/components/lib/utils";

export type BlueyHeelerProps = Omit<
  SVGProps<SVGSVGElement>,
  "viewBox" | "fill" | "aria-label"
>;

export function BlueyHeeler({ className, ...rest }: BlueyHeelerProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-label="Bluey"
      fill="currentColor"
      className={cn("text-primary", className)}
      {...rest}
    >
      {/* Body */}
      <path d="M5 19 C5 15.5, 8.5 13.5, 13 13.5 L20 13.5 C24 13.5, 27 15.5, 27 19 L27 23 C27 24, 26 25, 25 25 L7 25 C6 25, 5 24, 5 23 Z" />
      {/* Perked ears */}
      <path d="M8.5 13.8 L7 7.5 L12 11.5 Z" />
      <path d="M22 13.8 L25.5 8 L24 12.5 Z" />
      {/* Snout */}
      <rect x="16" y="18" width="11" height="4.2" rx="1.8" />
      {/* Eye */}
      <circle cx="22" cy="17.5" r="1.25" fill="#ffffff" />
      {/* Nose */}
      <circle cx="26.6" cy="20" r="0.9" fill="#1e293b" />
      {/* Tail */}
      <path d="M27 18 L30.5 16.5 L29.5 20 Z" />
    </svg>
  );
}
