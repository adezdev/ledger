import { relative, isAbsolute } from "node:path";
import type { AnalysisResult } from "../app/analyze.ts";
import { EVIDENCE_LEVELS } from "../domain/model.ts";
import { formatCount, formatDate, plural } from "../synthesis/format.ts";
import { VERSION } from "../version.ts";

/** The concise console summary printed after a successful analysis. */
export function formatSummary(result: AnalysisResult, writtenPaths: readonly string[], cwd: string): string {
  const study = result.caseStudy;
  const { metrics, project } = study;
  const stack = study.technologies
    .filter((technology) => technology.kind === "language" || technology.kind === "runtime" || technology.kind === "framework")
    .slice(0, 4)
    .map((technology) => technology.name);
  const levels = EVIDENCE_LEVELS.map((level) => `${formatCount(study.evidence.filter((item) => item.level === level).length)} ${level}`).join(", ");
  const documented = study.decisions.filter((decision) => decision.status === "documented").length;
  const span =
    metrics.timespanDays <= 1
      ? formatDate(metrics.firstCommitAt)
      : `${formatDate(metrics.firstCommitAt)} to ${formatDate(metrics.latestCommitAt)} (${plural(metrics.timespanDays, "day")}, ${formatCount(metrics.activeDays)} active)`;

  const rows: [string, string][] = [
    ["Project", `${project.name}${stack.length > 0 ? ` (${stack.join(", ")})` : ""}`],
    ["Commits", `${formatCount(metrics.commits)} analyzed on ${project.branch ?? "detached HEAD"} at ${project.headShortSha}`],
    ["Timespan", span],
    ["Evidence", `${plural(study.evidence.length, "item")}: ${levels}`],
    ["Timeline", `${plural(study.timeline.length, "milestone")}, ${plural(study.decisions.length, "decision")} (${documented} documented, ${study.decisions.length - documented} inferred)`],
  ];
  if (study.sessions.length > 0) {
    const events = study.sessions.reduce((sum, session) => sum + session.events, 0);
    rows.push(["Sessions", `${plural(study.sessions.length, "file")}, ${plural(events, "event")}`]);
  }
  writtenPaths.forEach((path, index) => rows.push([index === 0 ? "Wrote" : "", displayPath(path, cwd)]));

  const width = Math.max(...rows.map(([label]) => label.length));
  return [`Ledger ${VERSION}`, "", ...rows.map(([label, value]) => `  ${label.padEnd(width)}  ${value}`), ""].join("\n");
}

export function displayPath(path: string, cwd: string): string {
  const relativePath = relative(cwd, path);
  return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath) ? relativePath : path;
}
