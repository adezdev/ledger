import { code } from "../domain/statement.ts";
import type { EvidenceLog } from "../domain/evidence.ts";
import type { Commit, Decision, TrackedFile } from "../domain/model.ts";
import { classifyCommit, subjectText } from "./commits.ts";
import { isAgentGuide, isArchitectureRecord, isDocumentation, isVendoredOrGenerated } from "./paths.ts";
import { firstParagraph, markdownSections, sentences, stripInlineMarkdown, topLevelListItems, truncate } from "./text.ts";
import { MARKERS, type Marker } from "./technology.ts";

export type DecisionDraft = Omit<Decision, "id">;

const MAX_DECISIONS_PER_DOCUMENT = 12;
const MAX_DOCUMENT_DECISIONS = 24;
const MAX_COMMIT_DECISIONS = 10;
const MAX_INFERRED_DECISIONS = 10;

/**
 * Headings that introduce design rationale: "Decisions", "Key design
 * decisions", "Trade-offs", "Design principles", and questions such as
 * "Why Bun?". The whole heading must be about decisions, so a section like
 * "Decisions (src/decisions.ts)" that documents code does not qualify, and a
 * "Why ...?" heading must be a question, so "Why it exists" does not either.
 */
const DECISION_HEADING =
  /^(?:(?:key|core|main|major|notable|important|design|technical|architecture|architectural|engineering|product|implementation)\s+)*(?:decisions?|decision log|choices|trade-?offs|rationale|principles)$|^why\b.*\?$/i;
/** "Why should I use X?" addresses the reader: a sales pitch or FAQ, not design rationale. */
const READER_QUESTION = /\b(I|you|your)\b/i;

/** Decisions stated in architecture decision records and design sections of documentation. */
export function decisionsFromDocuments(documents: ReadonlyMap<string, string>, log: EvidenceLog): DecisionDraft[] {
  const decisions: DecisionDraft[] = [];
  const paths = [...documents.keys()].filter((path) => isDocumentation(path) && !isAgentGuide(path) && !/(^|\/)(changelog|changes|history)\./i.test(path));

  for (const path of paths.sort(documentOrder)) {
    const budget = Math.min(MAX_DECISIONS_PER_DOCUMENT, MAX_DOCUMENT_DECISIONS - decisions.length);
    if (budget <= 0) break;
    const text = documents.get(path) ?? "";
    decisions.push(...(isArchitectureRecord(path) ? decisionFromRecord(path, text, log) : decisionsFromSections(path, text, log, budget)));
  }
  return decisions;
}

function documentOrder(a: string, b: string): number {
  const rank = (path: string): number => (isArchitectureRecord(path) ? 0 : /^(architecture|design)\./i.test(path) ? 1 : path.includes("/") ? 3 : 2);
  return rank(a) - rank(b) || a.localeCompare(b);
}

function decisionFromRecord(path: string, text: string, log: EvidenceLog): DecisionDraft[] {
  const sections = markdownSections(text);
  const heading = sections.find((section) => section.level === 1) ?? sections.find((section) => section.level > 0);
  const title = heading?.title.replace(/^(ADR[-\s]*)?\d+[.:\s-]+\s*/i, "").trim();
  if (!title) return [];

  const statusSection = sections.find((section) => /^status$/i.test(section.title));
  const status = (statusSection ? firstParagraph(statusSection.body) ?? statusSection.body.split("\n")[0] : /^\s*status:\s*(.+)$/im.exec(text)?.[1])?.trim();
  const decisionSection = sections.find((section) => /^(decision|decision outcome)$/i.test(section.title));
  const detailSource = decisionSection ? firstParagraph(decisionSection.body) ?? stripInlineMarkdown(decisionSection.body) : undefined;
  const date = /^\s*date:\s*(\d{4}-\d{2}-\d{2})/im.exec(text)?.[1];

  const excerpt = detailSource ? truncate(detailSource, 280) : undefined;
  const evidenceId = log.add({
    level: "documented",
    category: "decision",
    statement: `Architecture decision record: ${title}${status ? ` (status: ${status})` : ""}.`,
    source: { kind: "file", path, section: decisionSection?.title ?? heading?.title ?? title, line: decisionSection?.line ?? heading?.line ?? 1, ...(excerpt ? { excerpt } : {}) },
  });
  const decision: DecisionDraft = {
    title,
    status: "documented",
    basis: `Architecture decision record ${code(path)}${status ? `, status: ${truncate(status, 40)}` : ""}`,
    evidence: [evidenceId],
  };
  if (excerpt) decision.detail = excerpt;
  if (date) decision.date = date;
  return [decision];
}

