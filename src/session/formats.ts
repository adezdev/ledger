import { isRecord } from "../analysis/text.ts";
import type { SessionEvent, SessionFormat, SessionSource } from "../domain/model.ts";
import { normalizeEntry, normalizeTimestamp, MAX_EVENT_TEXT } from "./normalize.ts";

export class SessionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionInputError";
  }
}

/** Keys under which transcript exports commonly keep their list of entries. */
const CONTAINER_KEYS = ["messages", "events", "entries", "items", "conversation", "turns", "log", "history", "transcript", "records", "data", "chat_messages"];

export function parseSession(file: string, text: string, format: SessionFormat): SessionSource {
  const source =
    format === "json" ? parseJsonSession(file, text) : format === "jsonl" ? parseJsonlSession(file, text) : parseTextSession(file, text);
  if (source.events.length === 0) {
    throw new SessionInputError(`${file}: no recognizable session events found`);
  }
  return source;
}

export function parseJsonSession(file: string, text: string): SessionSource {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SessionInputError(`${file}: invalid JSON (${detail}). Use a .jsonl extension for one JSON object per line.`);
  }
  const entries = findEntries(data, 0);
  const events = entries.flatMap((entry, index) => normalizeEntry(entry, `entry ${index + 1}`));
  return { file, format: "json", events, warnings: [] };
}

function findEntries(data: unknown, depth: number): unknown[] {
  if (Array.isArray(data)) return data;
  if (!isRecord(data) || depth > 2) return [];
  for (const key of CONTAINER_KEYS) {
    const value = data[key];
    if (Array.isArray(value)) return value;
    if (isRecord(value)) {
      const nested = findEntries(value, depth + 1);
      if (nested.length > 0) return nested;
    }
  }
  return [data];
}

export function parseJsonlSession(file: string, text: string): SessionSource {
  const events: SessionEvent[] = [];
  const invalidLines: number[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === "") return;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      invalidLines.push(index + 1);
      return;
    }
    events.push(...normalizeEntry(entry, `line ${index + 1}`));
  });

  if (events.length === 0 && invalidLines.length > 0) {
    throw new SessionInputError(`${file}: no line contains valid JSON (checked ${invalidLines.length} non-empty lines)`);
  }
  const warnings =
    invalidLines.length === 0
      ? []
      : [`Skipped ${invalidLines.length} line${invalidLines.length === 1 ? "" : "s"} that ${invalidLines.length === 1 ? "is" : "are"} not valid JSON (line${invalidLines.length === 1 ? "" : "s"} ${summarizeLines(invalidLines)}).`];
  return { file, format: "jsonl", events, warnings };
}

function summarizeLines(lines: readonly number[]): string {
  const shown = lines.slice(0, 5).join(", ");
  return lines.length > 5 ? `${shown}, …` : shown;
}

