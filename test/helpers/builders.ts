import { summarizeCommit } from "../../src/analysis/commits.ts";
import type { Commit, CommitSummary, FileChange, RepositorySnapshot, TrackedFile } from "../../src/domain/model.ts";

let counter = 0;

/** A commit with sensible defaults; `at` is an ISO timestamp. */
export function makeCommit(subject: string, options: { at?: string; body?: string; changes?: (string | Partial<FileChange>)[]; parents?: string[] } = {}): Commit {
  counter++;
  const sha = counter.toString(16).padStart(40, "0");
  return {
    sha,
    shortSha: sha.slice(0, 7),
    parents: options.parents ?? ["f".repeat(40)],
    authorName: "Test Author",
    authoredAt: options.at ?? "2024-01-01T10:00:00Z",
    subject,
    body: options.body ?? "",
    changes: (options.changes ?? []).map((change) =>
      typeof change === "string" ? { path: change, status: "modified", additions: 10, deletions: 2 } : { path: "file.txt", status: "modified", additions: 1, deletions: 0, ...change },
    ),
  };
}

export function summaries(commits: readonly Commit[]): CommitSummary[] {
  return commits.map(summarizeCommit);
}

export function makeSnapshot(options: { files?: Record<string, string>; commits?: Commit[]; tags?: { name: string; sha: string }[] } = {}): RepositorySnapshot {
  const files = options.files ?? {};
  const tracked: TrackedFile[] = Object.entries(files).map(([path, content], index) => ({
    path,
    size: new TextEncoder().encode(content).length,
    objectId: index.toString(16).padStart(40, "0"),
    kind: "file",
  }));
  const commits = options.commits ?? [makeCommit("Initial commit", { parents: [], changes: Object.keys(files).map((path) => ({ path, status: "added" as const, additions: 1, deletions: 0 })) })];
  return {
    name: "sample",
    branch: "main",
    headSha: commits.at(-1)?.sha ?? "0".repeat(40),
    isShallow: false,
    tags: options.tags ?? [],
    files: tracked,
    commits,
    documents: new Map(Object.entries(files)),
    skippedDocuments: [],
  };
}