/** Evidence is only recorded for decisions within `limit`, so nothing unreferenced reaches the report. */
function decisionsFromSections(path: string, text: string, log: EvidenceLog, limit: number): DecisionDraft[] {
  const decisions: DecisionDraft[] = [];
  for (const section of markdownSections(text)) {
    if (decisions.length >= limit) break;
    if (section.level === 0 || !DECISION_HEADING.test(section.title) || section.body === "") continue;
    if (/^why\b/i.test(section.title) && READER_QUESTION.test(section.title)) continue;
    const items = topLevelListItems(section.body, section.line + 1);

    if (items.length >= 2) {
      for (const item of items.slice(0, limit - decisions.length)) {
        const title = item.lead ?? truncate(sentences(item.text)[0] ?? item.text, 100);
        const remainder = item.lead ? item.text.slice(item.text.indexOf(item.lead) + item.lead.length).replace(/^[\s.:—–-]+/, "") : item.text;
        const detail = remainder && remainder !== title ? truncate(remainder, 280) : undefined;
        const evidenceId = log.add({
          level: "documented",
          category: "decision",
          statement: `Documentation lists "${truncate(title, 80)}" under "${section.title}".`,
          source: { kind: "file", path, section: section.title, line: item.line, excerpt: truncate(item.text, 280) },
        });
        const decision: DecisionDraft = { title, status: "documented", basis: `${code(path)}, section "${section.title}"`, evidence: [evidenceId] };
        if (detail) decision.detail = detail;
        decisions.push(decision);
      }
      continue;
    }

    const paragraph = firstParagraph(section.body);
    if (!paragraph) continue;
    const detail = truncate(paragraph, 280);
    const evidenceId = log.add({
      level: "documented",
      category: "decision",
      statement: `Documentation explains "${section.title}".`,
      source: { kind: "file", path, section: section.title, line: section.line, excerpt: detail },
    });
    decisions.push({ title: section.title, status: "documented", detail, basis: `${code(path)}, section "${section.title}"`, evidence: [evidenceId] });
  }
  return decisions;
}

/**
 * A subject that states a choice: it starts with a verb of choosing and names
 * the alternative the way that verb does. "Replace X with Y", "Switch from X
 * to Y", and "Use X instead of Y" qualify; "Remove X from Y" and "Use X to do
 * Y" do not, because nothing was chosen over anything. Moving code is
 * reorganization, not a choice between alternatives.
 */
const EXPLICIT_SUBJECT = [
  /^(replace[sd]?|replacing)\b.+\b(with|by)\b/i,
  /^(switch(es|ed)?|switching|migrate[sd]?|migrating)\b.*\b(to|from)\b/i,
  /^(use[sd]?|using|prefer(red|s)?|adopt(ed|s)?|drop(ped|s)?|remove[sd]?|removing)\b.*\b(instead of|in favou?r of|rather than|over)\b/i,
];

const RATIONALE = /\b(because|so that|in order to|instead of|rather than|trade-?offs?|decided|we chose|chose to|opted (to|for))\b/i;

/** Decisions stated explicitly in commit messages. Messages are the author's own words, so these are documented. */
export function decisionsFromCommits(commits: readonly Commit[], log: EvidenceLog): DecisionDraft[] {
  const candidates: { commit: Commit; detail: string | undefined; explicit: boolean; index: number }[] = [];

  commits.forEach((commit, index) => {
    if (commit.parents.length > 1) return;
    const classification = classifyCommit(commit);
    const onlyDocs = commit.changes.length > 0 && commit.changes.every((change) => isDocumentation(change.path));
    const text = decisionText(commit.subject);
    const explicit = EXPLICIT_SUBJECT.some((pattern) => pattern.test(text)) && !/\btypos?\b/i.test(commit.subject) && !onlyDocs;
    const rationale = sentences(commit.body).filter((sentence) => RATIONALE.test(sentence) && sentence.length >= 20);
    const eligibleKind = !["fix", "docs", "test", "style", "revert"].includes(classification.kind);
    if (!explicit && !(eligibleKind && rationale.length > 0)) return;
    const detail = rationale.length > 0 ? truncate(rationale.slice(0, 2).join(" "), 280) : undefined;
    candidates.push({ commit, detail, explicit, index });
  });

  // Evidence is recorded only for the decisions that make the cut, so the
  // appendix never lists items the report does not reference.
  return candidates
    .sort((a, b) => Number(b.explicit) - Number(a.explicit) || a.index - b.index)
    .slice(0, MAX_COMMIT_DECISIONS)
    .sort((a, b) => a.index - b.index)
    .map(({ commit, detail }) => {
      const date = commit.authoredAt.slice(0, 10);
      const evidenceId = log.add({
        level: "documented",
        category: "decision",
        statement: `Commit message states: "${truncate(commit.subject, 120)}"${detail ? ` — "${detail}"` : ""}.`,
        source: { kind: "commit", sha: commit.sha, shortSha: commit.shortSha, date },
      });
      const decision: DecisionDraft = { title: capitalize(subjectText(commit.subject)), status: "documented", basis: `Commit message ${code(commit.shortSha)}`, date, evidence: [evidenceId] };
      if (detail) decision.detail = detail;
      return decision;
    });
}