const ROLE_WORDS = "user|human|me|assistant|ai|claude|codex|gpt|chatgpt|copilot|model|system|tool|developer";
const HEADING_SPEAKER = new RegExp(`^\\s{0,3}#{1,6}\\s+(?:\\*\\*|__)?(${ROLE_WORDS})\\b(?:\\*\\*|__)?\\s*(.*)$`, "i");
const INLINE_SPEAKER = new RegExp(`^\\s{0,3}(?:\\*\\*|__)?\\[?(${ROLE_WORDS})\\]?(?:\\*\\*|__)?\\s*(\\([^)]*\\))?\\s*(?:\\*\\*|__)?\\s*[:：]\\s*(?:\\*\\*|__)?\\s*(.*)$`, "i");
const TIMESTAMP = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/;
const SHELL_FENCE = /^\s*(```|~~~)\s*(bash|sh|shell|console|zsh|fish|terminal|powershell|pwsh|ps1?|cmd)\s*$/i;

/**
 * Reads plain-text and Markdown transcripts. Speaker turns are recognized from
 * lines such as "User:", "**Assistant:**" or "## Claude"; without them, each
 * paragraph becomes an event. Shell code blocks become command events.
 * Event IDs are line numbers, so every excerpt can be found in the source.
 */
export function parseTextSession(file: string, text: string): SessionSource {
  const lines = text.split(/\r?\n/);
  const turns: { line: number; role?: string; timestamp?: string; lines: NumberedLine[] }[] = [];
  let current: (typeof turns)[number] | null = null;
  let inFence = false;
  const hasSpeakers = lines.some((line) => HEADING_SPEAKER.test(line) || INLINE_SPEAKER.test(line));

  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const speaker = !inFence && hasSpeakers ? (HEADING_SPEAKER.exec(line) ?? INLINE_SPEAKER.exec(line)) : null;
    if (speaker?.[1]) {
      const rest = speaker.length === 4 ? (speaker[3] ?? "") : "";
      const stamp = TIMESTAMP.exec(line)?.[0];
      const timestamp = stamp ? normalizeTimestamp(stamp) : undefined;
      current = { line: index + 1, role: canonicalRole(speaker[1]), lines: rest.trim() === "" ? [] : [{ text: rest, number: index + 1 }], ...(timestamp ? { timestamp } : {}) };
      turns.push(current);
      return;
    }
    if (!hasSpeakers && line.trim() === "" && !inFence) {
      current = null;
      return;
    }
    if (!current) {
      if (line.trim() === "") return;
      current = { line: index + 1, lines: [] };
      turns.push(current);
    }
    current.lines.push({ text: line, number: index + 1 });
  });

  const events: SessionEvent[] = [];
  for (const turn of turns) {
    const body = turn.lines.map((line) => line.text).join("\n").trim();
    if (body === "") continue;
    const meta = { ...(turn.role ? { role: turn.role } : {}), ...(turn.timestamp ? { timestamp: turn.timestamp } : {}) };
    events.push({ id: `line ${turn.line}`, kind: "message", text: body.slice(0, MAX_EVENT_TEXT), ...meta });
    events.push(...commandsIn(turn.lines, meta));
  }
  return { file, format: "text", events, warnings: [] };
}

interface NumberedLine {
  text: string;
  number: number;
}

function commandsIn(lines: readonly NumberedLine[], meta: Pick<SessionEvent, "role" | "timestamp">): SessionEvent[] {
  const events: SessionEvent[] = [];
  let inShell = false;
  let inOtherFence = false;
  let prompted = false;
  let output: { id: string; lines: string[] } | null = null;
  const flushOutput = (): void => {
    if (output && output.lines.join("").trim() !== "") events.push({ id: output.id, kind: "result", text: output.lines.join("\n").trim(), ...meta });
    output = null;
  };

  for (const { text: line, number: lineNumber } of lines) {
    if (!inShell && !inOtherFence && SHELL_FENCE.test(line)) {
      inShell = true;
      prompted = false;
      continue;
    }
    if (/^\s*(```|~~~)/.test(line)) {
      if (inShell) flushOutput();
      if (inShell) inShell = false;
      else inOtherFence = !inOtherFence;
      continue;
    }
    const prompt = /^\s*[$>❯]\s+(.+)$/.exec(line);
    if ((inShell || !inOtherFence) && prompt?.[1] && (inShell || /^\s*\$\s/.test(line))) {
      flushOutput();
      prompted = true;
      events.push({ id: `line ${lineNumber}`, kind: "command", text: prompt[1].trim(), command: prompt[1].trim(), ...meta });
      output = { id: `line ${lineNumber}:output`, lines: [] };
      continue;
    }
    if (inShell) {
      if (prompted) output?.lines.push(line);
      else if (line.trim() !== "" && !line.trim().startsWith("#")) {
        events.push({ id: `line ${lineNumber}`, kind: "command", text: line.trim(), command: line.trim(), ...meta });
      }
    } else if (output && !inOtherFence) {
      if (line.trim() === "") flushOutput();
      else output.lines.push(line);
    }
  }
  flushOutput();
  return events;
}

function canonicalRole(word: string): string {
  const lower = word.toLowerCase();
  if (lower === "human" || lower === "me") return "user";
  if (["ai", "claude", "codex", "gpt", "chatgpt", "copilot", "model"].includes(lower)) return "assistant";
  return lower;
}
