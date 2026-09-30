import { joinWords } from "../analysis/engineering.ts";
import { areaOf } from "../analysis/paths.ts";
import type { EvidenceLog } from "../domain/evidence.ts";
import type { CommitKind, CommitSummary, Milestone, Tag } from "../domain/model.ts";
import { code } from "../domain/statement.ts";
import { formatCount, formatDate } from "./format.ts";

export const MAX_MILESTONES = 12;

/** How milestones are formed; shown to readers so the grouping can be judged. */
export const MILESTONE_METHOD =
  "Adjacent commits were grouped by shared scopes and directories, commit type, and time proximity; a tagged commit usually ends a milestone. The grouping is Ledger's interpretation of the history.";

const WEIGHTS = { topic: 1.0, kind: 0.4, time: 1.2, size: 0.8, tag: 1.5 };
/** Gap (in hours) at which the time component of the merge cost saturates: two weeks. */
const TIME_SATURATION_HOURS = 24 * 14;
/** Below the target count, neighbors merge only if this close in time and topic. */
const RELATED_GAP_HOURS = 12;
const RELATED_TOPIC_SIMILARITY = 0.5;

interface Group {
  index: number;
  commits: CommitSummary[];
  start: number;
  end: number;
  topics: Map<string, number>;
  kinds: Map<CommitKind, number>;
  endsWithTag: boolean;
  version: number;
  alive: boolean;
  previous: Group | null;
  next: Group | null;
}

/** Most milestones Ledger forms by forced merging: roughly the square root of the commit count, capped. */
export function targetMilestoneCount(commitCount: number): number {
  return Math.max(1, Math.min(MAX_MILESTONES, Math.round(Math.sqrt(commitCount))));
}

/**
 * Groups a chronological commit list into milestones. Only adjacent groups are
 * ever merged, so milestones never interleave. Deterministic: ties are broken
 * by position.
 */
export function groupCommits(commits: readonly CommitSummary[], taggedShas: ReadonlySet<string>): CommitSummary[][] {
  const units: CommitSummary[][] = [];
  for (const commit of commits) {
    const last = units.at(-1);
    // Merge commits carry no diff of their own; they belong with the work before them.
    if (commit.isMerge && last) last.push(commit);
    else units.push([commit]);
  }
  if (units.length <= 1) return units;

  const target = targetMilestoneCount(commits.filter((commit) => !commit.isMerge).length);
  const total = commits.length;
  const groups: Group[] = units.map((unit, index) => createGroup(unit, index, taggedShas));
  groups.forEach((group, index) => {
    group.previous = groups[index - 1] ?? null;
    group.next = groups[index + 1] ?? null;
  });

  const heap = new MinHeap<Candidate>((a, b) => a.cost - b.cost || a.left.index - b.left.index);
  const consider = (left: Group | null, right: Group | null): void => {
    if (!left || !right) return;
    heap.push({ cost: mergeCost(left, right, total), left, right, leftVersion: left.version, rightVersion: right.version });
  };
  for (const group of groups) consider(group, group.next);

  let remaining = groups.length;
  for (;;) {
    const candidate = heap.pop();
    if (!candidate) break;
    const { left, right } = candidate;
    if (!left.alive || !right.alive || left.version !== candidate.leftVersion || right.version !== candidate.rightVersion) continue;
    // Above the target, the cheapest merge always happens. Below it, only
    // neighbors that clearly continue the same work are merged.
    if (remaining <= target && !clearlyRelated(left, right)) continue;
    absorb(left, right);
    remaining--;
    consider(left.previous, left);
    consider(left, left.next);
  }

  const result: CommitSummary[][] = [];
  for (let group: Group | null = groups[0] ?? null; group; group = group.next) result.push(group.commits);
  return result;
}

function createGroup(commits: CommitSummary[], index: number, taggedShas: ReadonlySet<string>): Group {
  const times = commits.map((commit) => Date.parse(commit.authoredAt));
  const group: Group = {
    index,
    commits,
    start: Math.min(...times),
    end: Math.max(...times),
    topics: new Map(),
    kinds: new Map(),
    endsWithTag: commits.some((commit) => taggedShas.has(commit.sha)),
    version: 0,
    alive: true,
    previous: null,
    next: null,
  };
  for (const commit of commits) {
    if (commit.isMerge) continue;
    addWeights(group.topics, commitTopics(commit));
    group.kinds.set(commit.classification.kind, (group.kinds.get(commit.classification.kind) ?? 0) + 1);
  }
  return group;
}