interface MarkerHistory {
  marker: Marker;
  added?: { commit: Commit; index: number; path: string };
  removed?: { commit: Commit; index: number; path: string };
  presentAtHead: boolean;
}

/**
 * Tooling changes visible in history: a marker file (lockfile, CI workflow,
 * linter config, ...) first appearing after the initial commit, or disappearing.
 * That these reflect deliberate decisions is Ledger's inference.
 */
export function inferredToolingDecisions(commits: readonly Commit[], files: readonly TrackedFile[], log: EvidenceLog): DecisionDraft[] {
  const histories = markerHistories(commits, files);
  // Built lazily so evidence is recorded only for the decisions that are kept.
  const decisions: { build: () => DecisionDraft; index: number }[] = [];
  const consumed = new Set<MarkerHistory>();

  for (const history of histories) {
    if (!history.removed || history.presentAtHead || consumed.has(history)) continue;
    const removal = history.removed;
    const replacement = histories.find(
      (other) =>
        other !== history &&
        other.marker.group !== undefined &&
        other.marker.group === history.marker.group &&
        other.presentAtHead &&
        other.added !== undefined &&
        Math.abs(other.added.index - removal.index) <= 3,
    );
    if (replacement?.added) {
      consumed.add(history).add(replacement);
      const added = replacement.added;
      decisions.push({
        index: Math.min(removal.index, added.index),
        build: () => ({
          title: `Moved from ${history.marker.name} to ${replacement.marker.name}`,
          status: "inferred",
          basis: `${code(removal.path)} was removed in ${code(removal.commit.shortSha)} and ${code(added.path)} was added in ${code(added.commit.shortSha)}`,
          date: added.commit.authoredAt.slice(0, 10),
          evidence: [markerEvidence(log, removal, "removed"), markerEvidence(log, added, "added")],
        }),
      });
      continue;
    }
    consumed.add(history);
    decisions.push({
      index: removal.index,
      build: () => ({
        title: `Stopped using ${history.marker.name}`,
        status: "inferred",
        basis: `${code(removal.path)} was removed in ${code(removal.commit.shortSha)} and no ${history.marker.name} files remain at HEAD`,
        date: removal.commit.authoredAt.slice(0, 10),
        evidence: [markerEvidence(log, removal, "removed")],
      }),
    });
  }

  for (const history of histories) {
    if (consumed.has(history) || !history.presentAtHead || !history.added || history.added.index === 0) continue;
    const added = history.added;
    decisions.push({
      index: added.index,
      build: () => ({
        title: `Adopted ${history.marker.name}`,
        status: "inferred",
        basis: `${code(added.path)} first appeared in ${code(added.commit.shortSha)}, ${added.index} commit${added.index === 1 ? "" : "s"} after the first analyzed commit`,
        date: added.commit.authoredAt.slice(0, 10),
        evidence: [markerEvidence(log, added, "added")],
      }),
    });
  }

  return decisions
    .sort((a, b) => a.index - b.index)
    .slice(0, MAX_INFERRED_DECISIONS)
    .map((entry) => entry.build());
}

function markerHistories(commits: readonly Commit[], files: readonly TrackedFile[]): MarkerHistory[] {
  const histories: MarkerHistory[] = [];
  for (const marker of MARKERS) {
    const history: MarkerHistory = {
      marker,
      presentAtHead: files.some((file) => !isVendoredOrGenerated(file.path) && marker.test(file.path)),
    };
    commits.forEach((commit, index) => {
      for (const change of commit.changes) {
        if (isVendoredOrGenerated(change.path)) continue;
        const addedHere = (change.status === "added" || change.status === "renamed" || change.status === "copied") && marker.test(change.path) && !(change.previousPath && marker.test(change.previousPath));
        const removedHere = (change.status === "deleted" && marker.test(change.path)) || (change.status === "renamed" && change.previousPath !== undefined && marker.test(change.previousPath) && !marker.test(change.path));
        if (addedHere && !history.added) history.added = { commit, index, path: change.path };
        if (removedHere) history.removed = { commit, index, path: change.status === "renamed" && change.previousPath ? change.previousPath : change.path };
      }
    });
    if (history.added || history.removed) histories.push(history);
  }
  return histories;
}

function markerEvidence(log: EvidenceLog, event: { commit: Commit; path: string }, verb: "added" | "removed"): string {
  return log.add({
    level: "observed",
    category: "history",
    statement: `${code(event.path)} was ${verb} in this commit.`,
    source: { kind: "commit", sha: event.commit.sha, shortSha: event.commit.shortSha, date: event.commit.authoredAt.slice(0, 10), files: [event.path] },
  });
}

/** The subject without a Conventional Commits type or an "area:" prefix. */
function decisionText(subject: string): string {
  return subjectText(subject).replace(/^[A-Za-z0-9_][\w./-]{0,40}:\s+/, "");
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
