import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

// Inter is the Bluey 3-column shell's display+body face (DESIGN.md
// § "UI refresh — Bluey · Typography"). It maps to --font-sans, which the
// @theme block in globals.css aliases as font-sans for Tailwind utilities.
// Geist Mono stays for the dose trace + provenance values (deliberate
// mono carrier of the "deterministic / constrained" voice).
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Bluey · Clinical care partner",
  description:
    "Clinical decision support: judgment up, execution down. A thin clinical router over a registry of deterministic, safety-audited skills.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* The 3-column shell owns its own h-screen — the body is just the
          neutral surface behind it. flex-col is removed so the shell can fill
          the viewport without competing with a stack model. */}
      <body className="min-h-full bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
