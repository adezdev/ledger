/**
 * Ledger's domain model.
 *
 * Two layers live here:
 * - Repository facts (`RepositorySnapshot`, `Commit`, ...) produced by the Git
 *   reader and consumed by analysis.
 * - The case study (`CaseStudy`, `Evidence`, ...) produced by synthesis and
 *   consumed by renderers. `CaseStudy` is serialized verbatim as report.json,
 *   so changes to it are schema changes.
 */

/**
 * How certain Ledger is about a piece of information.
 *
 * - observed: read directly from Git history or tracked files.
 * - documented: stated by the project itself (docs, metadata, commit messages)
 *   or by a supplied development session.
 * - inferred: derived by Ledger's heuristics; an interpretation, not a fact.
 */
export type EvidenceLevel = "observed" | "documented" | "inferred";

export const EVIDENCE_LEVELS: readonly EvidenceLevel[] = ["observed", "documented", "inferred"];

// ---------------------------------------------------------------------------
// Repository facts
// ---------------------------------------------------------------------------

export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "type-changed" | "unknown";

export interface FileChange {
  path: string;
  /** Previous path for renames and copies. */
  previousPath?: string;
  status: FileChangeStatus;
  /** Null when Git reports the file as binary. */
  additions: number | null;
  deletions: number | null;
}

export interface Commit {
  sha: string;
  shortSha: string;
  parents: string[];
  authorName: string;
  /** Author timestamp exactly as recorded, ISO 8601 with the author's offset. */
  authoredAt: string;
  subject: string;
  body: string;
  /** Empty for merge commits: Ledger does not diff merges against parents. */
  changes: FileChange[];
}

export interface Tag {
  name: string;
  /** The commit the tag ultimately points at. */
  sha: string;
}

export interface TrackedFile {
  path: string;
  /** Size in bytes of the blob at HEAD. */
  size: number;
  objectId: string;
  kind: "file" | "executable" | "symlink";
}

/** Everything Ledger knows about a repository, gathered without executing it. */
export interface RepositorySnapshot {
  /** Name of the repository's root directory. Never an absolute path. */
  name: string;
  branch: string | null;
  headSha: string;
  isShallow: boolean;
  tags: Tag[];
  /** Files tracked at HEAD. Untracked and ignored files are never listed. */
  files: TrackedFile[];
  /** Commits reachable from HEAD, oldest first. */
  commits: Commit[];
  /** Text of the tracked files Ledger chose to read, keyed by path. */
  documents: ReadonlyMap<string, string>;
  /** Paths Ledger wanted to read but skipped (binary, too large, symlink). */
  skippedDocuments: SkippedDocument[];
}

export interface SkippedDocument {
  path: string;
  reason: "binary" | "too-large" | "symlink";
}

// ---------------------------------------------------------------------------
// Session evidence
// ---------------------------------------------------------------------------

export type SessionFormat = "json" | "jsonl" | "text";

export type SessionEventKind = "message" | "command" | "tool" | "result";

/** One normalized entry from a development-session transcript. */
export interface SessionEvent {
  /** Identifier from the source when present, otherwise a positional one such as "line 12". */
  id: string;
  kind: SessionEventKind;
  role?: string;
  /** ISO 8601 timestamp when the source provided a recognizable one. */
  timestamp?: string;
  text: string;
  command?: string;
  tool?: string;
}

