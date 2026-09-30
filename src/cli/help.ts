import { VERSION } from "../version.ts";

export const GLOBAL_HELP = `Ledger ${VERSION}
Turn Git history into an evidence-backed engineering case study.

Usage:
  ledger analyze [path] [options]
  ledger help [command]
  ledger --help | --version

Commands:
  analyze    Analyze a Git repository and write a case study report

Options:
  -h, --help       Show help
  -v, --version    Show the version

Run "ledger analyze --help" for analysis options.
`;

export const ANALYZE_HELP = `Usage: ledger analyze [path] [options]

Analyze the Git repository containing [path] (default: the current directory)
and write a case study as Markdown, HTML, and JSON.

Options:
  -o, --out <dir>         Output directory (default: <repository root>/.ledger)
  -f, --format <format>   md, html, json, or all (default: all). Repeatable;
                          also accepts a comma-separated list such as md,html
  -s, --session <file>    Development-session transcript to include as
                          evidence: .md, .txt, .json, or .jsonl. Repeatable
  -h, --help              Show this help

Ledger reads Git metadata and selected tracked files. It never executes code
from the repository, never reads untracked or ignored files, and makes no
network requests. Session files are read only when passed with --session.

Examples:
  ledger analyze
  ledger analyze ../my-project --out ./case-study --format html
  ledger analyze . --session notes/session.md --session export.jsonl
`;