/**
 * A commit's topics: its Conventional Commits scope and the areas of the
 * codebase it changed (weighted by lines changed). Keys are normalized so a
 * `cli` scope and the `src/cli` directory count as the same topic.
 */
export function commitTopics(commit: CommitSummary): Map<string, number> {
  const topics = new Map<string, number>();
  if (commit.classification.scope) topics.set(topicKey(commit.classification.scope), 1);
  const weights = new Map<string, number>();
  let total = 0;
  for (const change of commit.changes) {
    const weight = 1 + (change.additions ?? 0) + (change.deletions ?? 0);
    const key = topicKey(areaOf(change.path));
    weights.set(key, (weights.get(key) ?? 0) + weight);
    total += weight;
  }
  for (const [key, weight] of weights) topics.set(key, (topics.get(key) ?? 0) + weight / total);
  return topics;
}

export function topicKey(label: string): string {
  const last = label.toLowerCase().split("/").filter(Boolean).at(-1) ?? label.toLowerCase();
  if (last === "tests" || last === "spec") return "test";
  if (last === "documentation" || last === "doc") return "docs";
  return last;
}

function mergeCost(left: Group, right: Group, total: number): number {
  const gapHours = Math.max(0, right.start - left.end) / 3_600_000;
  const time = Math.min(1, Math.log1p(gapHours) / Math.log1p(TIME_SATURATION_HOURS));
  const size = (left.commits.length + right.commits.length) / total;
  return (
    WEIGHTS.topic * (1 - similarity(left.topics, right.topics)) +
    WEIGHTS.kind * (1 - similarity(left.kinds, right.kinds)) +
    WEIGHTS.time * time +
    WEIGHTS.size * size +
    (left.endsWithTag ? WEIGHTS.tag : 0)
  );
}

function clearlyRelated(left: Group, right: Group): boolean {
  const gapHours = Math.max(0, right.start - left.end) / 3_600_000;
  return !left.endsWithTag && gapHours <= RELATED_GAP_HOURS && similarity(left.topics, right.topics) >= RELATED_TOPIC_SIMILARITY;
}

/** Weighted Jaccard similarity of two distributions (each normalized to sum to 1). */
function similarity<K>(a: ReadonlyMap<K, number>, b: ReadonlyMap<K, number>): number {
  const sumA = [...a.values()].reduce((sum, value) => sum + value, 0);
  const sumB = [...b.values()].reduce((sum, value) => sum + value, 0);
  if (sumA === 0 || sumB === 0) return sumA === sumB ? 1 : 0;
  let min = 0;
  let max = 0;
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = (a.get(key) ?? 0) / sumA;
    const y = (b.get(key) ?? 0) / sumB;
    min += Math.min(x, y);
    max += Math.max(x, y);
  }
  return max === 0 ? 0 : min / max;
}

function absorb(left: Group, right: Group): void {
  left.commits = [...left.commits, ...right.commits];
  left.start = Math.min(left.start, right.start);
  left.end = Math.max(left.end, right.end);
  addWeights(left.topics, right.topics);
  addWeights(left.kinds, right.kinds);
  left.endsWithTag = right.endsWithTag;
  left.version++;
  left.next = right.next;
  if (right.next) right.next.previous = left;
  right.alive = false;
}

function addWeights<K>(target: Map<K, number>, source: ReadonlyMap<K, number>): void {
  for (const [key, value] of source) target.set(key, (target.get(key) ?? 0) + value);
}

interface Candidate {
  cost: number;
  left: Group;
  right: Group;
  leftVersion: number;
  rightVersion: number;
}

class MinHeap<T> {
  readonly #items: T[] = [];
  constructor(private readonly compare: (a: T, b: T) => number) {}

  push(item: T): void {
    const items = this.#items;
    items.push(item);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(items[index] as T, items[parent] as T) >= 0) break;
      [items[index], items[parent]] = [items[parent] as T, items[index] as T];
      index = parent;
    }
  }

  pop(): T | undefined {
    const items = this.#items;
    const top = items[0];
    const last = items.pop();
    if (items.length === 0 || last === undefined) return top;
    items[0] = last;
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < items.length && this.compare(items[left] as T, items[smallest] as T) < 0) smallest = left;
      if (right < items.length && this.compare(items[right] as T, items[smallest] as T) < 0) smallest = right;
      if (smallest === index) break;
      [items[index], items[smallest]] = [items[smallest] as T, items[index] as T];
      index = smallest;
    }
    return top;
  }
}