/** A development session supplied explicitly by the user, normalized. */
export interface SessionSource {
  /** Base name of the file the session was read from. */
  file: string;
  format: SessionFormat;
  events: SessionEvent[];
  /** Non-fatal problems met while importing, e.g. malformed JSONL lines. */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Case study (serialized as report.json)
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = "1";

export type EvidenceCategory =
  | "identity"
  | "history"
  | "structure"
  | "technology"
  | "testing"
  | "ci"
  | "quality"
  | "build"
  | "documentation"
  | "decision"
  | "milestone"
  | "session";

/** Where a piece of evidence came from. Every variant is auditable by a reader. */
export type EvidenceSource =
  | { kind: "commit"; sha: string; shortSha: string; date: string; files?: string[] }
  | { kind: "commit-range"; firstSha: string; lastSha: string; count: number; commits?: string[] }
  | { kind: "file"; path: string; section?: string; line?: number; excerpt?: string }
  | { kind: "file-set"; description: string; total: number; paths: string[] }
  | { kind: "tag"; name: string; sha: string }
  | { kind: "session"; file: string; eventId: string; timestamp?: string; role?: string; excerpt?: string };

export interface Evidence {
  /** Stable within one report, e.g. "E7". */
  id: string;
  level: EvidenceLevel;
  category: EvidenceCategory;
  /** What this evidence shows, phrased at its level of certainty. */
  statement: string;
  /** For inferred evidence: how Ledger reached the conclusion. */
  basis?: string;
  source: EvidenceSource;
}

/**
 * A sentence in the report together with its certainty and supporting evidence.
 * `text` may contain inline code spans delimited by backticks.
 */
export interface Statement {
  text: string;
  level: EvidenceLevel;
  evidence: string[];
}

export interface Technology {
  name: string;
  kind: "language" | "runtime" | "package-manager" | "framework" | "library" | "tool" | "build-system" | "platform";
  /** Observed when a manifest, lockfile, or config file declares it; inferred when based on file extensions. */
  level: EvidenceLevel;
  basis: string;
  evidence: string[];
}

export interface LanguageShare {
  language: string;
  files: number;
  bytes: number;
  /** Share of classified source bytes, 0–1. */
  share: number;
}

export interface ProjectMetrics {
  commits: number;
  mergeCommits: number;
  contributors: number;
  firstCommitAt: string;
  latestCommitAt: string;
  /** Calendar days from the first to the latest commit date, inclusive. */
  timespanDays: number;
  /** Distinct calendar dates with at least one commit. */
  activeDays: number;
  trackedFiles: number;
  /** Distinct paths added, modified, deleted, or renamed across the analyzed history. */
  filesTouched: number;
  /** Lines added across non-merge commits, excluding lockfiles and binary files. */
  additions: number;
  deletions: number;
  testFiles: number;
  ciConfigurations: number;
  documentationFiles: number;
  languages: LanguageShare[];
}

export type CommitKind =
  | "feat"
  | "fix"
  | "docs"
  | "style"
  | "refactor"
  | "perf"
  | "test"
  | "build"
  | "ci"
  | "chore"
  | "revert"
  | "merge"
  | "other";

export interface CommitClassification {
  kind: CommitKind;
  /** "conventional" when declared by a Conventional Commits prefix, "keyword" when guessed from wording. */
  source: "conventional" | "keyword" | "structure" | "none";
  scope?: string;
  breaking: boolean;
}

export interface CommitSummary {
  sha: string;
  shortSha: string;
  authoredAt: string;
  authorName: string;
  subject: string;
  classification: CommitClassification;
  isMerge: boolean;
  filesChanged: number;
  additions: number;
  deletions: number;
  changes: FileChange[];
}

export interface Milestone {
  id: string;
  title: string;
  summary: Statement;
  startAt: string;
  endAt: string;
  commits: string[];
  themes: string[];
  kinds: Partial<Record<CommitKind, number>>;
  tags: string[];
  additions: number;
  deletions: number;
  filesChanged: number;
  evidence: string[];
}

export interface Decision {
  id: string;
  title: string;
  status: "documented" | "inferred";
  /** Supporting excerpt or explanation of what was decided. */
  detail?: string;
  /** Where the decision was found (documented) or how it was inferred (inferred). */
  basis: string;
  date?: string;
  evidence: string[];
}

export type FindingArea =
  | "testing"
  | "ci"
  | "types"
  | "linting"
  | "build"
  | "benchmarks"
  | "documentation"
  | "release"
  | "session";

export interface Finding {
  area: FindingArea;
  statement: Statement;
}

export interface SelectedCommit {
  sha: string;
  shortSha: string;
  authoredAt: string;
  subject: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  milestone?: string;
  /** Why Ledger highlighted this commit. */
  reasons: string[];
  evidence: string[];
}

export interface SessionSummary {
  file: string;
  format: SessionFormat;
  events: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
  commands: number;
  warnings: string[];
}

export interface ProjectIdentity {
  name: string;
  description?: Statement;
  repositoryName: string;
  branch: string | null;
  headSha: string;
  headShortSha: string;
  homepage?: string;
  license?: string;
  version?: string;
  tags: Tag[];
}

export interface CaseStudy {
  schemaVersion: typeof SCHEMA_VERSION;
  generator: { name: "ledger"; version: string };
  project: ProjectIdentity;
  overview: Statement[];
  metrics: ProjectMetrics;
  technologies: Technology[];
  timeline: Milestone[];
  decisions: Decision[];
  findings: Finding[];
  selectedCommits: SelectedCommit[];
  sessions: SessionSummary[];
  commits: CommitSummary[];
  evidence: Evidence[];
  limitations: string[];
}
