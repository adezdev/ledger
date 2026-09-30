import type { CaseStudy, Decision, Evidence, EvidenceLevel, Statement } from "../domain/model.ts";
import { inlineSegments } from "../domain/statement.ts";
import { formatCount, formatDate, plural } from "../domain/format.ts";
import { MILESTONE_METHOD } from "../synthesis/milestones.ts";
import { escapeMarkdown, markdownCode } from "./escape.ts";
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

/** Statement text (with backtick code spans) as safe inline Markdown. */
function inline(text: string, inTable = false): string {
  return inlineSegments(text)
    .map((segment) => (segment.code ? markdownCode(segment.text, inTable) : escapeMarkdown(segment.text)))
    .join("");
}

function refs(ids: readonly string[]): string {
  if (ids.length === 0) return "";
  return ` <sup>${ids.map((id) => `[${id}](#${id.toLowerCase()})`).join(" ")}</sup>`;
}

function levelTag(level: EvidenceLevel, omitObserved = true): string {
  return omitObserved && level === "observed" ? "" : ` _(${level})_`;
}

function statementLine(statement: Statement): string {
  return `${inline(statement.text)}${levelTag(statement.level)}${refs(statement.evidence)}`;
}

export function renderMarkdown(study: CaseStudy): string {
  const out: string[] = [];
  const push = (...lines: string[]): void => {
    out.push(...lines);
  };
  const { title, subtitle } = reportHeadline(study);
  const { project, metrics } = study;
  const commits = indexCommits(study);

  push(`# ${escapeMarkdown(title)}`, "");
  if (project.description) push(`> ${inline(project.description.text)}${refs(project.description.evidence)}`, "");
  const where = [project.branch ? markdownCode(project.branch) : "detached HEAD", `at ${markdownCode(project.headShortSha)}`].join(" ");
  push(`_Engineering case study · ${escapeMarkdown(subtitle)} · ${where}_`, "");
  if (project.homepage) push(`Project link: <${project.homepage.replace(/[<>\s]/g, encodeURIComponent)}>`, "");

  push(
    "**How to read this report.** Every statement carries an evidence level:",
    "",
    ...(["observed", "documented", "inferred"] as const).map((level) => `- **${LEVEL_LABELS[level]}**: ${LEVEL_DEFINITIONS[level]}`),
    "",
    "Unmarked statements are observed. References such as [E1](#e1) point to the [evidence appendix](#evidence).",
    "",
  );

  // Overview ------------------------------------------------------------------
  push("## Overview", "");
  for (const statement of study.overview) push(`- ${statementLine(statement)}`);
  push("");

  // Snapshot -------------------------------------------------------------------
  push("## Project snapshot", "", "| Measure | Value |", "| --- | --- |");
  const rows: [string, string][] = [
    ["Commits analyzed", `${formatCount(metrics.commits)}${commitNotes(metrics).length > 0 ? ` (${commitNotes(metrics).join(", ")})` : ""}`],
    ["Timespan", metrics.timespanDays <= 1 ? `${formatDate(metrics.firstCommitAt)} (1 day)` : `${formatDate(metrics.firstCommitAt)} to ${formatDate(metrics.latestCommitAt)} (${plural(metrics.timespanDays, "day")}, ${formatCount(metrics.activeDays)} active)`],
    ["Contributors", formatCount(metrics.contributors)],
    ["Files tracked at HEAD", formatCount(metrics.trackedFiles)],
    ["Files touched in history", formatCount(metrics.filesTouched)],
    ["Lines added / removed", `+${formatCount(metrics.additions)} / −${formatCount(metrics.deletions)} (excluding lockfiles, binaries${metrics.automatedCommits > 0 ? ", and automated commits" : ""})`],
    ["Test files", formatCount(metrics.testFiles)],
    ["CI configurations", formatCount(metrics.ciConfigurations)],
    ["Documentation files", formatCount(metrics.documentationFiles)],
  ];
  for (const [label, value] of rows) push(`| ${label} | ${escapeMarkdown(value)} |`);
  push("");

  if (study.technologies.length > 0) {
    push("### Technologies", "");
    for (const technology of study.technologies) {
      push(`- **${escapeMarkdown(technology.name)}** (${technology.kind.replace("-", " ")})${levelTag(technology.level)}: ${inline(technology.basis)}${refs(technology.evidence)}`);
    }
    push("");
  }

  // Timeline ---------------------------------------------------------------------
  push("## Engineering timeline", "", `_${escapeMarkdown(MILESTONE_METHOD)}_`, "");
  if (metrics.automatedCommits > 0 && metrics.automatedCommits < metrics.commits) {
    push(`_${escapeMarkdown(automatedNote(metrics))}_`, "");
  }
  for (const milestone of study.timeline) {
    const span = formatDate(milestone.startAt) === formatDate(milestone.endAt) ? formatDate(milestone.startAt) : `${formatDate(milestone.startAt)} – ${formatDate(milestone.endAt)}`;
    push(`### ${milestone.id} · ${inline(milestone.title)}`, "");
    push(`**${escapeMarkdown(span)}** · ${plural(milestone.commits.length, "commit")} · +${formatCount(milestone.additions)} −${formatCount(milestone.deletions)}${refs(milestone.evidence)}`, "");
    push(inline(milestone.summary.text), "");
    const shown = milestone.commits.slice(0, MAX_COMMITS_PER_MILESTONE);
    for (const sha of shown) {
      const commit = commits.get(sha);
      if (commit) push(`- ${markdownCode(commit.shortSha)} ${inline(commit.subject)}`);
    }
    if (milestone.commits.length > shown.length) push(`- …and ${formatCount(milestone.commits.length - shown.length)} more (listed in \`report.json\`)`);
    push("");
  }

  // Decisions ----------------------------------------------------------------------
  push("## Technical decisions", "");
  const { documented, inferred } = decisionGroups(study.decisions);
  if (study.decisions.length === 0) push("_Ledger found no documented or inferable decisions in the available evidence._", "");
  if (documented.length > 0) {
    push("### Documented", "", "_Stated explicitly in project documentation, commit messages, or supplied sessions._", "");
    for (const decision of documented) push(...decisionBlock(decision));
  }
  if (inferred.length > 0) {
    push("### Inferred", "", "_Ledger's reading of the history. No document states these decisions; verify before relying on them._", "");
    for (const decision of inferred) push(...decisionBlock(decision));
  }

  // Findings ------------------------------------------------------------------------
  push("## Engineering evidence", "");
  const groups = groupFindings(study.findings);
  if (groups.length === 0) push("_No test, CI, type-checking, or documentation artifacts were detected._", "");
  for (const [area, findings] of groups) {
    push(`### ${AREA_TITLES[area]}`, "");
    for (const finding of findings) push(`- ${statementLine(finding.statement)}`);
    push("");
  }

  // Selected commits ----------------------------------------------------------------
  if (study.selectedCommits.length > 0) {
    push("## Selected commits", "");
    for (const commit of study.selectedCommits) {
      push(`### ${markdownCode(commit.shortSha)} ${inline(commit.subject)}`, "");
      const meta = [formatDate(commit.authoredAt), plural(commit.filesChanged, "file"), `+${formatCount(commit.additions)} −${formatCount(commit.deletions)}`, commit.milestone ? `milestone ${commit.milestone}` : ""].filter(Boolean);
      push(`${escapeMarkdown(meta.join(" · "))}${refs(commit.evidence)}`, "");
      for (const reason of commit.reasons) push(`- ${inline(reason)}`);
      push("");
    }
  }

  // Limitations ----------------------------------------------------------------------
  push("## Limitations", "");
  for (const limitation of study.limitations) push(`- ${inline(limitation)}`);
  push("");

  // Evidence ---------------------------------------------------------------------------
  push("## Evidence", "", "| ID | Level | Statement | Source |", "| --- | --- | --- | --- |");
  for (const evidence of study.evidence) push(evidenceRow(evidence));
  push("");

  push("---", "", `_Generated by Ledger ${escapeMarkdown(study.generator.version)} from ${markdownCode(project.headShortSha)}. Ledger read Git metadata and selected tracked files; it did not execute any code from this repository._`, "");
  return out.join("\n");
}

function decisionBlock(decision: Decision): string[] {
  const lines = [`#### ${decision.id} · ${inline(decision.title)}`, ""];
  if (decision.detail) lines.push(`> ${inline(decision.detail)}`, "");
  const date = decision.date ? ` · ${formatDate(decision.date)}` : "";
  const label = decision.status === "inferred" ? "Inferred from" : "Source";
  lines.push(`${label}: ${inline(decision.basis)}${escapeMarkdown(date)}${refs(decision.evidence)}`, "");
  return lines;
}

function evidenceRow(evidence: Evidence): string {
  const excerpt = excerptOf(evidence.source);
  const details = [inline(describeSource(evidence.source), true), excerpt ? `“${inline(excerpt.length > 200 ? `${excerpt.slice(0, 199)}…` : excerpt, true)}”` : "", evidence.basis ? `_Basis: ${inline(evidence.basis, true)}_` : ""].filter(Boolean);
  return `| <a id="${evidence.id.toLowerCase()}"></a>${evidence.id} | ${LEVEL_LABELS[evidence.level]} | ${inline(evidence.statement, true)} | ${details.join("<br>")} |`;
}
