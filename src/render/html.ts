import type { CaseStudy, Decision, Evidence, EvidenceLevel, Milestone, SelectedCommit, Statement } from "../domain/model.ts";
import { inlineSegments } from "../domain/statement.ts";
import { formatCount, formatDate, isoDate, plural } from "../domain/format.ts";
import { MILESTONE_METHOD } from "../synthesis/milestones.ts";
import { html, type SafeHtml, trustedHtml } from "./escape.ts";
import { STYLESHEET } from "./html-styles.ts";
import {
  AREA_TITLES,
  decisionGroups,
  describeSource,
  excerptOf,
  groupFindings,
  indexCommits,
  LEVEL_DEFINITIONS,
  LEVEL_LABELS,
  MAX_COMMITS_PER_MILESTONE,
  automatedNote,
  commitNotes,
  reportHeadline,
} from "./shared.ts";

/** Statement text with backtick code spans rendered as <code>. */
function inline(text: string): SafeHtml {
  return html`${inlineSegments(text).map((segment) => (segment.code ? html`<code>${segment.text}</code>` : html`${segment.text}`))}`;
}

function refs(ids: readonly string[]): SafeHtml {
  if (ids.length === 0) return html``;
  return html`<span class="refs">${ids.map((id) => html`<a class="ref" href="#${id.toLowerCase()}" aria-label="Evidence ${id}">${id}</a>`)}</span>`;
}

function badge(level: EvidenceLevel): SafeHtml {
  return html`<span class="level level-${level}">${LEVEL_LABELS[level]}</span>`;
}

function statementBody(statement: Statement, showObserved = false): SafeHtml {
  return html`${statement.level !== "observed" || showObserved ? html`${badge(statement.level)} ` : ""}${inline(statement.text)}${refs(statement.evidence)}`;
}

function dateTime(timestamp: string, label = formatDate(timestamp)): SafeHtml {
  return html`<time datetime="${isoDate(timestamp)}">${label}</time>`;
}

