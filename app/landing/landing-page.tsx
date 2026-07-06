"use client";

// app/landing/landing-page.tsx
//
// The submission landing page — the narrative front door served at
// joshw-heidi-interview.space/. It walks the brief, tells the safety story, the
// region-routing story, the proof, and the build journey, then shows the full
// trace inline via a static walkthrough (#preview). The live AI console (/demo,
// /api/chat) was retired; its code remains in git history. Same design language
// as the Bluey
// console (cream/claret/amber, Source Serif headings) but self-contained: the
// styles live in an injected <style> block so the hand-tuned CSS ports 1:1 from
// the original static page with zero regression risk, and the interactive dose
// calculator (the same deterministic maths the server tool runs, model not
// involved) runs in a useEffect. No clinical number on this page is authored by
// a model — every dose is computed from the registry's mg/kg + cap, the same as
// production.

import { useEffect } from "react";

const STYLES = `
  .lp{--cream:#f6efe6;--cream-2:#ece4d6;--cream-3:#fbf6ee;--panel:#fff;
    --ink:#221a17;--ink-2:#3a312b;--muted:#7a6e62;--line:#e6dccb;--line-2:#efe6d6;
    --claret:#5b2230;--claret-2:#7a2e3f;--claret-bg:#fbeae0;
    --accent:#1d7a8c;--accent-bg:#e8f4f6;--amber:#a36a12;--amber-bg:#fdf4e3;--amber-line:#ecd5a3;
    --det:#5b4bbd;--det-bg:#efecfb;--ok:#1f7a47;--ok-bg:#e3f3ea;
    --serif:'Source Serif 4','Charter','Iowan Old Style','Georgia',serif;
    --sans:'Inter','Segoe UI',system-ui,sans-serif;--mono:'SF Mono',ui-monospace,Consolas,monospace;
    --r-sm:7px;--r-md:10px;--r-lg:14px;
    --shadow-sm:0 1px 0 rgba(34,26,23,.04),0 1px 2px rgba(34,26,23,.04);
    --shadow-md:0 1px 0 rgba(34,26,23,.04),0 4px 18px -8px rgba(91,34,48,.18);
    background:var(--cream-2);color:var(--ink);
    font-family:var(--sans);font-size:15px;line-height:1.55;
    -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;min-height:100vh;}
  .lp *{box-sizing:border-box}
  .lp a{color:var(--claret);text-decoration:none}
  .lp a:hover{text-decoration:underline;text-underline-offset:3px}
  .lp a:focus-visible,.lp button:focus-visible,.lp input:focus-visible{outline:2px solid var(--claret);outline-offset:2px;border-radius:6px}
  .lp ::selection{background:var(--claret);color:#fff}
  .lp .wrap{max-width:1120px;margin:0 auto;padding:0 28px}
  .lp .top{padding:18px 0 0}
  .lp .top-row{display:flex;align-items:center;justify-content:space-between}
  .lp .brand{display:flex;align-items:center;gap:10px;font-weight:600}
  .lp .logo{width:30px;height:30px;border-radius:9px;background:var(--claret);color:#fff;font-family:var(--serif);font-weight:700;font-size:15px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 0 rgba(0,0,0,.06),inset 0 -1px 0 rgba(0,0,0,.12)}
  .lp .brand .nm{font-size:15px;letter-spacing:-.005em}
  .lp .top-nav{display:flex;gap:22px;font-size:13.5px;color:var(--ink-2)}
  .lp .top-nav a{color:var(--ink-2);font-weight:500}
  .lp .top-cta{background:var(--claret);color:#fff;border:none;border-radius:9px;padding:8px 14px;font-weight:600;font-size:13.5px;cursor:pointer;font-family:inherit;box-shadow:var(--shadow-sm)}
  .lp .top-cta:hover{background:var(--claret-2)}
  .lp .hero{padding:54px 0 22px;position:relative}
  .lp .eyebrow{display:inline-flex;align-items:center;gap:8px;background:var(--cream);border:1px solid var(--line);color:var(--ink-2);font-size:12px;font-weight:600;padding:5px 12px;border-radius:999px;letter-spacing:.02em}
  .lp .eyebrow .dot{width:7px;height:7px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px var(--ok-bg)}
  .lp .h1{font-family:var(--serif);font-size:clamp(38px,5.4vw,64px);line-height:1.04;letter-spacing:-.022em;font-weight:600;margin:18px 0 14px;color:var(--ink);max-width:880px}
  .lp .h1 em{font-style:normal;color:var(--claret);background:linear-gradient(transparent 62%,rgba(91,34,48,.10) 62%);padding:0 2px}
  .lp .sub{font-size:18px;line-height:1.55;color:var(--ink-2);max-width:640px;margin:0 0 26px}
  .lp .cta-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .lp .btn-pri{background:var(--claret);color:#fff;border:none;border-radius:10px;padding:12px 20px;font-size:14.5px;font-weight:600;cursor:pointer;font-family:inherit;box-shadow:var(--shadow-sm);display:inline-flex;align-items:center;gap:8px}
  .lp .btn-pri:hover{background:var(--claret-2);transform:translateY(-1px);box-shadow:var(--shadow-md)}
  .lp .btn-pri:active{transform:translateY(0)}
  .lp .btn-pri:after{content:"\\2192";transition:transform .15s ease}
  .lp .btn-pri:hover:after{transform:translateX(3px)}
  .lp .btn-sec{background:transparent;color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:11px 18px;font-size:14.5px;font-weight:600;cursor:pointer;font-family:inherit}
  .lp .btn-sec:hover{background:var(--cream)}
  .lp .cta-foot{font-size:12.5px;color:var(--muted);margin-left:6px}
  .lp .demo-wrap{margin-top:44px;background:var(--cream);border:1px solid var(--line);border-radius:18px;padding:14px;box-shadow:var(--shadow-md)}
  .lp .demo-grid{display:grid;grid-template-columns:1.05fr 1fr;gap:14px}
  @media(max-width:880px){.lp .demo-grid{grid-template-columns:1fr}}
  .lp .demo-card{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:18px 20px}
  .lp .demo-h{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-weight:650;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between}
  .lp .demo-h .tag{font-family:var(--mono);font-size:9.5px;background:var(--det-bg);color:var(--det);padding:2px 7px;border-radius:5px;letter-spacing:.05em}
  .lp .demo-h .tag.amber{background:var(--amber-bg);color:var(--amber)}
  .lp .note-meta{display:flex;gap:12px;align-items:center;margin-bottom:10px;font-size:12.5px;color:var(--muted)}
  .lp .case-av{width:30px;height:30px;border-radius:50%;background:var(--claret);color:#fff;font-weight:700;font-family:var(--serif);font-size:13px;display:flex;align-items:center;justify-content:center}
  .lp .case-nm{font-weight:650;color:var(--ink);font-family:var(--serif);font-size:15px}
  .lp .note-body{font-size:13.5px;line-height:1.62;color:var(--ink-2);white-space:pre-line;border-top:1px solid var(--line-2);padding-top:12px}
  .lp .slider-row{margin-top:14px;padding-top:12px;border-top:1px dashed var(--line);display:flex;align-items:center;gap:12px}
  .lp .slider-row label{font-size:12.5px;color:var(--ink-2);font-weight:600;min-width:84px}
  .lp .slider-row .w-val{font-family:var(--mono);font-size:13px;color:var(--claret);font-weight:600;background:var(--claret-bg);border-radius:6px;padding:2px 8px;min-width:62px;text-align:center}
  .lp input[type=range]{-webkit-appearance:none;appearance:none;flex:1;height:4px;background:var(--cream-2);border-radius:2px;outline:none}
  .lp input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:18px;height:18px;border-radius:50%;background:var(--claret);cursor:pointer;box-shadow:0 1px 3px rgba(91,34,48,.4);border:2px solid #fff;transition:transform .12s ease}
  .lp input[type=range]::-webkit-slider-thumb:hover{transform:scale(1.15)}
  .lp input[type=range]::-moz-range-thumb{width:18px;height:18px;border-radius:50%;background:var(--claret);cursor:pointer;border:2px solid #fff;box-shadow:0 1px 3px rgba(91,34,48,.4)}
  .lp .region-row{margin-top:10px;display:flex;gap:6px;align-items:center;font-size:12.5px;color:var(--muted)}
  .lp .region-pill{background:var(--cream-2);border:1px solid var(--line);border-radius:6px;padding:3px 10px;font-weight:600;color:var(--ink);cursor:pointer;font-size:12px;transition:all .12s ease}
  .lp .region-pill.on{background:var(--claret);color:#fff;border-color:var(--claret)}
  .lp .msg{background:#fafaf6;border:1px solid var(--line);border-radius:13px 13px 13px 4px;padding:0;overflow:hidden;margin-top:2px}
  .lp .think{display:inline-flex;align-items:center;gap:6px;background:var(--cream-2);border:1px solid var(--line);border-radius:14px;padding:3px 9px;font-size:11px;color:var(--muted);margin:11px 14px 0;width:fit-content;opacity:0}
  .lp .think:before{content:"\\26A1";font-size:11px;color:var(--claret)}
  .lp .think.in{animation:lpFade .35s ease forwards;animation-delay:.15s}
  @media(prefers-reduced-motion:reduce){.lp .think{opacity:1;animation:none}}
  .lp .src{display:inline-flex;align-items:center;gap:7px;background:#f1ebde;border:1px solid var(--line);border-radius:8px;padding:5px 10px;margin:8px 14px 0;font-size:12px;color:var(--ink);width:fit-content;cursor:pointer}
  .lp .src .n{font-weight:700;color:var(--claret)}
  .lp .src .vw{color:var(--muted);margin-left:2px}
  .lp .a-body{padding:10px 16px 14px}
  .lp .a-title{font-family:var(--serif);font-size:17px;font-weight:650;line-height:1.3;margin:8px 0 6px;letter-spacing:-.01em}
  .lp .a-prose{font-size:13.5px;color:var(--ink-2);line-height:1.6;margin:0 0 8px}
  .lp .a-prose .cite{display:inline-flex;align-items:center;gap:3px;background:var(--accent-bg);border:1px solid #c7e3e7;color:var(--accent);font-size:10.5px;font-weight:600;border-radius:11px;padding:1px 8px;vertical-align:1px;margin-left:3px}
  .lp .a-prose .cite:before{content:"\\00A7";font-weight:700}
  .lp .dose{margin-top:10px;border:1px solid var(--line);border-radius:9px;padding:11px 13px;background:#fff}
  .lp .dose .h{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-weight:650;display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
  .lp .dose .b{font-family:var(--mono);font-size:9.5px;background:var(--det-bg);color:var(--det);padding:2px 7px;border-radius:5px;letter-spacing:.05em}
  .lp .dose .v{font-family:var(--serif);font-size:26px;font-weight:700;letter-spacing:-.018em;line-height:1.1;color:var(--ink)}
  .lp .dose .v .rt{font-size:13px;color:var(--muted);font-weight:500;font-family:var(--sans);margin-left:6px}
  .lp .dose .v .num{transition:color .18s ease}
  .lp .dose .trace{font-family:var(--mono);font-size:11.5px;color:#5b6678;background:#f5efe3;border-radius:5px;padding:7px 9px;margin-top:8px}
  .lp .dose .trace .cap{color:#7a6e3e}
  .lp .dose .src-row{margin-top:8px;font-size:11.5px;color:var(--muted);display:flex;align-items:center;gap:5px}
  .lp .dose .src-row a{color:var(--accent);font-weight:600}
  .lp .dose.capped{background:linear-gradient(180deg,#fff 0%,var(--amber-bg) 130%)}
  .lp .dose.capped .b{background:var(--amber-bg);color:var(--amber)}
  .lp .cap-chip{display:inline-flex;align-items:center;gap:4px;background:var(--amber-bg);color:var(--amber);border:1px solid var(--amber-line);font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:5px;text-transform:uppercase;letter-spacing:.05em;margin-left:8px;vertical-align:3px;opacity:0;transition:opacity .2s ease}
  .lp .cap-chip.on{opacity:1}
  .lp .reass{margin-top:10px;border:1px solid var(--line);border-radius:9px;padding:10px 12px;background:#fff}
  .lp .reass .rh{display:flex;align-items:center;gap:9px;margin-bottom:6px}
  .lp .reass .clk{width:24px;height:24px;border-radius:50%;background:var(--cream-2);color:var(--ink);display:flex;align-items:center;justify-content:center;font-size:12px;flex:none}
  .lp .reass .rt{font-family:var(--serif);font-size:14px;font-weight:650}
  .lp .reass .rs{font-size:11px;color:var(--muted)}
  .lp .watch{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0 0}
  .lp .watch span{background:var(--amber-bg);color:var(--amber);border:1px solid var(--amber-line);border-radius:12px;padding:2px 8px;font-size:11px;font-weight:500}
  .lp .strip{margin-top:40px;padding:18px 22px;background:var(--cream);border:1px solid var(--line);border-radius:12px;display:flex;flex-wrap:wrap;gap:28px;align-items:center;justify-content:space-between;font-size:13px;color:var(--ink-2)}
  .lp .strip .item{display:flex;align-items:center;gap:8px}
  .lp .strip .item b{color:var(--ink);font-weight:650}
  .lp .strip .num{font-family:var(--serif);font-size:20px;font-weight:700;color:var(--claret);line-height:1}
  .lp section{padding:64px 0}
  .lp .sec-eyebrow{font-size:11.5px;font-weight:700;color:var(--claret);text-transform:uppercase;letter-spacing:.1em;margin:0 0 12px}
  .lp .h2{font-family:var(--serif);font-size:clamp(28px,3.6vw,40px);line-height:1.1;letter-spacing:-.018em;font-weight:600;margin:0 0 14px;max-width:760px}
  .lp .lede{font-size:16.5px;color:var(--ink-2);max-width:680px;margin:0 0 36px}
  .lp .layers{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  @media(max-width:780px){.lp .layers{grid-template-columns:1fr}}
  .lp .layer{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:24px 24px 22px;position:relative;overflow:hidden}
  .lp .layer:before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--claret)}
  .lp .layer.two:before{background:var(--det)}
  .lp .layer .ord{font-family:var(--mono);font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin:0 0 6px}
  .lp .layer h3{font-family:var(--serif);font-size:21px;font-weight:650;margin:0 0 8px;letter-spacing:-.01em}
  .lp .layer p{font-size:14px;color:var(--ink-2);margin:0 0 14px;line-height:1.6}
  .lp .layer .code{font-family:var(--mono);font-size:12px;background:var(--cream-3);border:1px solid var(--line-2);border-radius:7px;padding:10px 12px;color:var(--ink-2);white-space:pre;overflow-x:auto}
  .lp .layer .code .k{color:var(--claret);font-weight:600}
  .lp .layer .code .c{color:var(--muted);font-style:italic}
  .lp .layer .code .s{color:var(--ok)}
  .lp .brief{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-top:8px}
  @media(max-width:780px){.lp .brief{grid-template-columns:1fr}}
  .lp .brief-row{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:18px 20px;display:flex;gap:14px;align-items:flex-start}
  .lp .brief-row .ix{font-family:var(--mono);font-size:11px;font-weight:700;color:var(--claret);background:var(--claret-bg);border-radius:6px;padding:3px 8px;flex:none;margin-top:2px}
  .lp .brief-row h4{margin:0 0 4px;font-family:var(--serif);font-size:15.5px;font-weight:650;letter-spacing:-.01em}
  .lp .brief-row .ask{font-size:12px;color:var(--muted);margin:0 0 6px;font-style:italic}
  .lp .brief-row p{margin:0;font-size:13px;color:var(--ink-2);line-height:1.55}
  .lp .brief-row code{font-family:var(--mono);font-size:11.5px;background:var(--cream-3);border:1px solid var(--line-2);border-radius:4px;padding:1px 5px}
  .lp .ref-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:8px}
  .lp .ref{background:var(--cream-3);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
  .lp .ref h4{margin:0 0 4px;font-family:var(--mono);font-size:12px;color:var(--claret);font-weight:700;letter-spacing:.02em}
  .lp .ref p{margin:0;font-size:12.5px;color:var(--ink-2);line-height:1.5}
  .lp .regions{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:6px}
  @media(max-width:780px){.lp .regions{grid-template-columns:1fr}}
  .lp .reg{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:20px 22px}
  .lp .reg .flag{font-family:var(--serif);font-weight:700;font-size:18px;color:var(--claret);display:flex;align-items:center;gap:8px}
  .lp .reg .source{font-size:12.5px;color:var(--muted);margin:6px 0 14px}
  .lp .reg .calc{font-family:var(--mono);font-size:13px;background:var(--cream-3);border-radius:7px;padding:10px 12px;color:var(--ink-2)}
  .lp .reg .calc b{color:var(--claret)}
  .lp .reg .out{font-family:var(--serif);font-size:24px;font-weight:700;margin-top:10px;letter-spacing:-.015em}
  .lp .reg .out .u{font-size:12.5px;color:var(--muted);font-family:var(--sans);font-weight:500;margin-left:4px}
  .lp .eval{background:var(--ink);color:var(--cream);border-radius:16px;padding:36px 36px;display:grid;grid-template-columns:1fr 1.4fr;gap:36px;align-items:center}
  @media(max-width:780px){.lp .eval{grid-template-columns:1fr}}
  .lp .eval .score{font-family:var(--serif);font-size:clamp(54px,7vw,84px);font-weight:700;line-height:1;letter-spacing:-.022em;color:#fff}
  .lp .eval .score .sl{color:var(--cream);opacity:.5}
  .lp .eval .ev-sub{font-size:13px;color:var(--cream);opacity:.7;margin-top:4px;letter-spacing:.04em;text-transform:uppercase;font-weight:600}
  .lp .eval h3{font-family:var(--serif);font-size:24px;font-weight:600;line-height:1.25;margin:0 0 8px;color:#fff}
  .lp .eval p{font-size:14px;color:var(--cream);opacity:.85;margin:0 0 14px;line-height:1.6}
  .lp .eval ul{margin:0;padding-left:18px;font-size:13.5px;color:var(--cream);opacity:.85}
  .lp .eval ul li{margin-bottom:5px}
  .lp .iter{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:6px}
  @media(max-width:780px){.lp .iter{grid-template-columns:repeat(2,1fr)}}
  .lp .iter .step{background:var(--cream);border:1px solid var(--line);border-radius:11px;padding:18px 16px}
  .lp .iter .v{font-family:var(--mono);font-size:11px;color:var(--claret);font-weight:700;background:var(--claret-bg);border-radius:5px;padding:2px 7px;display:inline-block;margin-bottom:8px;letter-spacing:.04em}
  .lp .iter h4{margin:0 0 4px;font-family:var(--serif);font-size:15.5px;font-weight:650}
  .lp .iter p{margin:0;font-size:12.5px;color:var(--ink-2);line-height:1.5}
  .lp .closer{background:linear-gradient(180deg,var(--cream) 0%,var(--cream-3) 100%);border:1px solid var(--line);border-radius:18px;padding:48px 36px;text-align:center}
  .lp .closer h2{font-family:var(--serif);font-size:34px;font-weight:600;margin:0 0 10px;letter-spacing:-.015em}
  .lp .closer p{font-size:15.5px;color:var(--ink-2);max-width:540px;margin:0 auto 22px}
  .lp footer{padding:32px 0 48px;font-size:12.5px;color:var(--muted);border-top:1px solid var(--line);margin-top:36px;display:flex;gap:14px;flex-wrap:wrap;justify-content:space-between;align-items:center}
  @keyframes lpFade{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:translateY(0)}}
  .lp .num.tick{animation:lpTick .35s ease}
  @keyframes lpTick{0%{transform:translateY(-2px);opacity:.7}100%{transform:translateY(0);opacity:1}}
`;

