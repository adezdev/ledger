import { join, resolve } from "node:path";
import { analyzeRepository } from "../app/analyze.ts";
import { renderReports } from "../app/report.ts";
import { GitError, GitNotFoundError } from "../git/exec.ts";
import { LogParseError } from "../git/log.ts";
import { RepositoryError } from "../git/repository.ts";
import { OutputError, writeReports } from "../output/write.ts";
import { SessionInputError } from "../session/formats.ts";
import { VERSION } from "../version.ts";
import { parseArgs, UsageError } from "./args.ts";
import { ANALYZE_HELP, GLOBAL_HELP } from "./help.ts";
import { formatSummary } from "./summary.ts";

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
}

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

/** Runs the CLI and returns the process exit code. All errors are reported here. */
export async function runCli(argv: readonly string[], io: CliIO): Promise<number> {
  try {
    const command = parseArgs(argv);
    switch (command.kind) {
      case "help":
        io.stdout(command.topic === "analyze" ? ANALYZE_HELP : GLOBAL_HELP);
        return EXIT_OK;
      case "version":
        io.stdout(`${VERSION}\n`);
        return EXIT_OK;
      case "analyze": {
        const result = await analyzeRepository({
          repositoryPath: resolve(io.cwd, command.repositoryPath),
          sessionPaths: command.sessionPaths.map((path) => resolve(io.cwd, path)),
        });
        for (const session of result.sessions) {
          for (const warning of session.warnings) io.stderr(`ledger: warning: ${session.file}: ${warning}\n`);
        }
        const outDir = command.outDir !== undefined ? resolve(io.cwd, command.outDir) : join(result.repositoryRoot, ".ledger");
        const written = await writeReports(outDir, renderReports(result.caseStudy, command.formats));
        io.stdout(formatSummary(result, written, io.cwd));
        return EXIT_OK;
      }
    }
  } catch (error) {
    return reportError(error, io);
  }
}

function reportError(error: unknown, io: CliIO): number {
  if (error instanceof UsageError) {
    const hint = error.topic === "analyze" ? "ledger analyze --help" : "ledger --help";
    io.stderr(`ledger: ${error.message}\nRun "${hint}" for usage.\n`);
    return EXIT_USAGE;
  }
  if (
    error instanceof RepositoryError ||
    error instanceof SessionInputError ||
    error instanceof OutputError ||
    error instanceof GitNotFoundError ||
    error instanceof GitError ||
    error instanceof LogParseError
  ) {
    io.stderr(`ledger: error: ${error.message}\n`);
    return EXIT_FAILURE;
  }
  const message = error instanceof Error ? error.message : String(error);
  io.stderr(`ledger: unexpected error: ${message}\n`);
  if (process.env["LEDGER_DEBUG"] && error instanceof Error && error.stack) io.stderr(`${error.stack}\n`);
  else io.stderr("Set LEDGER_DEBUG=1 for a stack trace.\n");
  return EXIT_FAILURE;
}

