import { REPORT_FORMATS, type ReportFormat } from "../app/report.ts";

export class UsageError extends Error {
  constructor(
    message: string,
    readonly topic: "global" | "analyze" = "global",
  ) {
    super(message);
    this.name = "UsageError";
  }
}

export type Command =
  | { kind: "help"; topic: "global" | "analyze" }
  | { kind: "version" }
  | {
      kind: "analyze";
      repositoryPath: string;
      outDir?: string;
      formats: Set<ReportFormat>;
      sessionPaths: string[];
    };

const FORMAT_ALIASES: Record<string, ReportFormat[]> = {
  md: ["md"],
  markdown: ["md"],
  html: ["html"],
  json: ["json"],
  all: [...REPORT_FORMATS],
};

/** Parses command-line arguments (without the executable and script path). */
export function parseArgs(argv: readonly string[]): Command {
  const [first, ...rest] = argv;
  if (first === undefined || first === "-h" || first === "--help") return { kind: "help", topic: "global" };
  if (first === "-v" || first === "-V" || first === "--version") return { kind: "version" };
  if (first === "help") {
    if (rest[0] === undefined) return { kind: "help", topic: "global" };
    if (rest[0] === "analyze") return { kind: "help", topic: "analyze" };
    throw new UsageError(`No help available for "${rest[0]}".`);
  }
  if (first === "analyze") return parseAnalyze(rest);
  if (first.startsWith("-")) throw new UsageError(`Unknown option ${first}.`);
  throw new UsageError(`Unknown command "${first}". Did you mean "ledger analyze ${first}"?`);
}

function parseAnalyze(args: readonly string[]): Command {
  const positional: string[] = [];
  const sessionPaths: string[] = [];
  const formats = new Set<ReportFormat>();
  let outDir: string | undefined;
  let optionsEnded = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (optionsEnded || !arg.startsWith("-") || arg === "-") {
      positional.push(arg);
      continue;
    }
    if (arg === "--") {
      optionsEnded = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") return { kind: "help", topic: "analyze" };

    const equals = arg.indexOf("=");
    const name = arg.startsWith("--") && equals !== -1 ? arg.slice(0, equals) : arg;
    const inlineValue = arg.startsWith("--") && equals !== -1 ? arg.slice(equals + 1) : undefined;
    const value = (description: string): string => {
      if (inlineValue !== undefined) {
        if (inlineValue === "") throw new UsageError(`${name} requires ${description}.`, "analyze");
        return inlineValue;
      }
      const next = args[i + 1];
      if (next === undefined || (next.startsWith("-") && next !== "-")) throw new UsageError(`${name} requires ${description}.`, "analyze");
      i++;
      return next;
    };

    switch (name) {
      case "-o":
      case "--out":
        outDir = value("a directory");
        break;
      case "-f":
      case "--format":
        for (const requested of value("a format (md, html, json, or all)").split(",")) {
          const resolved = FORMAT_ALIASES[requested.trim().toLowerCase()];
          if (!resolved) throw new UsageError(`Unknown format "${requested}". Use md, html, json, or all.`, "analyze");
          for (const format of resolved) formats.add(format);
        }
        break;
      case "-s":
      case "--session":
        sessionPaths.push(value("a file path"));
        break;
      default:
        throw new UsageError(`Unknown option ${name} for "analyze".`, "analyze");
    }
  }

  if (positional.length > 1) {
    throw new UsageError(`Expected at most one repository path, got ${positional.length}: ${positional.join(" ")}`, "analyze");
  }
  const command: Command = {
    kind: "analyze",
    repositoryPath: positional[0] ?? ".",
    formats: formats.size > 0 ? formats : new Set(REPORT_FORMATS),
    sessionPaths,
  };
  if (outDir !== undefined) command.outDir = outDir;
  return command;
}