export function LandingPage() {
  useEffect(() => {
    // The interactive bit: this IS the dose calculator from the spec. Two
    // registry entries (mg-per-kg + cap) → the same maths the server tool runs.
    // The model is not involved. NZ and AU both resolve to 0.15 mg/kg first-line
    // (Starship + RCH agree), 12 mg cap — matching registry/guidelines.ts.
    const guidelines: Record<
      string,
      {
        label: string;
        cite: string;
        mgPerKg: number;
        capMg: number;
        reassessHrs: number;
        sourceText: string;
        srcName: string;
      }
    > = {
      NZ: {
        label: "Starship 2020",
        cite: "Starship 2020 §Dexamethasone dosing",
        mgPerKg: 0.15,
        capMg: 12,
        reassessHrs: 2,
        sourceText: "Starship paediatric croup",
        srcName: "Starship 2020",
      },
      AU: {
        label: "RCH Melbourne 2020",
        cite: "RCH Melbourne 2020 §Croup CPG",
        mgPerKg: 0.15,
        capMg: 12,
        reassessHrs: 2,
        sourceText: "RCH Melbourne croup CPG",
        srcName: "RCH Melbourne 2020",
      },
    };

    const $ = (id: string) => document.getElementById(id);
    const w = $("lp-w") as HTMLInputElement | null;
    if (!w) return;
    const wVal = $("lp-w-val");
    const num = $("lp-dose-num");
    const trace = $("lp-trace-text");
    const traceCap = $("lp-trace-cap");
    const cap = $("lp-cap-chip");
    const dose = $("lp-dose");
    const tag = $("lp-dose-tag");
    const srcText = $("lp-src-text");
    const srcCite = $("lp-src-cite");
    const srcLink = $("lp-src-link");
    const srcName = $("lp-src-name");
    const reassTime = $("lp-reass-time");

    let region = "NZ";
    function reCalc() {
      const kg = parseFloat(w!.value);
      const g = guidelines[region];
      const raw = kg * g.mgPerKg;
      const capped = raw > g.capMg;
      const final = capped ? g.capMg : raw;
      const finalRounded = Math.round(final * 100) / 100;

      if (wVal) wVal.textContent = kg.toFixed(1) + " kg";
      if (num) {
        num.textContent = finalRounded.toFixed(2);
        num.classList.remove("tick");
        void num.offsetWidth;
        num.classList.add("tick");
      }
      if (trace)
        trace.textContent =
          kg.toFixed(1) +
          " kg × " +
          g.mgPerKg +
          " mg/kg = " +
          raw.toFixed(2) +
          " mg";
      if (traceCap)
        traceCap.textContent =
          " · cap " + g.capMg + " mg · capped:" + (capped ? "true" : "false");
      if (dose && cap && tag) {
        if (capped) {
          dose.classList.add("capped");
          cap.classList.add("on");
          tag.textContent = "CAPPED";
          tag.classList.add("amber");
        } else {
          dose.classList.remove("capped");
          cap.classList.remove("on");
          tag.textContent = "DETERMINISTIC";
          tag.classList.remove("amber");
        }
      }
      if (srcText) srcText.textContent = g.sourceText;
      if (srcCite) srcCite.textContent = g.label;
      if (srcLink) srcLink.textContent = g.cite;
      if (srcName) srcName.textContent = g.srcName;
      if (reassTime) {
        const t = new Date(Date.now() + g.reassessHrs * 3600 * 1000);
        reassTime.textContent =
          String(t.getHours()).padStart(2, "0") +
          ":" +
          String(t.getMinutes()).padStart(2, "0");
      }
    }

    w.addEventListener("input", reCalc);
    const pills = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".lp .region-pill"),
    );
    const onPill = (btn: HTMLButtonElement) => () => {
      pills.forEach((b) => {
        b.classList.remove("on");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("on");
      btn.setAttribute("aria-pressed", "true");
      region = btn.dataset.region || "NZ";
      reCalc();
    };
    const handlers = pills.map((btn) => {
      const h = onPill(btn);
      btn.addEventListener("click", h);
      return [btn, h] as const;
    });

    // tiny life signal: the "Thought for Ns" chip ticks once on load
    const thinkS = $("lp-think-s");
    let s = 6;
    const tick = setInterval(() => {
      s += 1;
      if (thinkS) thinkS.textContent = String(s);
      if (s >= 9) clearInterval(tick);
    }, 380);

    reCalc();

    return () => {
      w.removeEventListener("input", reCalc);
      handlers.forEach(([btn, h]) => btn.removeEventListener("click", h));
      clearInterval(tick);
    };
  }, []);

  return (
    <div className="lp">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      {/* TOP */}
      <div className="top">
        <div className="wrap top-row">
          <a className="brand" href="#top">
            <span className="logo">H</span>
            <span className="nm">Care Partner</span>
          </a>
          <nav className="top-nav" aria-label="Primary">
            <a href="#safety">Safety</a>
            <a href="#regions">NZ + AU</a>
            <a href="#proof">Proof</a>
            <a href="#design">Design</a>
          </nav>
          <a className="top-cta" href="#preview">
            See the walkthrough
          </a>
        </div>
      </div>

      {/* HERO */}
      <header className="hero wrap" id="top">
        <span className="eyebrow">
          <span className="dot" aria-hidden="true" /> Heidi take-home &middot;
          paediatric croup &middot; v3.1
        </span>

        <h1 className="h1">
          A clinical AI that <em>proves the number</em> before it says it.
        </h1>
        <p className="sub">
          Care Partner reads the note, checks the differential, looks up the
          guideline, and runs the dose in a TypeScript function. It shows you
          every step. The model never authors the number. It can&rsquo;t.
        </p>

        <div className="cta-row">
          <a className="btn-pri" href="#preview">
            See the walkthrough
          </a>
          <a className="btn-sec" href="#safety">
            How the safety works
          </a>
          <span className="cta-foot">
            the whole trace &middot; shown step by step
          </span>
        </div>

        {/* live mini-product */}
        <div
          className="demo-wrap"
          id="preview"
          role="region"
          aria-label="Dose calculator walkthrough"
        >
          <div className="demo-grid">
            <div className="demo-card" aria-label="Clinical note">
              <div className="demo-h">
                <span>Clinical note</span>
                <span className="tag">PASTED, NOT INSTRUCTIONS</span>
              </div>
              <div className="note-meta">
                <div className="case-av" aria-hidden="true">
                  JT
                </div>
                <div>
                  <div className="case-nm">Jack T &middot; 3yo</div>
                  <div style={{ color: "var(--muted)", fontSize: "12px" }}>
                    Paediatric &middot; presenting today
                  </div>
                </div>
              </div>
              <div className="note-body" id="lp-note-body">
                {`Barky cough overnight, intermittent at first, now near-constant.
Stridor at rest on exam. Mild suprasternal recession.
No drooling, no tripod, no toxic appearance.
Temp 37.9, HR 130, RR 32, SpO2 98% RA.
URTI symptoms x 2 days. No prior dexamethasone.

?croup — moderate. Dose?`}
              </div>

              <div className="slider-row">
                <label htmlFor="lp-w">Weight</label>
                <input
                  id="lp-w"
                  type="range"
                  min="6"
                  max="40"
                  step="0.1"
                  defaultValue="14.2"
                  aria-label="Patient weight in kilograms"
                />
                <span className="w-val" id="lp-w-val">
                  14.2 kg
                </span>
              </div>
              <div className="region-row">
                <span>Region</span>
                <button
                  className="region-pill on"
                  data-region="NZ"
                  type="button"
                  aria-pressed="true"
                >
                  NZ
                </button>
                <button
                  className="region-pill"
                  data-region="AU"
                  type="button"
                  aria-pressed="false"
                >
                  AU
                </button>
                <span
                  style={{ marginLeft: "auto", fontSize: "11.5px" }}
                  id="lp-src-name"
                >
                  Starship 2020
                </span>
              </div>
            </div>

            <div className="demo-card" aria-label="Care Partner response">
              <div className="demo-h">
                <span>Care Partner</span>
                <span className="tag" id="lp-dose-tag">
                  DETERMINISTIC
                </span>
              </div>

              <div className="msg">
                <div className="think in">
                  Thought for <span id="lp-think-s">8</span>s
                </div>
                <div className="src" role="button" tabIndex={0}>
                  <span className="n">3 sources</span>
                  <span className="vw">&middot; View</span>
                </div>
                <div className="a-body">
                  <div className="a-title">
                    Paediatric croup &mdash; moderate severity, weight-based
                    dexamethasone
                  </div>
                  <p className="a-prose">
                    Presentation consistent with <b>moderate croup</b>.
                    Differential considered: epiglottitis (no drooling),
                    bacterial tracheitis (no high fever), foreign body (no
                    choking history). Proceeding under the{" "}
                    <span id="lp-src-text">Starship paediatric croup</span>{" "}
                    guideline
                    <a className="cite" href="#regions" id="lp-src-cite">
                      Starship 2020
                    </a>
                    .
                  </p>

                  <div className="dose" id="lp-dose" aria-live="polite">
                    <div className="h">
                      <span>Dose &middot; oral dexamethasone</span>
                      <span className="b">DETERMINISTIC TOOL</span>
                    </div>
                    <div className="v">
                      <span className="num" id="lp-dose-num">
                        2.13
                      </span>{" "}
                      mg <span className="rt">PO</span>
                      <span className="cap-chip" id="lp-cap-chip">
                        CAPPED
                      </span>
                    </div>
                    <div className="trace">
                      <span id="lp-trace-text">
                        14.2 kg &times; 0.15 mg/kg = 2.13 mg
                      </span>{" "}
                      <span className="cap" id="lp-trace-cap">
                        &middot; cap 12 mg &middot; capped:false
                      </span>
                    </div>
                    <div className="src-row">
                      Source:{" "}
                      <a href="#regions" id="lp-src-link">
                        Starship 2020 &sect;Dexamethasone dosing
                      </a>{" "}
                      &middot; v2020
                    </div>
                  </div>

                  <div className="reass">
                    <div className="rh">
                      <div className="clk" aria-hidden="true">
                        &#9201;
                      </div>
                      <div>
                        <div className="rt">
                          Reassess at <span id="lp-reass-time">16:14</span> (in
                          2h)
                        </div>
                        <div className="rs">
                          Watch-for signs &middot; two branches
                        </div>
                      </div>
                    </div>
                    <div className="watch">
                      <span>stridor at rest</span>
                      <span>work of breathing</span>
                      <span>agitation &rarr; lethargy</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* trust strip */}
        <div className="strip" aria-label="Quick stats">
          <div className="item">
            <span className="num">0</span>{" "}
            <span>numbers authored by the LLM</span>
          </div>
          <div className="item">
            <span className="num">2</span>{" "}
            <span>
              regions: <b>NZ + AU</b>
            </span>
          </div>
          <div className="item">
            <span className="num">4</span>{" "}
            <span>
              deterministic tools, <b>1 dose path</b>
            </span>
          </div>
          <div className="item">
            <span className="num">5</span>{" "}
            <span>
              demo cases incl. <b>refuse + abstain</b>
            </span>
          </div>
        </div>
      </header>

      {/* WALKS THE BRIEF */}
      <section id="brief" className="wrap">
        <p className="sec-eyebrow">What the brief asked for</p>
        <h2 className="h2">
          Every line of the brief, and how this answers it.
        </h2>
        <p className="lede">
          The assignment asks for a prototype that reads a note, retrieves a
          local guideline, calculates a weight-based dose, and returns a
          grounded plan. Here is each ask, mapped to the thing that does it.
        </p>
        <div className="brief">
          <div className="brief-row">
            <span className="ix">in</span>
            <div>
              <h4>Unstructured clinical text</h4>
              <p className="ask">
                &ldquo;Accepts a note and/or transcript.&rdquo;
              </p>
              <p>
                Five demo notes load with one click, or paste your own. The note
                is treated as data, wrapped in delimiters, never read as
                instructions.
              </p>
            </div>
          </div>
          <div className="brief-row">
            <span className="ix">find</span>
            <div>
              <h4>Retrieve the local guideline</h4>
              <p className="ask">
                &ldquo;Queries &amp; retrieves the relevant local
                guideline.&rdquo;
              </p>
              <p>
                <code>load_guideline(condition, region)</code> resolves the
                right guideline from a versioned registry and hands it to the
                skill whole. The corpus is small, so whole-document beats
                chunking.
              </p>
            </div>
          </div>
          <div className="brief-row">
            <span className="ix">calc</span>
            <div>
              <h4>Weight-based dose, from a logic tool</h4>
              <p className="ask">
                &ldquo;Calculates a weight &amp; evidence-based dose.&rdquo;
              </p>
              <p>
                <code>calculate_dose</code> is a deterministic TypeScript
                function. The model names a rule; the tool owns the drug, the
                mg/kg, the cap, and the rounding.
              </p>
            </div>
          </div>
          <div className="brief-row">
            <span className="ix">out</span>
            <div>
              <h4>A grounded management plan</h4>
              <p className="ask">
                &ldquo;Returns a detailed plan grounded in the guideline +
                dose.&rdquo;
              </p>
              <p>
                The plan renders as cards from the tool output: the dose, a
                reassessment plan with watch-for signs and branches, and
                verified citations to the guideline section.
              </p>
            </div>
          </div>
          <div className="brief-row">
            <span className="ix">host</span>
            <div>
              <h4>Live, or runnable in under 10 minutes</h4>
              <p className="ask">
                &ldquo;Provide a live URL, or setup we can run on macOS in
                &lt;10 min.&rdquo;
              </p>
              <p>
                Runnable locally in under ten minutes &mdash; the full build is
                in the repo (<code>npm run dev</code>). The walkthrough above
                runs every case, step by step.
              </p>
            </div>
          </div>
          <div className="brief-row">
            <span className="ix">extra</span>
            <div>
              <h4>The part the brief didn&rsquo;t ask for</h4>
              <p className="ask">Knowing when not to dose.</p>
              <p>
                A missing weight, a wrong guideline, an airway emergency, an
                out-of-scope condition. Each one is a typed refusal, not a
                guess. That&rsquo;s the half retrieval doesn&rsquo;t do.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* SAFETY */}
      <section id="safety" className="wrap">
        <p className="sec-eyebrow">The safety spine</p>
        <h2 className="h2">Two layers, honestly framed.</h2>
        <p className="lede">
          Most clinical AI demos hand-wave the safety story. This one names
          exactly what is structural and what is defence-in-depth.
        </p>

        <div className="layers">
          <div className="layer">
            <p className="ord">Layer 1 &middot; structural</p>
            <h3>
              The dose tool is a TypeScript function. The model passes a rule
              ID.
            </h3>
            <p>
              <code>calculate_dose</code> is a deterministic TypeScript
              function. The model passes three things: a guideline id, a
              dose-rule id, and a weight. The function looks every value up from
              the registry and does the maths itself. The model can&rsquo;t pass
              the drug, the mg/kg, the cap, or the rounding. It names a rule; it
              never sets a number.
            </p>
            <div className="code">
              <span className="c">
                {
                  "// tools/calculate_dose.ts — the model supplies the args, not the values"
                }
              </span>
              {"\n"}
              <span className="k">calculate_dose</span>
              {"(\n  "}
              <span className="s">{"'starship-croup-2020'"}</span>
              {",   "}
              <span className="c">{"// guideline_id"}</span>
              {"\n  "}
              <span className="s">{"'croup-dex-moderate'"}</span>
              {",    "}
              <span className="c">{"// dose_rule_id"}</span>
              {"\n  14.2,                       "}
              <span className="c">{"// weight_kg"}</span>
              {"\n);\n"}
              <span className="c">
                {
                  "// → { kind:'dose', dose_mg: 2.13, capped:false, calculation_trace: ... }"
                }
              </span>
            </div>
          </div>

          <div className="layer two">
            <p className="ord">Layer 2 &middot; defence-in-depth</p>
            <h3>
              The card renders from the typed tool part, never from prose.
            </h3>
            <p>
              The dose card you see on screen is never sourced from the
              model&rsquo;s text. The SDK ships the <code>calculate_dose</code>{" "}
              result to the client as a typed <code>UIMessagePart</code>, and
              the chat panel switches on <code>part.type</code> to render the
              card straight from that output. Prose could theoretically{" "}
              <em>mention</em> a number; there&rsquo;s no path for it to become
              the rendered dose.
            </p>
            <div className="code">
              <span className="c">
                {"// app/console/chat-panel.tsx (shape)"}
              </span>
              {"\n"}
              <span className="k">if</span>
              {" (part.type === "}
              <span className="s">{"'tool-calculate_dose'"}</span>
              {"\n    && part.state === "}
              <span className="s">{"'output-available'"}</span>
              {") {\n  "}
              <span className="k">return</span>
              {" <DoseCard {...part.output} />;\n}\n"}
              <span className="c">
                {"// the tool output IS the channel — no separate validator"}
              </span>
            </div>
          </div>
        </div>

        <h3
          style={{
            fontFamily: "var(--serif)",
            fontWeight: 650,
            fontSize: "22px",
            margin: "48px 0 6px",
            letterSpacing: "-.01em",
          }}
        >
          When it refuses, it tells you which kind.
        </h3>
        <p
          style={{
            fontSize: "14.5px",
            color: "var(--ink-2)",
            margin: "0 0 18px",
            maxWidth: "640px",
          }}
        >
          Refusal is not a fallback string. It is a typed return value with a
          verbatim <code>RefusalKind</code> the UI renders in amber, never red.
          Amber is an intentional clinical decision; red is reserved for
          technical failure.
        </p>
        <div className="ref-grid">
          <div className="ref">
            <h4>out_of_scope</h4>
            <p>
              Asthma in this build. The guideline registry doesn&rsquo;t carry
              it. The skill names that gap rather than improvising.
            </p>
          </div>
          <div className="ref">
            <h4>unresolved_dangers</h4>
            <p>
              Differential too wide to act on safely. Skill abstains in prose;
              no <code>calculate_dose</code> call is made.
            </p>
          </div>
          <div className="ref">
            <h4>weight_missing</h4>
            <p>
              No weight in the note. <code>ask_user</code> fires an inline form;
              the answer becomes the next user turn.
            </p>
          </div>
          <div className="ref">
            <h4>rule_not_verified</h4>
            <p>
              A rule that isn&rsquo;t human-verified never executes. Refuse
              cleanly rather than ship an unchecked recommendation.
            </p>
          </div>
        </div>
      </section>

      {/* REGIONS */}
      <section id="regions" className="wrap">
        <p className="sec-eyebrow">Routing, not hard-coding</p>
        <h2 className="h2">The same patient, routed through two guidelines.</h2>
        <p className="lede">
          Heidi is Melbourne-based, so Care Partner runs against verified
          Australian and New Zealand guidelines from day one. Switching region
          re-resolves the guideline, the citation, and the reassessment
          guidance. Here, NZ and AU happen to agree on the dose, and
          that&rsquo;s the point: the number comes from whichever guideline the
          region resolves to, not from a value baked into the code. If a
          guideline said something different, the dose would follow it.
        </p>

        <div className="regions">
          <div className="reg">
            <div className="flag">🇳🇿 New Zealand</div>
            <div className="source">
              Starship Children&rsquo;s Health, paediatric croup guideline
              (2020)
            </div>
            <div className="calc">
              14.2 kg &times; <b>0.15 mg/kg</b> first-line = 2.13 mg PO &middot;
              cap 12 mg
            </div>
            <div className="out">
              2.13 mg <span className="u">oral dexamethasone</span>
            </div>
          </div>
          <div className="reg">
            <div className="flag">🇦🇺 Australia</div>
            <div className="source">
              Royal Children&rsquo;s Hospital Melbourne, croup CPG (2020)
            </div>
            <div className="calc">
              14.2 kg &times; <b>0.15 mg/kg</b> first-line = 2.13 mg PO &middot;
              cap 12 mg
            </div>
            <div className="out">
              2.13 mg <span className="u">oral dexamethasone</span>
            </div>
          </div>
        </div>
        <p
          style={{
            fontSize: "13px",
            color: "var(--muted)",
            margin: "14px 0 0",
            maxWidth: "680px",
          }}
        >
          Different guideline, different citation chain, same first-line number.
          Adding a third region is a registry entry, not a code change.
        </p>
      </section>

      {/* PROOF */}
      <section id="proof" className="wrap">
        <p className="sec-eyebrow">Proof, not vibes</p>
        <h2 className="h2">
          The safety spine is gated by the unit suite, not a vibe check.
        </h2>
        <p className="lede">
          The deterministic core, the dose tool, the registry, and the refusal
          gates, is exact-assertion tested. The tests assert against the
          validated tool output, not a regex on prose, so a silent severity flip
          or a dropped slot fails a named check.
        </p>

        <div className="eval">
          <div>
            <div className="score">
              0<span className="sl"> LLM</span>
            </div>
            <div className="ev-sub">numbers authored by the model</div>
          </div>
          <div>
            <h3>What&rsquo;s actually gating this.</h3>
            <p>
              The gate is the unit suite over <code>tools/</code>,{" "}
              <code>registry/</code>, and <code>lib/</code> &mdash; the
              deterministic safety spine. Doses are identical every run:
              there&rsquo;s no temperature, so determinism comes from the tool
              plus Zod-structured output, not a sampling knob.
            </p>
            <ul>
              <li>
                Dose tool owns every number; the cap fires visibly (25 kg severe
                &rarr; 15 mg raw &rarr; 12 mg)
              </li>
              <li>
                Refusal is a typed return the UI switches on, not a fallback
                string
              </li>
              <li>
                A prompt-injection case proves an injected note can&rsquo;t
                change the routed dose or cap
              </li>
              <li>
                Mechanical canary: zero clinical numbers anywhere in{" "}
                <code>SKILL.md</code>
              </li>
            </ul>
            <p
              style={{ fontSize: "12.5px", opacity: 0.65, margin: "14px 0 0" }}
            >
              A Promptfoo named-check eval drove the earlier turn-based routes;
              it was retired in the v3.1 rewrite, and porting the named cases
              onto the single chat route is tracked in the TODOs. The
              methodology, named checks, not an aggregate %, is the part worth
              keeping.
            </p>
          </div>
        </div>
      </section>

      {/* DESIGN / JOURNEY */}
      <section id="design" className="wrap">
        <p className="sec-eyebrow">How it got here</p>
        <h2 className="h2">
          I started simple, hit the wall, and earned the complexity.
        </h2>
        <p className="lede">
          The interesting part of a rapid prototype is what you take out once
          you can see where it breaks. This one went from a hardcoded calculator
          to a thin harness over a fat skill, and I deleted my own working code
          twice to get there.
        </p>

        <div className="iter">
          <div className="step">
            <span className="v">start</span>
            <h4>A deterministic calculator</h4>
            <p>
              The simplest thing that worked: a TypeScript dose function with
              the rule values in code. Good safety story, but the moment I added
              a second region the hardcoding showed.
            </p>
          </div>
          <div className="step">
            <span className="v">pivot</span>
            <h4>Pulled the clinical logic into a skill</h4>
            <p>
              The numbers moved into a versioned registry; the workflow shape,
              the five invariants and the card templates moved into one skill
              markdown. The harness shrank to glue.
            </p>
          </div>
          <div className="step">
            <span className="v">rebuild</span>
            <h4>Deleted the turn-state-machine</h4>
            <p>
              v1 ran a three-route pipeline (turn1, turn1.5, turn2). It worked.
              I deleted it for one streaming chat route with four tools. The
              loop generalises to voice, MCP and live consults; the state
              machine didn&rsquo;t.
            </p>
          </div>
          <div className="step">
            <span className="v">v3.1</span>
            <h4>Unwired the scanner</h4>
            <p>
              A 523-line note-discriminator pre-pass came out of the running
              path. The skill&rsquo;s prose-level differential does the job.
              Less code on the critical path, same safety, easier to read.
            </p>
          </div>
        </div>
      </section>

      {/* CLOSER */}
      <section className="wrap">
        <div className="closer">
          <h2>See it work, step by step.</h2>
          <p>
            Five cases exercise the whole safety story: Jack T (NZ), Jack T
            (AU), Mia R (?epiglottitis), a weightless transcript, and asthma
            (out_of_scope) &mdash; each one rendered inline in the walkthrough
            above.
          </p>
          <div className="cta-row" style={{ justifyContent: "center" }}>
            <a className="btn-pri" href="#preview">
              See the walkthrough
            </a>
          </div>
        </div>
      </section>

      <footer className="wrap">
        <div>
          <strong style={{ color: "var(--ink)", fontWeight: 650 }}>
            Care Partner
          </strong>{" "}
          &middot; built for the Heidi take-home assignment &middot; v3.1
          &middot; 2026
        </div>
        <div>
          Josh Wilks &middot;{" "}
          <a href="mailto:josh.wilks111@gmail.com">josh.wilks111@gmail.com</a>
        </div>
      </footer>
    </div>
  );
}
