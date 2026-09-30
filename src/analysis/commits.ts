import type { Commit, CommitClassification, CommitKind, CommitSummary, FileChange } from "../domain/model.ts";
import { ciSystemOf, isDocumentation, isLockfile, isTestFile } from "./paths.ts";
import { isManifestPath } from "./manifests.ts";

const CONVENTIONAL = /^([a-zA-Z]+)(?:\(([^)]*)\))?(!)?:\s+\S/;

const AREA_PREFIX = /^([A-Za-z0-9_][\w./-]{0,40}):\s+(\S.*)$/;

const TYPE_ALIASES: Record<string, CommitKind> = {
  feat: "feat",
  feature: "feat",
  fix: "fix",
  bugfix: "fix",
  hotfix: "fix",
  docs: "docs",
  doc: "docs",
  style: "style",
  refactor: "refactor",
  perf: "perf",
  test: "test",
  tests: "test",
  build: "build",
  deps: "build",
  ci: "ci",
  chore: "chore",
  revert: "revert",
};

const KEYWORDS: [RegExp, CommitKind][] = [
  [/^(fix(ed)? )?typos?\b/i, "docs"],
  [/^(fix|fixed|fixes|fixing|bugfix|hotfix|resolve|resolved|resolves|correct|corrected)\b/i, "fix"],
  [/^revert\b/i, "revert"],
  [/^(release|released|releasing|regenerate[sd]?|misc)\b/i, "chore"],
  [/^(add|added|adds|adding|implement|implemented|implements|introduce|introduced|create|created|support|enable|enabled|start|started)\b/i, "feat"],
  [/^(refactor|refactored|restructure|restructured|rename|renamed|reorganize|reorganized|extract|extracted|simplify|simplified|clean ?up|cleanup|split|move|moved)\b/i, "refactor"],
  [/^(docs?|document|documented|readme)\b/i, "docs"],
  [/^(test|tests|testing)\b/i, "test"],
  [/^(perf|optimize|optimized|optimise|speed up)\b/i, "perf"],
  [/^(bump|upgrade|upgraded|update dependencies|update deps)\b/i, "build"],
  [/^(update[sd]?|upgrade[sd]?)\b.*(\bdeps?\b|dependenc|submodule|\bto v?\d)/i, "build"],
  [/^(format|formatted|lint|reformat|pep ?8)\b/i, "style"],
];

/**
 * Classifies a commit's kind. A Conventional Commits prefix is the author's own
 * declaration; wording and file-structure classifications are heuristics and
 * are labeled as such.
 */
export function classifyCommit(commit: Commit): CommitClassification {
  if (commit.parents.length > 1) return { kind: "merge", source: "structure", breaking: false };

  const conventional = CONVENTIONAL.exec(commit.subject);
  const breakingFooter = /^BREAKING[ -]CHANGE:/m.test(commit.body);
  if (conventional?.[1]) {
    const kind = TYPE_ALIASES[conventional[1].toLowerCase()];
    if (kind) {
      const classification: CommitClassification = {
        kind,
        source: "conventional",
        breaking: conventional[3] === "!" || breakingFooter,
      };
      const scope = conventional[2]?.trim().toLowerCase();
      if (scope) classification.scope = scope;
      return classification;
    }
  }

  // "area: message" subjects (ripgrep, Go, the Linux kernel) name the part of the
  // codebase first; the area becomes the scope and the message is classified.
  const area = AREA_PREFIX.exec(commit.subject.trim());
  const scope = area?.[1]?.toLowerCase();
  const text = area?.[2] ?? commit.subject.trim();
  const withScope = (classification: CommitClassification): CommitClassification => (scope ? { ...classification, scope } : classification);

  const keyword = KEYWORDS.find(([pattern]) => pattern.test(text));
  if (keyword) return withScope({ kind: keyword[1], source: "keyword", breaking: breakingFooter });

  const structural = kindFromChanges(commit.changes);
  if (structural) return withScope({ kind: structural, source: "structure", breaking: breakingFooter });
  return withScope({ kind: "other", source: "none", breaking: breakingFooter });
}

function kindFromChanges(changes: readonly FileChange[]): CommitKind | undefined {
  if (changes.length === 0) return undefined;
  const all = (predicate: (path: string) => boolean): boolean => changes.every((change) => predicate(change.path));
  if (all(isDocumentation)) return "docs";
  if (all(isTestFile)) return "test";
  if (all((path) => ciSystemOf(path) !== undefined)) return "ci";
  if (all((path) => isLockfile(path) || isManifestPath(path))) return "build";
  return undefined;
}

/** Line counts that exclude lockfiles and binary files, which say little about the work done. */
export function meaningfulLineCounts(changes: readonly FileChange[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const change of changes) {
    if (isLockfile(change.path)) continue;
    additions += change.additions ?? 0;
    deletions += change.deletions ?? 0;
  }
  return { additions, deletions };
}

/**
 * Automation accounts, recognized by author name: GitHub's "[bot]" suffix and
 * common bots that commit under a plain name.
 */
const AUTOMATED_AUTHOR = /\[bot\]$|^(dependabot|renovate|github-actions|greenkeeper|semantic-release-bot|allcontributors|pre-commit-ci|snyk-bot|imgbot|mergify)(\b|$)/i;

export function isAutomatedAuthor(authorName: string): boolean {
  return AUTOMATED_AUTHOR.test(authorName.trim());
}

/** Commits by people. Falls back to every commit when all of them are automated. */
export function humanCommits<T extends { authorName: string }>(commits: readonly T[]): T[] {
  const human = commits.filter((commit) => !isAutomatedAuthor(commit.authorName));
  return human.length > 0 ? human : [...commits];
}

export function summarizeCommit(commit: Commit): CommitSummary {
  const { additions, deletions } = meaningfulLineCounts(commit.changes);
  return {
    sha: commit.sha,
    shortSha: commit.shortSha,
    authoredAt: commit.authoredAt,
    authorName: commit.authorName,
    subject: commit.subject,
    classification: classifyCommit(commit),
    isMerge: commit.parents.length > 1,
    automated: isAutomatedAuthor(commit.authorName),
    filesChanged: commit.changes.length,
    additions,
    deletions,
    changes: commit.changes,
  };
}

/** The subject without its Conventional Commits prefix, e.g. "add parser" for "feat(cli): add parser". */
export function subjectText(subject: string): string {
  const match = CONVENTIONAL.exec(subject);
  if (!match?.[1] || !TYPE_ALIASES[match[1].toLowerCase()]) return subject.trim();
  return subject.slice(subject.indexOf(":") + 1).trim();
}
