import type { CaseStudy, CommitSummary, Decision, ProjectMetrics, EvidenceLevel, EvidenceSource, Finding, FindingArea } from "../domain/model.ts";
import { code } from "../domain/statement.ts";
import { formatCount, formatDate, plural } from "../synthesis/format.ts";

/** Vocabulary shared by the Markdown and HTML renderers, so both say the same thing. */

export const LEVEL_LABELS: Record<EvidenceLevel, string> = {
  observed: "Observed",
  documented: "Documented",
  inferred: "Inferred",
};

export const LEVEL_DEFINITIONS: Record<EvidenceLevel, string> = {
  observed: "read directly from Git history or tracked files.",
  documented: "stated by the project's own documentation, metadata, or commit messages, or by a supplied development session.",
  inferred: "derived by Ledger's heuristics. An interpretation, not a fact.",
};

export const AREA_TITLES: Record<FindingArea, string> = {
  testing: "Testing",
  ci: "Continuous integration",
  types: "Type checking",
  linting: "Linting and formatting",
  build: "Build and packaging",
  benchmarks: "Benchmarks",
  documentation: "Documentation",
  release: "Releases",
  process: "Commit practice",
  session: "Development sessions",
};

const AREA_ORDER: FindingArea[] = ["testing", "ci", "types", "linting", "build", "benchmarks", "documentation", "release", "process", "session"];

export function groupFindings(findings: readonly Finding[]): [FindingArea, Finding[]][] {
  return AREA_ORDER.map((area): [FindingArea, Finding[]] => [area, findings.filter((finding) => finding.area === area)]).filter(([, group]) => group.length > 0);
}

export function decisionGroups(decisions: readonly Decision[]): { documented: Decision[]; inferred: Decision[] } {
  return {
    documented: decisions.filter((decision) => decision.status === "documented"),
    inferred: decisions.filter((decision) => decision.status === "inferred"),
  };
}

/** A one-line, human-readable pointer to where evidence came from. May contain code spans. */
export function describeSource(source: EvidenceSource): string {
  switch (source.kind) {
    case "commit": {
      const files = source.files && source.files.length > 0 ? `; ${source.files.slice(0, 3).map(code).join(", ")}${source.files.length > 3 ? ` and ${source.files.length - 3} more` : ""}` : "";
      return `Commit ${code(source.shortSha)} (${source.date})${files}`;
    }
    case "commit-range":
      return source.count === 1
        ? `Commit ${code(source.firstSha.slice(0, 7))}`
        : `${source.count} commits, ${code(source.firstSha.slice(0, 7))} to ${code(source.lastSha.slice(0, 7))}`;
    case "file": {
      const where = [source.line ? `line ${source.line}` : "", source.section ? `“${source.section}”` : ""].filter(Boolean).join(", ");
      return `${code(source.path)}${where ? `, ${where}` : ""}`;
    }
    case "file-set": {
      const shown = source.paths.slice(0, 4).map(code).join(", ");
      const more = source.total > Math.min(4, source.paths.length) ? `, and ${source.total - Math.min(4, source.paths.length)} more` : "";
      return `${source.description}${shown ? `: ${shown}${more}` : ""}`;
    }
    case "tag":
      return `Tag ${code(source.name)} at ${code(source.sha.slice(0, 7))}`;
    case "session": {
      const details = [source.role, source.timestamp ? `${source.timestamp.replace("T", " ").slice(0, 16)} UTC` : ""].filter(Boolean).join(", ");
      return `Session ${code(source.file)}, ${source.eventId}${details ? ` (${details})` : ""}`;
    }
  }
}

export function excerptOf(source: EvidenceSource): string | undefined {
  return source.kind === "file" || source.kind === "session" ? source.excerpt : undefined;
}

export interface ReportHeadline {
  title: string;
  subtitle: string;
}

export function reportHeadline(study: CaseStudy): ReportHeadline {
  const { metrics } = study;
  const range =
    formatDate(metrics.firstCommitAt) === formatDate(metrics.latestCommitAt)
      ? formatDate(metrics.firstCommitAt)
      : `${formatDate(metrics.firstCommitAt)} – ${formatDate(metrics.latestCommitAt)}`;
  return { title: study.project.name, subtitle: range };
}

export function indexCommits(study: CaseStudy): ReadonlyMap<string, CommitSummary> {
  return new Map(study.commits.map((commit) => [commit.sha, commit]));
}

export const MAX_COMMITS_PER_MILESTONE = 12;

/** Qualifiers for the commit count, such as "2 merges" and "53 automated". */
export function commitNotes(metrics: ProjectMetrics): string[] {
  return [metrics.mergeCommits > 0 ? plural(metrics.mergeCommits, "merge") : "", metrics.automatedCommits > 0 ? `${formatCount(metrics.automatedCommits)} automated` : ""].filter(Boolean);
}

export function automatedNote(metrics: ProjectMetrics): string {
  return `${plural(metrics.automatedCommits, "automated commit")} by ${metrics.automatedAuthors.join(", ")} ${metrics.automatedCommits === 1 ? "is" : "are"} not part of any milestone.`;
}
