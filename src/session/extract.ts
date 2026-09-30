import { classifyCommand } from "../analysis/ci.ts";
import type { DecisionDraft } from "../analysis/decisions.ts";
import { joinWords } from "../analysis/engineering.ts";
import { sentences, stripInlineMarkdown, truncate } from "../analysis/text.ts";
import type { EvidenceLog } from "../domain/evidence.ts";
import type { Finding, SessionEvent, SessionSource, SessionSummary } from "../domain/model.ts";
import { code } from "../domain/statement.ts";

const MAX_SESSION_DECISIONS = 12;
const MAX_DEBUGGING_NOTES = 5;

const DECISION_SENTENCE = /\b(decided to|decide to|we('ll| will) (use|go with)|I('ll| will) (use|go with)|chose|opted (to|for)|went with|going with|instead of|rather than|in favou?r of|trade-?offs?|the decision)\b/i;
const DEBUGGING_SENTENCE = /\b(root cause|the (bug|issue|problem|failure) (was|is)|caused by|turned out|regression)\b/i;

export interface SessionInsights {
  decisions: DecisionDraft[];
  findings: Finding[];
  summaries: SessionSummary[];
}

/**
 * Turns supplied transcripts into evidence. Session content is what someone
 * said or recorded during development, so everything here is "documented":
 * Ledger reports that the session states it, never that it is true.
 */
export function extractSessionInsights(sources: readonly SessionSource[], log: EvidenceLog): SessionInsights {
  const decisions: DecisionDraft[] = [];
  const findings: Finding[] = [];
  const summaries: SessionSummary[] = [];
  const seenDecisions = new Set<string>();

  for (const source of sources) {
    const timestamps = source.events.map((event) => event.timestamp).filter((stamp): stamp is string => stamp !== undefined).sort();
    const commands = source.events.filter((event) => event.kind === "command" && event.command);
    const summary: SessionSummary = { file: source.file, format: source.format, events: source.events.length, commands: commands.length, warnings: source.warnings };
    if (timestamps[0]) summary.firstTimestamp = timestamps[0];
    const lastTimestamp = timestamps.at(-1);
    if (lastTimestamp) summary.lastTimestamp = lastTimestamp;
    summaries.push(summary);

    for (const event of source.events) {
      if (event.kind !== "message" || decisions.length >= MAX_SESSION_DECISIONS) continue;
      for (const sentence of candidateSentences(event.text)) {
        if (!DECISION_SENTENCE.test(sentence) || sentence.endsWith("?")) continue;
        const key = sentence.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        if (seenDecisions.has(key)) continue;
        seenDecisions.add(key);
        const id = sessionEvidence(log, source, event, `Session ${code(source.file)} records: "${truncate(sentence, 200)}"`, truncate(sentence, 280));
        const decision: DecisionDraft = {
          title: truncate(sentence, 110),
          status: "documented",
          basis: `Development session ${code(source.file)}, ${event.id}${event.role ? ` (${event.role})` : ""}`,
          evidence: [id],
        };
        if (sentence.length > 110) decision.detail = truncate(sentence, 280);
        if (event.timestamp) decision.date = event.timestamp.slice(0, 10);
        decisions.push(decision);
        if (decisions.length >= MAX_SESSION_DECISIONS) break;
      }
    }

    findings.push(...commandFindings(source, commands, log));
    findings.push(...testOutputFindings(source, log));
    findings.push(...debuggingFindings(source, log));
  }
  return { decisions, findings, summaries };
}

function candidateSentences(text: string): string[] {
  const withoutCode = text.replace(/```[\s\S]*?```/g, " ").replace(/~~~[\s\S]*?~~~/g, " ");
  return sentences(withoutCode)
    .map((sentence) => stripInlineMarkdown(sentence))
    .filter((sentence) => sentence.length >= 30 && sentence.length <= 400);
}

