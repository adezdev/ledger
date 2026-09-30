import { isDocumentation, isLockfile, isTestFile, isTestSource, isVendoredOrGenerated } from "../analysis/paths.ts";
import type { EvidenceLog } from "../domain/evidence.ts";
import type { Commit, CommitSummary, Milestone, SelectedCommit, Tag } from "../domain/model.ts";
import { code } from "../domain/statement.ts";
import { formatCount, isoDate } from "../domain/format.ts";

export const MAX_SELECTED_COMMITS = 6;

interface Scored {
  commit: CommitSummary;
  index: number;
  score: number;
  reasons: string[];
}

/**
 * Picks a few commits that best show how the work was done: self-explaining
 * messages, substantial but reviewable changes, and tests landing with code.
 * Selection is spread across milestones, then shown chronologically.
 */
export function selectCommits(
  summaries: readonly CommitSummary[],
  commits: readonly Commit[],
  milestones: readonly Milestone[],
  tags: readonly Tag[],
  decisionShas: ReadonlySet<string>,
  log: EvidenceLog,
): SelectedCommit[] {
  const bodies = new Map(commits.map((commit) => [commit.sha, commit.body]));
  const milestoneOf = new Map<string, Milestone>();
  for (const milestone of milestones) for (const sha of milestone.commits) milestoneOf.set(sha, milestone);
  const tagged = new Map<string, string>();
  for (const tag of tags) tagged.set(tag.sha, tag.name);

  const eligible = summaries.filter((commit) => !commit.isMerge && commit.filesChanged > 0 && commit.additions + commit.deletions > 0);
  if (eligible.length === 0) return [];
  const count = Math.max(1, Math.min(MAX_SELECTED_COMMITS, Math.ceil(eligible.length / 3)));

  // "Largest in its milestone" only means something when there was a choice.
  const largestInMilestone = new Map<string, string>();
  for (const milestone of milestones) {
    const candidates = eligible.filter((commit) => milestoneOf.get(commit.sha) === milestone);
    const largest = [...candidates].sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))[0];
    if (largest && candidates.length >= 3) largestInMilestone.set(milestone.id, largest.sha);
  }

  const scored: Scored[] = eligible.map((commit) => {
    const reasons: string[] = [];
    let score = 0;
    const churn = commit.additions + commit.deletions;
    score += Math.min(5, Math.log2(1 + churn) * 0.5);

    const body = bodies.get(commit.sha) ?? "";
    const bodyLines = body.split("\n").filter((line) => line.trim() !== "").length;
    if (body.trim().length >= 40) {
      score += 2;
      reasons.push(`Message body explains the change (${bodyLines} line${bodyLines === 1 ? "" : "s"})`);
    }

    const paths = commit.changes.map((change) => change.path);
    const touchesTests = paths.some(isTestSource);
    const touchesSource = paths.some((path) => !isTestFile(path) && !isDocumentation(path) && !isLockfile(path) && !isVendoredOrGenerated(path));
    if (touchesTests && touchesSource) {
      score += 1.5;
      reasons.push("Changes tests alongside implementation");
    }

    const kind = commit.classification.kind;
    if (["feat", "fix", "perf", "refactor"].includes(kind)) score += 1;
    if (["docs", "style", "chore", "build", "ci"].includes(kind)) score -= 1;
    if (decisionShas.has(commit.sha)) {
      score += 1.5;
      reasons.push("Commit message records a technical decision");
    }
    const tag = tagged.get(commit.sha);
    if (tag) {
      score += 1;
      reasons.push(`Tagged ${code(tag)}`);
    }
    if (commit.filesChanged > 150 || paths.filter(isVendoredOrGenerated).length > commit.filesChanged / 2) score -= 3;

    const milestone = milestoneOf.get(commit.sha);
    if (milestone && largestInMilestone.get(milestone.id) === commit.sha && churn > 0) {
      reasons.push(`Largest change in milestone ${milestone.id} (+${formatCount(commit.additions)} −${formatCount(commit.deletions)})`);
    }
    return { commit, index: summaries.indexOf(commit), score, reasons };
  });

  const ranked = [...scored].sort((a, b) => b.score - a.score || a.index - b.index);
  const median = ranked[Math.floor(ranked.length / 2)]?.score ?? 0;
  const chosen: Scored[] = [];
  // First pass: the best commit of each milestone, so the selection spans the
  // history, but only where that commit is competitive with the rest.
  for (const milestone of milestones) {
    const best = ranked.find((entry) => milestoneOf.get(entry.commit.sha) === milestone);
    if (best && best.score >= median) chosen.push(best);
  }
  chosen.sort((a, b) => b.score - a.score || a.index - b.index);
  chosen.splice(count);
  for (const entry of ranked) {
    if (chosen.length >= count) break;
    if (!chosen.includes(entry)) chosen.push(entry);
  }

  return chosen
    .sort((a, b) => a.index - b.index)
    .map(({ commit, reasons }): SelectedCommit => {
      const milestone = milestoneOf.get(commit.sha);
      const evidenceId = log.add({
        level: "observed",
        category: "history",
        statement: `Commit ${code(commit.shortSha)}: "${commit.subject}" changed ${commit.filesChanged} file${commit.filesChanged === 1 ? "" : "s"} (+${commit.additions} −${commit.deletions}).`,
        source: { kind: "commit", sha: commit.sha, shortSha: commit.shortSha, date: isoDate(commit.authoredAt), files: commit.changes.slice(0, 10).map((change) => change.path) },
      });
      const selected: SelectedCommit = {
        sha: commit.sha,
        shortSha: commit.shortSha,
        authoredAt: commit.authoredAt,
        subject: commit.subject,
        filesChanged: commit.filesChanged,
        additions: commit.additions,
        deletions: commit.deletions,
        reasons: reasons.length > 0 ? reasons : ["Among the most substantial changes in the history"],
        evidence: [evidenceId],
      };
      if (milestone) selected.milestone = milestone.id;
      return selected;
    });
}
