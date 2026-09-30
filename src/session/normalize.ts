import { isRecord } from "../analysis/text.ts";
import type { SessionEvent } from "../domain/model.ts";

/** Longest text Ledger keeps from a single session event. */
export const MAX_EVENT_TEXT = 20_000;

const ID_KEYS = ["id", "uuid", "event_id", "eventId", "message_id", "messageId"];
const ROLE_KEYS = ["role", "speaker", "sender", "from"];
const TIME_KEYS = ["timestamp", "time", "created_at", "createdAt", "date", "datetime", "ts"];
const CONTENT_KEYS = ["content", "text", "message", "body", "value", "prompt", "response", "summary"];
const OUTPUT_KEYS = ["output", "result", "stdout", "stderr"];
const KNOWN_ROLES = new Set(["user", "human", "assistant", "ai", "model", "system", "tool", "developer"]);

/**
 * Converts one structured transcript entry into zero or more normalized events.
 * Recognizes common field names (role, timestamp, content, command, tool,
 * output, ...) and ignores everything else, so unknown shapes never throw.
 */
export function normalizeEntry(entry: unknown, position: string): SessionEvent[] {
  if (typeof entry === "string") return entry.trim() === "" ? [] : [{ id: position, kind: "message", text: clip(entry) }];
  if (!isRecord(entry)) return [];

  const nested = isRecord(entry["message"]) ? entry["message"] : undefined;
  const id = firstString(entry, ID_KEYS) ?? (nested ? firstString(nested, ID_KEYS) : undefined) ?? position;
  const role = normalizeRole(entry, nested);
  const timestamp = normalizeTimestamp(firstValue(entry, TIME_KEYS) ?? (nested ? firstValue(nested, TIME_KEYS) : undefined));
  const base = (suffix: string): Pick<SessionEvent, "id" | "role" | "timestamp"> => ({
    id: suffix === "" ? id : `${id}:${suffix}`,
    ...(role ? { role } : {}),
    ...(timestamp ? { timestamp } : {}),
  });

  const events: SessionEvent[] = [];
  const input = isRecord(entry["input"]) ? entry["input"] : undefined;
  const command = firstString(entry, ["command", "cmd"]) ?? (input ? firstString(input, ["command", "cmd"]) : undefined);
  const tool = firstString(entry, ["tool", "tool_name", "toolName"]) ?? (entry["type"] === "tool_use" || entry["type"] === "tool_call" ? firstString(entry, ["name"]) : undefined);

  if (command) events.push({ ...base(""), kind: "command", text: clip(command), command: clip(command), ...(tool ? { tool } : {}) });
  else if (tool) events.push({ ...base(""), kind: "tool", text: clip(input ? JSON.stringify(input) : tool), tool });

  const content = firstValue(entry, CONTENT_KEYS.filter((key) => key !== "message" || !nested)) ?? (nested ? firstValue(nested, CONTENT_KEYS) : undefined);
  if (content !== undefined) events.push(...contentEvents(content, base, events.length === 0 ? "" : "content"));

  for (const key of OUTPUT_KEYS) {
    const text = textOf(entry[key]);
    if (text) {
      const exit = entry["exit_code"] ?? entry["exitCode"];
      const suffix = typeof exit === "number" ? `\n(exit code ${exit})` : "";
      events.push({ ...base(events.length === 0 ? "" : key), kind: "result", text: clip(text + suffix) });
    }
  }
  return events;
}

/** Content may be a string or a list of typed parts (text, tool calls, tool results). */
function contentEvents(content: unknown, base: (suffix: string) => Pick<SessionEvent, "id" | "role" | "timestamp">, suffix: string): SessionEvent[] {
  if (!Array.isArray(content)) {
    const text = textOf(content);
    return text ? [{ ...base(suffix), kind: "message", text: clip(text) }] : [];
  }
  const events: SessionEvent[] = [];
  const texts: string[] = [];
  content.forEach((part, index) => {
    if (typeof part === "string") {
      texts.push(part);
      return;
    }
    if (!isRecord(part)) return;
    const type = part["type"];
    // Private model reasoning is not presented as evidence.
    if (type === "thinking" || type === "redacted_thinking" || type === "reasoning") return;
    if (type === "tool_use" || type === "tool_call" || type === "function_call") {
      const input = isRecord(part["input"]) ? part["input"] : isRecord(part["arguments"]) ? part["arguments"] : undefined;
      const tool = firstString(part, ["name"]) ?? "tool";
      const command = input ? firstString(input, ["command", "cmd"]) : undefined;
      events.push(
        command
          ? { ...base(`part${index}`), kind: "command", text: clip(command), command: clip(command), tool }
          : { ...base(`part${index}`), kind: "tool", text: clip(input ? JSON.stringify(input) : tool), tool },
      );
      return;
    }
    if (type === "tool_result" || type === "function_call_output") {
      const text = textOf(part["content"] ?? part["output"]);
      if (text) events.push({ ...base(`part${index}`), kind: "result", text: clip(text) });
      return;
    }
    const text = textOf(part["text"] ?? part["content"]);
    if (text) texts.push(text);
  });
  const joined = texts.join("\n").trim();
  if (joined !== "") events.unshift({ ...base(suffix), kind: "message", text: clip(joined) });
  return events;
}

function normalizeRole(entry: Record<string, unknown>, nested: Record<string, unknown> | undefined): string | undefined {
  const author = entry["author"];
  const candidates = [
    firstString(entry, ROLE_KEYS),
    isRecord(author) ? firstString(author, ["role", "name"]) : typeof author === "string" ? author : undefined,
    nested ? firstString(nested, ROLE_KEYS) : undefined,
    typeof entry["type"] === "string" && KNOWN_ROLES.has(entry["type"].toLowerCase()) ? entry["type"] : undefined,
  ];
  const role = candidates.find((candidate) => candidate !== undefined)?.toLowerCase();
  if (role === "human") return "user";
  if (role === "ai" || role === "model") return "assistant";
  return role ? role.slice(0, 40) : undefined;
}

/** Accepts ISO strings and Unix timestamps in seconds or milliseconds. */
export function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const date = new Date(value < 1e12 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return undefined;
  const date = new Date(trimmed.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function firstValue(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function textOf(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() === "" ? undefined : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map((item) => (isRecord(item) ? textOf(item["text"] ?? item["content"]) : textOf(item))).filter((part): part is string => part !== undefined);
    return parts.length > 0 ? parts.join("\n") : undefined;
  }
  if (isRecord(value)) return textOf(value["text"] ?? value["content"]);
  return undefined;
}

function clip(text: string): string {
  return text.length > MAX_EVENT_TEXT ? `${text.slice(0, MAX_EVENT_TEXT)}…` : text;
}
