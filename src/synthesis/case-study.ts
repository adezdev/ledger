import { type CiConfiguration, parseCiConfiguration } from "../analysis/ci.ts";
import { summarizeCommit } from "../analysis/commits.ts";
import { type DecisionDraft, decisionsFromCommits, decisionsFromDocuments, inferredToolingDecisions } from "../analysis/decisions.ts";
import { analyzeEngineering, joinWords } from "../analysis/engineering.ts";
import { type Manifest, isManifestPath, parseManifest } from "../analysis/manifests.ts";
import { ciSystemOf, isReadme, isVendoredOrGenerated } from "../analysis/paths.ts";
import { detectTechnologies } from "../analysis/technology.ts";
import { firstParagraph, markdownSections, truncate } from "../analysis/text.ts";
import { EvidenceLog } from "../domain/evidence.ts";
import {
  type CaseStudy,
  type CommitKind,
  type CommitSummary,
  type Decision,
  type ProjectIdentity,
  type ProjectMetrics,
  type RepositorySnapshot,
  SCHEMA_VERSION,
  type SessionSource,
  type Statement,
  type Technology,
} from "../domain/model.ts";
import { code } from "../domain/statement.ts";
import { extractSessionInsights } from "../session/extract.ts";
import { formatDate, inclusiveDays, isoDate, plural } from "./format.ts";
import { selectCommits } from "./highlights.ts";
import { buildMilestones, describeKinds } from "./milestones.ts";

export interface CaseStudyInput {
  snapshot: RepositorySnapshot;
  sessions: readonly SessionSource[];
  generatorVersion: string;
}

/**
 * Turns repository facts and supplied sessions into a case study. Pure: no
 * I/O, no clock, no randomness, so the same input always yields the same report.
 */
export function buildCaseStudy({ snapshot, sessions, generatorVersion }: CaseStudyInput): CaseStudy {
  const log = new EvidenceLog();
  const summaries = snapshot.commits.map(summarizeCommit);
  const manifests = readManifests(snapshot);
  const rootManifest = manifests.find((manifest) => !manifest.path.includes("/"));
  const ciConfigurations = readCiConfigurations(snapshot, rootManifest?.scripts ?? {});

  const historyEvidence = recordHistory(snapshot, log);
  const project = describeProject(snapshot, rootManifest, log);
  const { technologies, languages } = detectTechnologies(snapshot.files, manifests, log);
  const engineering = analyzeEngineering(snapshot, manifests, ciConfigurations, log);
  const timeline = buildMilestones(summaries, snapshot.tags, log);

  const commitDecisions = decisionsFromCommits(snapshot.commits, log);
  const sessionInsights = extractSessionInsights(sessions, log);
  const drafts: DecisionDraft[] = [
    ...decisionsFromDocuments(snapshot.documents, log),
    ...commitDecisions,
    ...sessionInsights.decisions,
    ...inferredToolingDecisions(snapshot.commits, snapshot.files, log),
  ];
  const decisions: Decision[] = drafts.map((draft, index) => ({ id: `D${index + 1}`, ...draft }));

  const decisionShas = new Set(
    commitDecisions.flatMap((decision) =>
      decision.evidence.flatMap((id) => {
        const source = log.items.find((item) => item.id === id)?.source;
        return source?.kind === "commit" ? [source.sha] : [];
      }),
    ),
  );
  const selectedCommits = selectCommits(summaries, snapshot.commits, timeline, snapshot.tags, decisionShas, log);

  const metrics = computeMetrics(snapshot, summaries, engineering, languages);
  const overview = writeOverview(snapshot, summaries, metrics, technologies, historyEvidence, sessions, log);

  return {
    schemaVersion: SCHEMA_VERSION,
    generator: { name: "ledger", version: generatorVersion },
    project,
    overview,
    metrics,
    technologies,
    timeline,
    decisions,
    findings: [...engineering.findings, ...sessionInsights.findings],
    selectedCommits,
    sessions: sessionInsights.summaries,
    commits: summaries,
    evidence: [...log.items],
    limitations: writeLimitations(snapshot, summaries, engineering.testFiles.length, engineering.ciFiles.length, sessions, decisions),
  };
}