function commandFindings(source: SessionSource, commands: readonly SessionEvent[], log: EvidenceLog): Finding[] {
  if (commands.length === 0) return [];
  const counts = new Map<string, { count: number; first: SessionEvent }>();
  for (const event of commands) {
    const command = truncate(event.command ?? event.text, 120);
    const entry = counts.get(command);
    if (entry) entry.count++;
    else counts.set(command, { count: 1, first: event });
  }
  const notable = [...counts.entries()]
    .filter(([command]) => classifyCommand(command).purposes.length > 0)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 4);
  const ids = notable.map(([command, entry]) => sessionEvidence(log, source, entry.first, `Session ${code(source.file)} records the command ${code(command)}${entry.count > 1 ? ` (${entry.count} times)` : ""}.`, command));
  const examples = notable.map(([command, entry]) => `${code(command)}${entry.count > 1 ? ` (${entry.count}×)` : ""}`);
  const first = commands[0];
  if (ids.length === 0 && first) ids.push(sessionEvidence(log, source, first, `Session ${code(source.file)} records ${commands.length} commands.`, truncate(first.command ?? first.text, 120)));
  return [
    {
      area: "session",
      statement: {
        text: `Session ${code(source.file)} records ${commands.length} command${commands.length === 1 ? "" : "s"}${examples.length > 0 ? `, including ${joinWords(examples)}` : ""}.`,
        level: "documented",
        evidence: ids,
      },
    },
  ];
}

interface TestSummary {
  event: SessionEvent;
  summary: string;
}

/** Recognizes the summary lines of common test runners in recorded output. */
export function testSummaryOf(text: string): string | undefined {
  const bun = /^\s*(\d+) pass\b[\s\S]*?^\s*(\d+) fail\b/m.exec(text);
  if (bun) return `${bun[1]} pass, ${bun[2]} fail`;
  const pytest = /=+ ((?:\d+ (?:passed|failed|skipped|errors?|xfailed|xpassed)(?:, )?)+) in [\d.]+s/.exec(text);
  if (pytest?.[1]) return pytest[1];
  const cargo = /test result: (ok|FAILED)\. (\d+) passed; (\d+) failed/.exec(text);
  if (cargo) return `${cargo[2]} passed, ${cargo[3]} failed`;
  const jest = /^Tests:\s+(.+total)\s*$/m.exec(text);
  if (jest?.[1]) return jest[1].trim();
  const vitest = /^\s*Tests\s+(\d+ (?:passed|failed).*?)\s*$/m.exec(text);
  if (vitest?.[1]) return vitest[1].replace(/\s+/g, " ");
  const go = /^(ok|FAIL)\s+\S+\s+[\d.]+s/m.exec(text);
  if (go) return go[0].trim();
  return undefined;
}

function testOutputFindings(source: SessionSource, log: EvidenceLog): Finding[] {
  const results: TestSummary[] = [];
  // Output quoted inside a message is also extracted as a result event; count it once.
  const kind = source.events.some((event) => event.kind === "result") ? "result" : "message";
  for (const event of source.events) {
    if (event.kind !== kind) continue;
    const summary = testSummaryOf(event.text);
    if (summary) results.push({ event, summary });
  }
  const latest = results.at(-1);
  if (!latest) return [];
  const id = sessionEvidence(log, source, latest.event, `Session ${code(source.file)} records test output: "${latest.summary}".`, latest.summary);
  const when = latest.event.timestamp ? ` at ${latest.event.timestamp.replace("T", " ").slice(0, 16)} UTC` : "";
  return [
    {
      area: "session",
      statement: {
        text: `Session ${code(source.file)} records ${results.length} test run${results.length === 1 ? "" : "s"}; the last recorded output${when} reads “${latest.summary}”.`,
        level: "documented",
        evidence: [id],
      },
    },
  ];
}

function debuggingFindings(source: SessionSource, log: EvidenceLog): Finding[] {
  const findings: Finding[] = [];
  for (const event of source.events) {
    if (event.kind !== "message" || findings.length >= MAX_DEBUGGING_NOTES) continue;
    const sentence = candidateSentences(event.text).find((candidate) => DEBUGGING_SENTENCE.test(candidate) && !candidate.endsWith("?"));
    if (!sentence) continue;
    const excerpt = truncate(sentence, 240);
    const id = sessionEvidence(log, source, event, `Session ${code(source.file)} records a debugging note.`, excerpt);
    findings.push({ area: "session", statement: { text: `Debugging note from ${code(source.file)}: “${excerpt}”`, level: "documented", evidence: [id] } });
  }
  return findings;
}

function sessionEvidence(log: EvidenceLog, source: SessionSource, event: SessionEvent, statement: string, excerpt: string): string {
  return log.add({
    level: "documented",
    category: "session",
    statement,
    source: {
      kind: "session",
      file: source.file,
      eventId: event.id,
      ...(event.timestamp ? { timestamp: event.timestamp } : {}),
      ...(event.role ? { role: event.role } : {}),
      excerpt,
    },
  });
}
