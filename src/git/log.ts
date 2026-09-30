import type { Commit, FileChange, FileChangeStatus } from "../domain/model.ts";
import { runGit } from "./exec.ts";

/**
 * Each record starts with a record separator and a marker, followed by
 * NUL-terminated header fields. With `-z`, the raw and numstat entries that
 * follow are NUL-delimited too, so no field needs escaping or quoting.
 */
const RECORD_MARKER = "\x1eLEDGER";
const HEADER_FIELDS = ["%H", "%h", "%P", "%aN", "%aI", "%s", "%b"] as const;
const LOG_FORMAT = `${RECORD_MARKER}%x00${HEADER_FIELDS.join("%x00")}%x00`;

export const LOG_ARGS: readonly string[] = [
  "log",
  "-z",
  "--raw",
  "--numstat",
  "--no-abbrev",
  "-M",
  "--diff-merges=off",
  "--no-ext-diff",
  "--no-textconv",
  "--no-color",
  `--format=${LOG_FORMAT}`,
  "HEAD",
  "--",
];

export async function readCommits(root: string): Promise<Commit[]> {
  const output = await runGit(LOG_ARGS, { cwd: root });
  // Git lists newest first; the domain model is chronological.
  return parseLog(output).reverse();
}

export class LogParseError extends Error {
  constructor(message: string) {
    super(`Unexpected git log output: ${message}`);
    this.name = "LogParseError";
  }
}

/** Parses the output of `git log` run with {@link LOG_ARGS}. Order is preserved. */
export function parseLog(output: string): Commit[] {
  const tokens = output.split("\0");
  const commits: Commit[] = [];
  let i = 0;

  const next = (): string => {
    const token = tokens[i++];
    if (token === undefined) throw new LogParseError("output ended in the middle of a commit");
    return token;
  };

  while (i < tokens.length) {
    const marker = tokens[i];
    if (marker === undefined || marker === "" || marker === "\n") {
      i++;
      continue;
    }
    if (marker !== RECORD_MARKER) throw new LogParseError(`expected a commit header, found ${JSON.stringify(marker.slice(0, 40))}`);
    i++;

    const sha = next();
    const shortSha = next();
    const parents = next();
    const authorName = next();
    const authoredAt = next();
    const subject = next();
    const body = next();
    if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new LogParseError(`invalid commit id ${JSON.stringify(sha)}`);

    const raw = new Map<string, { status: FileChangeStatus; previousPath?: string }>();
    const numstat = new Map<string, { additions: number | null; deletions: number | null; previousPath?: string }>();
    const order: string[] = [];
    const remember = (path: string): void => {
      if (!raw.has(path) && !numstat.has(path)) order.push(path);
    };

    while (i < tokens.length) {
      const token = (tokens[i] ?? "").replace(/^\n/, "");
      if (token === "") {
        i++;
        continue;
      }
      if (token.startsWith(RECORD_MARKER)) break;
      i++;

      if (token.startsWith(":")) {
        const statusCode = token.slice(token.lastIndexOf(" ") + 1);
        const status = statusFromCode(statusCode);
        if (status === "renamed" || status === "copied") {
          const previousPath = next();
          const path = next();
          remember(path);
          raw.set(path, { status, previousPath });
        } else {
          const path = next();
          remember(path);
          raw.set(path, { status });
        }
        continue;
      }

      const match = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(token);
      if (!match) throw new LogParseError(`unrecognized diff entry ${JSON.stringify(token.slice(0, 40))}`);
      const additions = match[1] === "-" ? null : Number(match[1]);
      const deletions = match[2] === "-" ? null : Number(match[2]);
      const inlinePath = match[3] ?? "";
      if (inlinePath === "") {
        // Renames and copies put the old and new paths in the following two tokens.
        const previousPath = next();
        const path = next();
        remember(path);
        numstat.set(path, { additions, deletions, previousPath });
      } else {
        remember(inlinePath);
        numstat.set(inlinePath, { additions, deletions });
      }
    }

    const changes: FileChange[] = order.map((path) => {
      const rawEntry = raw.get(path);
      const stat = numstat.get(path);
      const change: FileChange = {
        path,
        status: rawEntry?.status ?? "unknown",
        additions: stat ? stat.additions : 0,
        deletions: stat ? stat.deletions : 0,
      };
      const previousPath = rawEntry?.previousPath ?? stat?.previousPath;
      if (previousPath !== undefined) change.previousPath = previousPath;
      return change;
    });

    commits.push({
      sha,
      shortSha,
      parents: parents === "" ? [] : parents.split(" "),
      authorName,
      authoredAt,
      subject,
      body: body.trim(),
      changes,
    });
  }

  return commits;
}

function statusFromCode(code: string): FileChangeStatus {
  switch (code[0]) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "type-changed";
    default:
      return "unknown";
  }
}