const KIND_LABELS: Record<CommitKind, string> = {
  feat: "Feature work",
  fix: "Fixes",
  docs: "Documentation",
  style: "Code style",
  refactor: "Refactoring",
  perf: "Performance work",
  test: "Testing",
  build: "Build tooling",
  ci: "Continuous integration",
  chore: "Maintenance",
  revert: "Reverts",
  merge: "Merges",
  other: "Development",
};

const KIND_NOUNS: Record<CommitKind, [string, string]> = {
  feat: ["feature", "features"],
  fix: ["fix", "fixes"],
  docs: ["documentation change", "documentation changes"],
  style: ["style change", "style changes"],
  refactor: ["refactor", "refactors"],
  perf: ["performance change", "performance changes"],
  test: ["test change", "test changes"],
  build: ["build change", "build changes"],
  ci: ["CI change", "CI changes"],
  chore: ["chore", "chores"],
  revert: ["revert", "reverts"],
  merge: ["merge", "merges"],
  other: ["other change", "other changes"],
};

export function describeKinds(kinds: Partial<Record<CommitKind, number>>): string {
  const entries = Object.entries(kinds).filter((entry): entry is [CommitKind, number] => entry[1] !== undefined && entry[1] > 0);
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return joinWords(entries.map(([kind, count]) => `${count} ${KIND_NOUNS[kind][count === 1 ? 0 : 1]}`));
}

/** Builds milestone records, with evidence, from commit groups. */
export function buildMilestones(commits: readonly CommitSummary[], tags: readonly Tag[], log: EvidenceLog): Milestone[] {
  const tagsBySha = new Map<string, string[]>();
  for (const tag of tags) tagsBySha.set(tag.sha, [...(tagsBySha.get(tag.sha) ?? []), tag.name]);
  const groups = groupCommits(commits, new Set(tagsBySha.keys()));

  return groups.map((group, index): Milestone => {
    const id = `M${index + 1}`;
    const work = group.filter((commit) => !commit.isMerge);
    const kinds: Partial<Record<CommitKind, number>> = {};
    for (const commit of group) kinds[commit.classification.kind] = (kinds[commit.classification.kind] ?? 0) + 1;
    const themes = milestoneThemes(work);
    const groupTags = group.flatMap((commit) => tagsBySha.get(commit.sha) ?? []);
    const additions = work.reduce((sum, commit) => sum + commit.additions, 0);
    const deletions = work.reduce((sum, commit) => sum + commit.deletions, 0);
    const files = new Set(work.flatMap((commit) => commit.changes.map((change) => change.path)));
    const dates = group.map((commit) => commit.authoredAt).sort((a, b) => Date.parse(a) - Date.parse(b));
    const startAt = dates[0] ?? "";
    const endAt = dates.at(-1) ?? startAt;
    const first = group[0];
    const last = group.at(-1);

    const evidence = [
      log.add({
        level: "inferred",
        category: "milestone",
        statement: `${group.length} commit${group.length === 1 ? "" : "s"} grouped as milestone ${id}.`,
        basis: MILESTONE_METHOD,
        source: { kind: "commit-range", firstSha: first?.sha ?? "", lastSha: last?.sha ?? "", count: group.length, commits: group.map((commit) => commit.shortSha) },
      }),
      ...groupTags.map((name) => {
        const sha = tags.find((tag) => tag.name === name)?.sha ?? "";
        return log.add({ level: "observed", category: "history", statement: `Tag ${code(name)} points at ${code(sha.slice(0, 7))}.`, source: { kind: "tag", name, sha } });
      }),
    ];

    const label = workLabel(work);
    const shownThemes = themes.filter((theme) => {
      const kind = REDUNDANT_THEMES[topicKey(theme)];
      return !kind || !label.toLowerCase().includes(KIND_LABELS[kind].toLowerCase());
    });
    const named = shownThemes.slice(0, 3);
    const others = shownThemes.length - named.length;
    const themeText = others > 0 ? `${named.join(", ")}, and ${others} other area${others === 1 ? "" : "s"}` : joinWords(named);
    const title = [groupTags.at(-1), `${label}${named.length > 0 ? `: ${themeText}` : ""}`].filter(Boolean).join(" · ");
    const span = formatDate(startAt) === formatDate(endAt) ? `on ${formatDate(startAt)}` : `from ${formatDate(startAt)} to ${formatDate(endAt)}`;
    const areas = topAreas(work).map(describeArea);
    const summaryParts = [
      `${group.length} commit${group.length === 1 ? "" : "s"} ${span}: ${describeKinds(kinds)}.`,
      areas.length > 0 ? `Most changed: ${joinWords(areas)}.` : "",
      additions + deletions > 0 ? `${formatCount(additions)} line${additions === 1 ? "" : "s"} added and ${formatCount(deletions)} removed across ${files.size} file${files.size === 1 ? "" : "s"}.` : "",
    ];

    return {
      id,
      title,
      summary: { text: summaryParts.filter(Boolean).join(" "), level: "inferred", evidence },
      startAt,
      endAt,
      commits: group.map((commit) => commit.sha),
      themes: themes.slice(0, 6),
      kinds,
      tags: groupTags,
      additions,
      deletions,
      filesChanged: files.size,
      evidence,
    };
  });
}