function readManifests(snapshot: RepositorySnapshot): Manifest[] {
  const manifests: Manifest[] = [];
  const paths = [...snapshot.documents.keys()].filter(isManifestPath);
  paths.sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  for (const path of paths) {
    const manifest = parseManifest(path, snapshot.documents.get(path) ?? "");
    if (manifest) manifests.push(manifest);
  }
  return manifests;
}

function readCiConfigurations(snapshot: RepositorySnapshot, scripts: Readonly<Record<string, string>>): CiConfiguration[] {
  const configurations: CiConfiguration[] = [];
  for (const [path, text] of snapshot.documents) {
    if (!ciSystemOf(path)) continue;
    const configuration = parseCiConfiguration(path, text, scripts);
    if (configuration) configurations.push(configuration);
  }
  return configurations.sort((a, b) => a.path.localeCompare(b.path));
}

function recordHistory(snapshot: RepositorySnapshot, log: EvidenceLog): string {
  const first = snapshot.commits[0];
  const last = snapshot.commits.at(-1);
  return log.add({
    level: "observed",
    category: "history",
    statement: `${plural(snapshot.commits.length, "commit")} reachable from HEAD${snapshot.branch ? ` on ${code(snapshot.branch)}` : ""}.`,
    source: { kind: "commit-range", firstSha: first?.sha ?? "", lastSha: last?.sha ?? "", count: snapshot.commits.length },
  });
}

function describeProject(snapshot: RepositorySnapshot, manifest: Manifest | undefined, log: EvidenceLog): ProjectIdentity {
  const identity: ProjectIdentity = {
    name: manifest?.name ?? snapshot.name,
    repositoryName: snapshot.name,
    branch: snapshot.branch,
    headSha: snapshot.headSha,
    headShortSha: snapshot.headSha.slice(0, 7),
    tags: snapshot.tags,
  };

  if (manifest?.description) {
    const id = log.add({
      level: "documented",
      category: "identity",
      statement: `${code(manifest.path)} describes the project as: "${manifest.description}"`,
      source: { kind: "file", path: manifest.path, section: "description", excerpt: manifest.description },
    });
    identity.description = { text: manifest.description, level: "documented", evidence: [id] };
  } else {
    const readmePath = [...snapshot.documents.keys()].find(isReadme);
    const readme = readmePath ? snapshot.documents.get(readmePath) : undefined;
    const intro = readme ? readmeIntroduction(readme) : undefined;
    if (readmePath && intro) {
      const text = truncate(intro.text, 320);
      const id = log.add({
        level: "documented",
        category: "identity",
        statement: `${code(readmePath)} introduces the project.`,
        source: { kind: "file", path: readmePath, line: intro.line, excerpt: text },
      });
      identity.description = { text, level: "documented", evidence: [id] };
    }
  }

  const homepage = manifest?.homepage ? safeHomepage(manifest.homepage) : undefined;
  if (homepage) identity.homepage = homepage;
  if (manifest?.license) identity.license = manifest.license;
  if (manifest?.version) identity.version = manifest.version;
  return identity;
}

function readmeIntroduction(readme: string): { text: string; line: number } | undefined {
  for (const section of markdownSections(readme).slice(0, 3)) {
    const text = firstParagraph(section.body);
    if (text) return { text, line: section.line + 1 };
  }
  return undefined;
}

