/**
 * The report's stylesheet: an editorial, document-like layout using only
 * system fonts. Constant, developer-authored CSS; never contains repository data.
 */
export const STYLESHEET = `
:root {
  color-scheme: light dark;
  --paper: #fbfaf7;
  --surface: #ffffff;
  --panel: #f4f1eb;
  --ink: #1c1b19;
  --ink-soft: #37352f;
  --muted: #67635b;
  --rule: #e6e2da;
  --rule-strong: #cfc8bb;
  --code-bg: #efebe3;
  --accent: #1f5f5b;
  --highlight: #fff4cf;
  --observed: #2b6549;
  --observed-bg: #e2efe7;
  --documented: #2a5391;
  --documented-bg: #e3eaf6;
  --inferred: #8f530a;
  --inferred-bg: #f6ead6;
  --add: #2b6549;
  --del: #a2392a;
  --serif: "Iowan Old Style", "Palatino Linotype", Palatino, "URW Palladio L", P052, "Book Antiqua", Georgia, serif;
  --sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #141413;
    --surface: #1a1a18;
    --panel: #1c1b19;
    --ink: #edebe6;
    --ink-soft: #d8d5ce;
    --muted: #a39e94;
    --rule: #2c2b28;
    --rule-strong: #45423d;
    --code-bg: #25241f;
    --accent: #7fc3ba;
    --highlight: #3a321a;
    --observed: #93cfac;
    --observed-bg: #1c2c23;
    --documented: #a3bfee;
    --documented-bg: #1c2536;
    --inferred: #e6b872;
    --inferred-bg: #33291a;
    --add: #93cfac;
    --del: #ee9d8c;
  }
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font: 17px/1.62 var(--sans);
  font-kerning: normal;
  text-rendering: optimizeLegibility;
}
.page { max-width: 46rem; margin: 0 auto; padding: 4.5rem 1.5rem 5rem; }
a { color: var(--accent); text-underline-offset: 0.18em; text-decoration-thickness: 1px; }
a:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
code {
  font-family: var(--mono);
  font-size: 0.84em;
  background: var(--code-bg);
  padding: 0.08em 0.32em;
  border-radius: 4px;
  overflow-wrap: anywhere;
}
.skip { position: absolute; left: -9999px; top: 1rem; background: var(--surface); padding: 0.5rem 0.75rem; }
.skip:focus { left: 1rem; }

.masthead { margin-bottom: 2.5rem; }
.eyebrow {
  margin: 0 0 0.75rem;
  font-size: 0.74rem;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
}
h1 {
  margin: 0;
  font: 600 clamp(2.2rem, 6vw, 3.1rem)/1.08 var(--serif);
  letter-spacing: -0.015em;
  overflow-wrap: anywhere;
}
.lede { margin: 1rem 0 0; font: 1.3rem/1.45 var(--serif); color: var(--ink-soft); }
.meta { display: flex; flex-wrap: wrap; gap: 0.2rem 0; margin: 1.25rem 0 0; font-size: 0.86rem; color: var(--muted); }
.meta > span + span::before { content: "\\00B7"; margin: 0 0.55rem; color: var(--rule-strong); }

.legend { background: var(--panel); border: 1px solid var(--rule); border-radius: 8px; padding: 1rem 1.25rem; margin: 0 0 2rem; font-size: 0.88rem; }
.legend-title { margin: 0 0 0.6rem; font-weight: 600; }
.legend dl { margin: 0; display: grid; gap: 0.4rem; }
.legend dl > div { display: grid; grid-template-columns: 7.2rem 1fr; align-items: baseline; }
.legend dt, .legend dd { margin: 0; }
.legend dd { color: var(--ink-soft); }
.legend-note { margin: 0.7rem 0 0; color: var(--muted); }

.toc { margin: 0 0 1rem; font-size: 0.86rem; }
.toc ol { display: flex; flex-wrap: wrap; gap: 0.35rem 1.1rem; margin: 0; padding: 0; list-style: none; counter-reset: toc; }
.toc li { counter-increment: toc; }
.toc li::before { content: counter(toc, decimal-leading-zero); margin-right: 0.4rem; font-family: var(--mono); font-size: 0.75rem; color: var(--muted); }
.toc a { color: var(--ink-soft); text-decoration: none; }
.toc a:hover { color: var(--accent); text-decoration: underline; }

section { scroll-margin-top: 1rem; }
h2 {
  margin: 3.5rem 0 1.1rem;
  padding-top: 1.1rem;
  border-top: 1px solid var(--rule-strong);
  font: 600 1.65rem/1.25 var(--serif);
  letter-spacing: -0.005em;
}
h3 { margin: 2rem 0 0.6rem; font-size: 1rem; font-weight: 650; letter-spacing: 0.005em; }
h4 { margin: 0.35rem 0 0.4rem; font: 600 1.12rem/1.35 var(--serif); }
p { margin: 0.6rem 0; }
.caption, .method { font-size: 0.88rem; color: var(--muted); }
.empty { color: var(--muted); font-style: italic; }

.level {
  display: inline-block;
  padding: 0.12em 0.5em;
  border-radius: 999px;
  font: 600 0.64rem/1.5 var(--sans);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
  vertical-align: 0.14em;
}
.level-observed { color: var(--observed); background: var(--observed-bg); }
.level-documented { color: var(--documented); background: var(--documented-bg); }
.level-inferred { color: var(--inferred); background: var(--inferred-bg); }

.refs { margin-left: 0.2rem; white-space: nowrap; }
.ref {
  font: 500 0.68rem/1 var(--mono);
  color: var(--muted);
  text-decoration: none;
  vertical-align: 0.4em;
  padding: 0.05rem 0.2rem;
  border-radius: 3px;
}
.ref + .ref { margin-left: 0.1rem; }
.ref:hover { color: var(--accent); background: var(--code-bg); }

.statements, .plain { margin: 0.5rem 0; padding: 0; list-style: none; }
.statements > li, .plain > li { position: relative; padding: 0.3rem 0 0.3rem 1.2rem; }
.statements > li::before, .plain > li::before { content: ""; position: absolute; left: 0.1rem; top: 1.02em; width: 0.5rem; height: 1px; background: var(--rule-strong); }
.limitations { color: var(--ink-soft); font-size: 0.93rem; }

.figures {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
  margin: 0.5rem 0 0;
  border-top: 1px solid var(--ink);
}
.figure { padding: 0.8rem 1rem 0.9rem 0; border-bottom: 1px solid var(--rule); }
.figure dt { font-size: 0.72rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.figure dd { margin: 0.15rem 0 0; }
.figure-value { display: block; font: 500 1.85rem/1.2 var(--serif); font-variant-numeric: lining-nums tabular-nums; }
.figure-note { display: block; font-size: 0.8rem; color: var(--muted); }

.bars { list-style: none; margin: 0.5rem 0; padding: 0; font-size: 0.9rem; }
.bars li { display: grid; grid-template-columns: minmax(6rem, 9rem) 1fr 3rem; gap: 0.75rem; align-items: center; padding: 0.2rem 0; }
.bar { height: 0.45rem; background: var(--rule); border-radius: 999px; overflow: hidden; }
.bar > span { display: block; height: 100%; background: var(--accent); border-radius: 999px; }
.bar-value { text-align: right; font-variant-numeric: tabular-nums; color: var(--muted); }

table.tech { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.tech th, .tech td { text-align: left; vertical-align: top; padding: 0.55rem 0.9rem 0.55rem 0; border-bottom: 1px solid var(--rule); }
.tech thead th { font-size: 0.72rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); font-weight: 600; border-bottom-color: var(--rule-strong); }
.tech tbody th { font-weight: 600; white-space: nowrap; }
.tech .kind { color: var(--muted); white-space: nowrap; }

.timeline { list-style: none; margin: 1.5rem 0 0; padding: 0; }
.milestone { position: relative; padding: 0 0 2.1rem 1.9rem; }
.milestone::before { content: ""; position: absolute; left: 0.34rem; top: 0.55rem; bottom: 0; width: 1px; background: var(--rule-strong); }
.milestone:last-child::before { display: none; }
.milestone::after {
  content: "";
  position: absolute;
  left: 0;
  top: 0.35rem;
  width: 0.72rem;
  height: 0.72rem;
  border: 2px solid var(--accent);
  border-radius: 50%;
  background: var(--paper);
}
.milestone-meta { margin: 0; font: 0.78rem/1.4 var(--mono); color: var(--muted); }
.milestone-id { color: var(--accent); font-weight: 600; margin-right: 0.35rem; }
.milestone h3 { margin: 0.2rem 0 0.2rem; font: 600 1.28rem/1.3 var(--serif); letter-spacing: -0.005em; }
.milestone-stats { margin: 0 0 0.4rem; font-size: 0.84rem; color: var(--muted); font-variant-numeric: tabular-nums; }
.add { color: var(--add); }
.del { color: var(--del); }
details { margin-top: 0.5rem; }
summary { cursor: pointer; font-size: 0.84rem; color: var(--muted); }
.commits { list-style: none; margin: 0.4rem 0 0; padding: 0; font-size: 0.9rem; }
.commits li { display: grid; grid-template-columns: auto 1fr; gap: 0.6rem; padding: 0.18rem 0; }
.commits .more { display: block; color: var(--muted); font-style: italic; }
code.sha { color: var(--accent); background: transparent; padding: 0; font-size: 0.8rem; letter-spacing: 0.02em; }

.decisions { display: grid; gap: 0.9rem; }
.decision {
  background: var(--surface);
  border: 1px solid var(--rule);
  border-left: 3px solid var(--documented);
  border-radius: 6px;
  padding: 0.9rem 1.15rem 0.8rem;
  scroll-margin-top: 1rem;
}
.decision-inferred { border-left-color: var(--inferred); }
.decision header { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.decision-id { font: 600 0.75rem var(--mono); color: var(--muted); }
.decision-date { margin-left: auto; font-size: 0.8rem; color: var(--muted); }
.decision blockquote, .excerpt {
  margin: 0.5rem 0;
  padding: 0.05rem 0 0.05rem 0.85rem;
  border-left: 2px solid var(--rule-strong);
  font: 1rem/1.5 var(--serif);
  color: var(--ink-soft);
  overflow-wrap: anywhere;
}
.basis { margin: 0.4rem 0 0; font-size: 0.84rem; color: var(--muted); }

.selected { display: grid; }
.commit-card { padding: 1rem 0 0.9rem; border-bottom: 1px solid var(--rule); }
.commit-card:first-child { padding-top: 0.25rem; }
.commit-meta { margin: 0; font-size: 0.82rem; color: var(--muted); }
.commit-card h3 { margin: 0.2rem 0; font: 600 1.08rem/1.4 var(--sans); overflow-wrap: anywhere; }
.reasons { margin: 0.3rem 0 0; padding-left: 1.1rem; font-size: 0.88rem; color: var(--ink-soft); }

.evidence { list-style: none; margin: 0.75rem 0 0; padding: 0; }
.evidence > li { padding: 0.75rem 0.5rem 0.75rem 0; border-top: 1px solid var(--rule); scroll-margin-top: 1rem; }
.evidence > li:target { background: var(--highlight); padding-left: 0.6rem; border-radius: 4px; }
.evidence-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin: 0; }
.evidence-id { font: 600 0.8rem var(--mono); }
.evidence-category { font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.evidence-statement { margin: 0.3rem 0 0.15rem; font-size: 0.95rem; }
.evidence-source { margin: 0; font-size: 0.84rem; color: var(--muted); overflow-wrap: anywhere; }
.evidence .excerpt { font-size: 0.9rem; }
.evidence-basis { margin: 0.3rem 0 0; font-size: 0.82rem; color: var(--muted); font-style: italic; }

.colophon { margin-top: 4rem; padding-top: 1rem; border-top: 1px solid var(--rule); font-size: 0.8rem; color: var(--muted); }

@media (max-width: 40rem) {
  body { font-size: 16px; }
  .page { padding: 2.5rem 1.1rem 3.5rem; }
  .lede { font-size: 1.15rem; }
  h2 { margin-top: 2.75rem; font-size: 1.45rem; }
  .legend dl > div { grid-template-columns: 1fr; gap: 0.15rem; }
  .figures { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .figure-value { font-size: 1.5rem; }
  .tech thead { display: none; }
  .tech tr { display: block; padding: 0.6rem 0; border-bottom: 1px solid var(--rule); }
  .tech th, .tech td { display: block; padding: 0; border: 0; }
  .tech tbody th { white-space: normal; }
  .bars li { grid-template-columns: 6rem 1fr 2.5rem; }
}
@media print {
  :root { color-scheme: light; }
  body { background: #fff; font-size: 11pt; }
  .page { max-width: none; padding: 0; }
  .toc, .skip { display: none; }
  a { color: inherit; text-decoration: none; }
  h2 { break-after: avoid; }
  .decision, .commit-card, .evidence > li, .milestone { break-inside: avoid; }
}
`;