/**
 * "Feature work" when one kind covers 60% of commits, "Fixes and testing" when
 * two kinds cover 75%, otherwise "Development". Ties go to the kind with more
 * changed lines, then to a fixed priority.
 */
export function workLabel(commits: readonly CommitSummary[]): string {
  const stats = new Map<CommitKind, { count: number; churn: number }>();
  for (const commit of commits) {
    const entry = stats.get(commit.classification.kind) ?? { count: 0, churn: 0 };
    entry.count++;
    entry.churn += commit.additions + commit.deletions;
    stats.set(commit.classification.kind, entry);
  }
  const ranked = [...stats.entries()].sort(
    (a, b) => b[1].count - a[1].count || b[1].churn - a[1].churn || KIND_PRIORITY.indexOf(a[0]) - KIND_PRIORITY.indexOf(b[0]),
  );
  const total = Math.max(1, commits.length);
  const [first, second] = ranked;
  if (!first || first[0] === "other") return KIND_LABELS.other;
  if (first[1].count / total >= 0.6) return KIND_LABELS[first[0]];
  if (second && second[0] !== "other" && (first[1].count + second[1].count) / total >= 0.75) {
    return `${KIND_LABELS[first[0]]} and ${KIND_LABELS[second[0]].toLowerCase()}`;
  }
  return KIND_LABELS.other;
}

/** Tie-break order when two kinds have the same count and size. */
const KIND_PRIORITY: CommitKind[] = ["feat", "fix", "perf", "refactor", "test", "docs", "build", "ci", "chore", "style", "revert", "merge", "other"];

/** Themes that merely restate a kind label, such as "docs" under "Documentation". */
const REDUNDANT_THEMES: Partial<Record<string, CommitKind>> = { docs: "docs", test: "test", ci: "ci" };

/** A theme must carry at least this fraction of the leading theme's weight. */
const MIN_THEME_WEIGHT = 0.35;

/** Human labels for a milestone's main topics, preferring authors' own scopes over directory names. */
function milestoneThemes(commits: readonly CommitSummary[]): string[] {
  const weights = new Map<string, number>();
  const labels = new Map<string, Map<string, number>>();
  const note = (key: string, label: string, weight: number): void => {
    weights.set(key, (weights.get(key) ?? 0) + weight);
    const forKey = labels.get(key) ?? new Map<string, number>();
    forKey.set(label, (forKey.get(label) ?? 0) + weight + (label === key ? 0.5 : 0));
    labels.set(key, forKey);
  };
  for (const commit of commits) {
    if (commit.classification.scope) note(topicKey(commit.classification.scope), commit.classification.scope, 1);
    const scopeKey = commit.classification.scope ? topicKey(commit.classification.scope) : undefined;
    for (const [key, weight] of commitTopics(commit)) if (key !== scopeKey) note(key, key, weight * 0.75);
  }
  const ranked = [...weights.entries()].filter(([key]) => key !== "project root").sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  // Areas touched only in passing are not themes of the milestone.
  const threshold = (ranked[0]?.[1] ?? 0) * MIN_THEME_WEIGHT;
  return ranked
    .filter(([, weight]) => weight >= threshold)
    .map(([key]) => [...(labels.get(key) ?? new Map([[key, 1]])).entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? key);
}

const PLAIN_AREAS: Record<string, string> = {
  "project root": "top-level files",
  documentation: "top-level documentation",
  ci: "CI configuration",
};

export function describeArea(area: string): string {
  return PLAIN_AREAS[area] ?? code(`${area}/`);
}

function topAreas(commits: readonly CommitSummary[]): string[] {
  const churn = new Map<string, number>();
  for (const commit of commits) {
    for (const change of commit.changes) {
      const area = areaOf(change.path);
      churn.set(area, (churn.get(area) ?? 0) + 1 + (change.additions ?? 0) + (change.deletions ?? 0));
    }
  }
  return [...churn.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([area]) => area);
}