/** Only plain web URLs are shown; anything else (javascript:, file:, shorthand) is dropped. */
export function safeHomepage(value: string): string | undefined {
  const candidate = value.trim().replace(/^git\+/, "").replace(/\.git$/, "");
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function computeMetrics(
  snapshot: RepositorySnapshot,
  summaries: readonly CommitSummary[],
  engineering: { testFiles: string[]; ciFiles: string[]; documentationFiles: string[] },
  languages: ProjectMetrics["languages"],
): ProjectMetrics {
  const first = summaries[0];
  const last = summaries.at(-1);
  const dates = summaries.map((commit) => commit.authoredAt).sort((a, b) => Date.parse(a) - Date.parse(b));
  const touched = new Set<string>();
  for (const commit of summaries) for (const change of commit.changes) touched.add(change.path);
  const firstCommitAt = dates[0] ?? first?.authoredAt ?? "";
  const latestCommitAt = dates.at(-1) ?? last?.authoredAt ?? "";

  return {
    commits: summaries.length,
    mergeCommits: summaries.filter((commit) => commit.isMerge).length,
    contributors: new Set(summaries.map((commit) => commit.authorName)).size,
    firstCommitAt,
    latestCommitAt,
    timespanDays: inclusiveDays(firstCommitAt, latestCommitAt),
    activeDays: new Set(summaries.map((commit) => isoDate(commit.authoredAt))).size,
    trackedFiles: snapshot.files.length,
    filesTouched: touched.size,
    additions: summaries.reduce((sum, commit) => sum + commit.additions, 0),
    deletions: summaries.reduce((sum, commit) => sum + commit.deletions, 0),
    testFiles: engineering.testFiles.length,
    ciConfigurations: engineering.ciFiles.length,
    documentationFiles: engineering.documentationFiles.length,
    languages,
  };
}

function writeOverview(
  snapshot: RepositorySnapshot,
  summaries: readonly CommitSummary[],
  metrics: ProjectMetrics,
  technologies: readonly Technology[],
  historyEvidence: string,
  sessions: readonly SessionSource[],
  log: EvidenceLog,
): Statement[] {
  const statements: Statement[] = [];
  const span =
    metrics.timespanDays <= 1
      ? `on ${formatDate(metrics.firstCommitAt)}`
      : `between ${formatDate(metrics.firstCommitAt)} and ${formatDate(metrics.latestCommitAt)}, a span of ${plural(metrics.timespanDays, "day")} with commits on ${plural(metrics.activeDays, "day")}`;
  const merges = metrics.mergeCommits > 0 ? ` (${plural(metrics.mergeCommits, "merge")})` : "";
  statements.push({
    text: `The analyzed history contains ${plural(metrics.commits, "commit")}${merges} by ${plural(metrics.contributors, "contributor")}, made ${span}.`,
    level: "observed",
    evidence: [historyEvidence],
  });

  const topLevel = [...new Set(snapshot.files.map((file) => file.path).filter((path) => path.includes("/") && !isVendoredOrGenerated(path)).map((path) => path.split("/")[0] ?? ""))]
    .filter((directory) => directory !== "" && !directory.startsWith("."))
    .sort();
  const treeId = log.add({
    level: "observed",
    category: "structure",
    statement: `${plural(snapshot.files.length, "file")} tracked at HEAD ${code(snapshot.headSha.slice(0, 7))}.`,
    source: {
      kind: "file-set",
      description: `Top-level directories at HEAD (${plural(snapshot.files.length, "tracked file")} in total)`,
      total: topLevel.length,
      paths: topLevel.slice(0, 12).map((directory) => `${directory}/`),
    },
  });
  const layout = topLevel.length > 0 ? `, organized under ${joinWords(topLevel.slice(0, 6).map((directory) => code(`${directory}/`)))}${topLevel.length > 6 ? ` and ${topLevel.length - 6} other directories` : ""}` : "";
  statements.push({
    text: `At HEAD (${code(snapshot.headSha.slice(0, 7))}${snapshot.branch ? ` on ${code(snapshot.branch)}` : ", detached"}), the repository tracks ${plural(snapshot.files.length, "file")}${layout}.`,
    level: "observed",
    evidence: [treeId],
  });

  const languages = technologies.filter((technology) => technology.kind === "language" && metrics.languages.some((share) => share.language === technology.name));
  if (languages.length > 0) {
    const described = metrics.languages
      .filter((share) => languages.some((language) => language.name === share.language))
      .slice(0, 3)
      .map((share) => `${share.language} (${share.share < 0.01 ? "<1" : Math.round(share.share * 100)}%)`);
    statements.push({
      text: `By file extension, source code is mostly ${joinWords(described)}, measured in bytes at HEAD.`,
      level: "inferred",
      evidence: languages
        .flatMap((language) => language.evidence)
        .filter((id) => log.items.find((item) => item.id === id)?.level === "inferred")
        .slice(0, 3),
    });
  }

  const tooling = technologies.filter((technology) => technology.kind !== "language" && technology.level === "observed");
  if (tooling.length > 0) {
    const names = tooling.slice(0, 8).map((technology) => technology.name);
    statements.push({
      text: `Tooling identified from tracked manifests and configuration files: ${joinWords(names)}${tooling.length > 8 ? `, among ${tooling.length} in total` : ""}.`,
      level: "observed",
      evidence: tooling.slice(0, 8).flatMap((technology) => technology.evidence.slice(0, 1)),
    });
  }

  const work = summaries.filter((commit) => !commit.isMerge);
  if (work.length >= 2) {
    const kinds: Partial<Record<CommitKind, number>> = {};
    for (const commit of work) kinds[commit.classification.kind] = (kinds[commit.classification.kind] ?? 0) + 1;
    const conventionalShare = work.filter((commit) => commit.classification.source === "conventional").length / work.length;
    const level = conventionalShare >= 0.8 ? "observed" : "inferred";
    const how = level === "observed" ? "as labeled by their Conventional Commits prefixes" : "classified from commit wording and changed files";
    statements.push({ text: `By type, the commits comprise ${describeKinds(kinds)}, ${how}.`, level, evidence: [historyEvidence] });
  }

  if (sessions.length > 0) {
    const events = sessions.reduce((sum, session) => sum + session.events.length, 0);
    const ids = sessions.map((session) => {
      const first = session.events[0];
      return log.add({
        level: "documented",
        category: "session",
        statement: `Development session ${code(session.file)} supplied with ${plural(session.events.length, "event")}.`,
        source: { kind: "session", file: session.file, eventId: first?.id ?? "start", ...(first?.timestamp ? { timestamp: first.timestamp } : {}) },
      });
    });
    statements.push({
      text: `${plural(sessions.length, "development session")} (${joinWords(sessions.map((session) => code(session.file)))}) supplied ${plural(events, "event")} of additional context.`,
      level: "documented",
      evidence: ids,
    });
  }
  return statements;
}

function writeLimitations(
  snapshot: RepositorySnapshot,
  summaries: readonly CommitSummary[],
  testFiles: number,
  ciFiles: number,
  sessions: readonly SessionSource[],
  decisions: readonly Decision[],
): string[] {
  const limitations = [
    `Ledger read history reachable from HEAD${snapshot.branch ? ` (${code(snapshot.branch)})` : ""} only; other branches and unpushed work elsewhere are not included.`,
    "Ledger did not build the project, run its tests, or execute CI. Statements about tests and CI describe what is configured, not whether it passes.",
    "Line counts exclude lockfiles, binary files, and merge commits. Dates are author dates as recorded, which rebases can rewrite.",
    "Languages are classified by file extension. Milestone grouping and some commit types are Ledger's inferences and are marked as such.",
    "Only tracked metadata, CI configuration, and documentation files were read; source code contents were not inspected.",
  ];
  if (snapshot.isShallow) limitations.push("The repository is a shallow clone, so history before the shallow boundary is missing.");
  if (summaries.length === 1) limitations.push("The history has a single commit, so there is no development timeline to analyze.");
  if (testFiles === 0) limitations.push("No test files were detected by naming convention; tests embedded in source files (for example Rust unit tests) are not counted.");
  if (ciFiles === 0) limitations.push("No CI configuration was found among tracked files.");
  if (sessions.length === 0) {
    limitations.push("No development sessions were supplied, so decision rationale is limited to documentation and commit messages.");
  }
  for (const session of sessions) {
    for (const warning of session.warnings) limitations.push(`Session ${code(session.file)}: ${warning}`);
  }
  if (!decisions.some((decision) => decision.status === "documented")) {
    limitations.push("No documented decisions were found; any decisions shown are inferred from history.");
  }
  const skipped = snapshot.skippedDocuments;
  if (skipped.length > 0) {
    const reasons = [...new Set(skipped.map((document) => document.reason.replace("-", " ")))];
    limitations.push(`${plural(skipped.length, "metadata or documentation file")} ${skipped.length === 1 ? "was" : "were"} not read (${joinWords(reasons)}).`);
  }
  return limitations;
}
