import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { decodeText } from "../analysis/text.ts";
import type { SessionFormat, SessionSource } from "../domain/model.ts";
import { parseSession, SessionInputError } from "./formats.ts";

/** Largest session file Ledger will read. */
export const MAX_SESSION_BYTES = 25 * 1024 * 1024;

export function sessionFormatFor(path: string): SessionFormat {
  const extension = extname(path).toLowerCase();
  if (extension === ".json") return "json";
  if (extension === ".jsonl" || extension === ".ndjson") return "jsonl";
  return "text";
}

/** Reads a session file the user explicitly supplied. Ledger never searches for session files itself. */
export async function loadSession(path: string): Promise<SessionSource> {
  const file = basename(path);
  let size: number;
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new SessionInputError(`Session path is not a file: ${path}`);
    size = info.size;
  } catch (error) {
    if (error instanceof SessionInputError) throw error;
    throw new SessionInputError(`Session file not found: ${path}`);
  }
  if (size > MAX_SESSION_BYTES) {
    throw new SessionInputError(`Session file is larger than ${MAX_SESSION_BYTES / 1024 / 1024} MB: ${path}`);
  }

  const text = decodeText(await Bun.file(path).bytes());
  if (text === null) throw new SessionInputError(`Session file looks binary, expected text, Markdown, JSON, or JSONL: ${path}`);
  return parseSession(file, text, sessionFormatFor(path));
}