export function renderHtml(study: CaseStudy): string {
  const { title, subtitle } = reportHeadline(study);
  const { project, metrics } = study;
  const sections: { id: string; title: string; body: SafeHtml | null }[] = [
    { id: "overview", title: "Overview", body: overviewSection(study) },
    { id: "snapshot", title: "Snapshot", body: snapshotSection(study) },
    { id: "timeline", title: "Timeline", body: timelineSection(study) },
    { id: "decisions", title: "Decisions", body: decisionsSection(study) },
    { id: "evidence-of-practice", title: "Engineering evidence", body: findingsSection(study) },
    { id: "selected-commits", title: "Selected commits", body: study.selectedCommits.length > 0 ? selectedCommitsSection(study.selectedCommits) : null },
    { id: "limitations", title: "Limitations", body: html`<ul class="plain limitations">${study.limitations.map((item) => html`<li>${inline(item)}</li>`)}</ul>` },
    { id: "evidence", title: "Evidence", body: evidenceSection(study.evidence) },
  ];
  const visible = sections.filter((section): section is { id: string; title: string; body: SafeHtml } => section.body !== null);

  const document = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<meta name="color-scheme" content="light dark">
<meta name="generator" content="Ledger ${study.generator.version}">
<meta name="referrer" content="no-referrer">
${project.description ? html`<meta name="description" content="${project.description.text}">` : ""}
<title>${title} · Engineering case study</title>
<style>${trustedHtml(STYLESHEET)}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="page">
<header class="masthead">
<p class="eyebrow">Engineering case study</p>
<h1>${title}</h1>
${project.description ? html`<p class="lede">${inline(project.description.text)}${refs(project.description.evidence)}</p>` : ""}
<p class="meta">
<span>${subtitle}</span>
<span>${project.branch ? html`<code>${project.branch}</code>` : "detached HEAD"} at <code>${project.headShortSha}</code></span>
<span>${plural(metrics.commits, "commit")}</span>
${project.version ? html`<span>v${project.version}</span>` : ""}
${project.homepage ? html`<span><a href="${project.homepage}" rel="noopener noreferrer">${displayUrl(project.homepage)}</a></span>` : ""}
</p>
</header>
<aside class="legend" aria-label="Evidence levels">
<p class="legend-title">How to read this report</p>
<dl>
${(["observed", "documented", "inferred"] as const).map((level) => html`<div><dt>${badge(level)}</dt><dd>${capitalize(LEVEL_DEFINITIONS[level])}</dd></div>`)}
</dl>
<p class="legend-note">Unlabeled statements are observed. Links such as <a class="ref" href="#e1">E1</a> lead to the evidence appendix.</p>
</aside>
<nav class="toc" aria-label="Sections">
<ol>${visible.map((section) => html`<li><a href="#${section.id}">${section.title}</a></li>`)}</ol>
</nav>
<main id="main">
${visible.map((section) => html`<section id="${section.id}" aria-labelledby="${section.id}-title">
<h2 id="${section.id}-title">${section.title}</h2>
${section.body}
</section>
`)}
</main>
<footer class="colophon">
<p>Generated by Ledger ${study.generator.version} from <code>${project.headShortSha}</code>. Ledger read Git metadata and selected tracked files; it did not execute any code from this repository and made no network requests.</p>
</footer>
</div>
</body>
</html>
`;
  return document.value;
}

function overviewSection(study: CaseStudy): SafeHtml {
  return html`<ul class="statements">${study.overview.map((statement) => html`<li>${statementBody(statement)}</li>`)}</ul>`;
}

function snapshotSection(study: CaseStudy): SafeHtml {
  const { metrics } = study;
  const figures: { label: string; value: string; note?: string }[] = [
    { label: "Commits", value: formatCount(metrics.commits), ...(commitNotes(metrics).length > 0 ? { note: commitNotes(metrics).join(", ") } : {}) },
    { label: "Timespan", value: plural(metrics.timespanDays, "day"), note: `${formatCount(metrics.activeDays)} active` },
    { label: "Contributors", value: formatCount(metrics.contributors) },
    { label: "Files at HEAD", value: formatCount(metrics.trackedFiles), note: `${formatCount(metrics.filesTouched)} touched in history` },
    { label: "Lines added", value: `+${formatCount(metrics.additions)}`, note: `−${formatCount(metrics.deletions)} removed` },
    { label: "Test files", value: formatCount(metrics.testFiles) },
    { label: "CI configs", value: formatCount(metrics.ciConfigurations) },
    { label: "Docs files", value: formatCount(metrics.documentationFiles) },
  ];
  const range =
    formatDate(metrics.firstCommitAt) === formatDate(metrics.latestCommitAt)
      ? html`All commits on ${dateTime(metrics.firstCommitAt)}.`
      : html`First commit ${dateTime(metrics.firstCommitAt)}; latest ${dateTime(metrics.latestCommitAt)}.`;

  const languages = metrics.languages.filter((language) => language.share >= 0.005).slice(0, 6);
  return html`<dl class="figures">${figures.map(
    (figure) => html`<div class="figure"><dt>${figure.label}</dt><dd><span class="figure-value">${figure.value}</span>${figure.note ? html`<span class="figure-note">${figure.note}</span>` : ""}</dd></div>`,
  )}</dl>
<p class="caption">${range} Line counts exclude lockfiles, binary files, merge commits${study.metrics.automatedCommits > 0 ? ", and automated commits" : ""}.</p>
${languages.length > 0 ? html`<h3>Language mix</h3>
<p class="caption">${badge("inferred")} Share of source bytes at HEAD, classified by file extension.</p>
<ul class="bars">${languages.map((language) => {
    const percent = Math.max(0.5, Math.round(language.share * 1000) / 10);
    return html`<li><span class="bar-label">${language.language}</span><span class="bar" aria-hidden="true"><span style="width:${percent.toFixed(1)}%"></span></span><span class="bar-value">${language.share < 0.01 ? "<1" : Math.round(language.share * 100)}%</span></li>`;
  })}</ul>` : ""}
${study.technologies.length > 0 ? html`<h3>Technologies</h3>
<table class="tech">
<thead><tr><th scope="col">Technology</th><th scope="col">Kind</th><th scope="col">Basis</th></tr></thead>
<tbody>${study.technologies.map(
    (technology) => html`<tr><th scope="row">${technology.name}</th><td class="kind">${technology.kind.replace("-", " ")}</td><td>${technology.level !== "observed" ? html`${badge(technology.level)} ` : ""}${inline(technology.basis)}${refs(technology.evidence)}</td></tr>`,
  )}</tbody>
</table>` : ""}`;
}

function timelineSection(study: CaseStudy): SafeHtml {
  const commits = indexCommits(study);
  const item = (milestone: Milestone): SafeHtml => {
    const shown = milestone.commits.slice(0, MAX_COMMITS_PER_MILESTONE);
    const hidden = milestone.commits.length - shown.length;
    const span = formatDate(milestone.startAt) === formatDate(milestone.endAt) ? dateTime(milestone.startAt) : html`${dateTime(milestone.startAt)} – ${dateTime(milestone.endAt)}`;
    return html`<li class="milestone">
<p class="milestone-meta"><span class="milestone-id">${milestone.id}</span> ${span}</p>
<h3>${inline(milestone.title)}</h3>
<p class="milestone-stats">${plural(milestone.commits.length, "commit")} · <span class="add">+${formatCount(milestone.additions)}</span> <span class="del">−${formatCount(milestone.deletions)}</span> · ${plural(milestone.filesChanged, "file")}${refs(milestone.evidence)}</p>
<p>${inline(milestone.summary.text)}</p>
<details${milestone.commits.length <= 6 ? html` open` : ""}>
<summary>${milestone.commits.length === 1 ? "Commit" : `${formatCount(milestone.commits.length)} commits`}</summary>
<ul class="commits">${shown.map((sha) => {
      const commit = commits.get(sha);
      return commit ? html`<li><code class="sha">${commit.shortSha}</code> <span>${inline(commit.subject)}</span></li>` : "";
    })}${hidden > 0 ? html`<li class="more">…and ${formatCount(hidden)} more, listed in report.json</li>` : ""}</ul>
</details>
</li>`;
  };
  const automated = study.metrics.automatedCommits > 0 && study.metrics.automatedCommits < study.metrics.commits;
  return html`<p class="method">${badge("inferred")} ${MILESTONE_METHOD}</p>
${automated ? html`<p class="caption">${automatedNote(study.metrics)}</p>` : ""}
<ol class="timeline">${study.timeline.map(item)}</ol>`;
}

function decisionsSection(study: CaseStudy): SafeHtml {
  const { documented, inferred } = decisionGroups(study.decisions);
  if (study.decisions.length === 0) return html`<p class="empty">Ledger found no documented or inferable decisions in the available evidence.</p>`;
  return html`${documented.length > 0 ? html`<h3>Documented</h3>
<p class="caption">Stated explicitly in project documentation, commit messages, or supplied sessions.</p>
<div class="decisions">${documented.map(decisionCard)}</div>` : ""}
${inferred.length > 0 ? html`<h3>Inferred</h3>
<p class="caption">Ledger's reading of the history. No document states these decisions; verify before relying on them.</p>
<div class="decisions">${inferred.map(decisionCard)}</div>` : ""}`;
}

function decisionCard(decision: Decision): SafeHtml {
  return html`<article class="decision decision-${decision.status}" id="${decision.id.toLowerCase()}">
<header><span class="decision-id">${decision.id}</span>${badge(decision.status)}${decision.date ? html`<span class="decision-date">${dateTime(decision.date)}</span>` : ""}</header>
<h4>${inline(decision.title)}</h4>
${decision.detail ? html`<blockquote>${inline(decision.detail)}</blockquote>` : ""}
<p class="basis">${decision.status === "inferred" ? "Inferred from " : "Source: "}${inline(decision.basis)}${refs(decision.evidence)}</p>
</article>`;
}

function findingsSection(study: CaseStudy): SafeHtml {
  const groups = groupFindings(study.findings);
  if (groups.length === 0) return html`<p class="empty">No test, CI, type-checking, or documentation artifacts were detected.</p>`;
  return html`<p class="caption">What the repository contains, stated precisely. Ledger did not run anything, so none of this claims that checks pass.</p>
${groups.map(([area, findings]) => html`<h3>${AREA_TITLES[area]}</h3>
<ul class="statements">${findings.map((finding) => html`<li>${statementBody(finding.statement)}</li>`)}</ul>`)}`;
}

function selectedCommitsSection(selected: readonly SelectedCommit[]): SafeHtml {
  return html`<p class="caption">A few commits that show how the work was done, chosen by message detail, size, and whether tests changed with the code.</p>
<div class="selected">${selected.map(
    (commit) => html`<article class="commit-card">
<p class="commit-meta"><code class="sha">${commit.shortSha}</code> ${dateTime(commit.authoredAt)}${commit.milestone ? html` · <a href="#timeline">${commit.milestone}</a>` : ""}</p>
<h3>${inline(commit.subject)}</h3>
<p class="milestone-stats">${plural(commit.filesChanged, "file")} · <span class="add">+${formatCount(commit.additions)}</span> <span class="del">−${formatCount(commit.deletions)}</span>${refs(commit.evidence)}</p>
<ul class="reasons">${commit.reasons.map((reason) => html`<li>${inline(reason)}</li>`)}</ul>
</article>`,
  )}</div>`;
}

function evidenceSection(evidence: readonly Evidence[]): SafeHtml {
  return html`<p class="caption">Every reference in this report resolves to an entry below, with enough provenance to check it against the repository.</p>
<ol class="evidence">${evidence.map((item) => {
    const excerpt = excerptOf(item.source);
    return html`<li id="${item.id.toLowerCase()}">
<p class="evidence-head"><span class="evidence-id">${item.id}</span>${badge(item.level)}<span class="evidence-category">${item.category}</span></p>
<p class="evidence-statement">${inline(item.statement)}</p>
<p class="evidence-source">${inline(describeSource(item.source))}</p>
${excerpt ? html`<blockquote class="excerpt">${excerpt}</blockquote>` : ""}
${item.basis ? html`<p class="evidence-basis">Basis: ${inline(item.basis)}</p>` : ""}
</li>`;
  })}</ol>`;
}

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
