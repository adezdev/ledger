# Ledger

[![CI](https://github.com/adezdev/ledger/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/adezdev/ledger/actions/workflows/ci.yml)

Turn Git history into an evidence-backed engineering case study.

Ledger reads a Git repository (and, optionally, transcripts of your development sessions) and writes a case study of the project: what was built, how the work unfolded, which technical decisions were made, and what engineering practices are visible. Every claim in the report links to the commit, file, or session excerpt it came from, and is labeled as **observed**, **documented**, or **inferred**.

It runs locally, needs no account or API key, never uploads anything, and never executes code from the repository it analyzes.

## Why

A repository holds a lot of evidence about engineering ability: the order work happened in, how commits are scoped and explained, whether tests landed with the code, what CI checks, what the documentation says was decided and why. That evidence rarely makes it into a portfolio, a client handoff, or a retrospective, because writing it up by hand is slow, and summaries written from memory drift toward claims nobody can check.

Ledger does the tedious part and keeps itself honest. It reports what it can establish, says how it established it, and says what it could not establish.

## Example

This is Ledger run on its own repository:

```console
$ ledger analyze .
Ledger 0.1.0

  Project   ledger (TypeScript, Bun)
  Commits   28 analyzed on main at ba76881
  Timespan  Sep 29, 2026
  Evidence  42 items: 26 observed, 10 documented, 6 inferred
  Timeline  5 milestones, 10 decisions (9 documented, 1 inferred)
  Wrote     .ledger/report.md
            .ledger/report.html
            .ledger/report.json
```

The report contains:

1. **Overview**: what the project is (from its own metadata) and the shape of its history.
2. **Project snapshot**: commits, timespan, active days, files, line changes, test and CI artifacts, language mix, and detected technologies with the file that proves each one.
3. **Engineering timeline**: commits grouped into milestones, each linked to the commits it contains.
4. **Technical decisions**: documented decisions (ADRs, design sections, explicit commit messages, sessions) kept separate from inferred ones.
5. **Engineering evidence**: precise statements such as "Repository contains 12 test files" or "CI configuration `.github/workflows/ci.yml` includes steps running `bun test` for tests", never "the tests pass".
6. **Selected commits**: a few commits that best show how the work was done, with the reason each was chosen.
7. **Limitations**: what Ledger could not establish.
8. **Evidence appendix**: every referenced item with its provenance.

`report.html` is a single self-contained file (no scripts, fonts, or network requests) with light and dark themes, suitable for linking from a portfolio. `report.md` renders cleanly on GitHub. `report.json` is the machine-readable version for other tools.

## Install

Ledger needs [Bun](https://bun.sh) 1.1 or newer and Git 2.31 or newer.

```sh
git clone https://github.com/adezdev/ledger.git
cd ledger
bun install
bun link        # puts `ledger` on your PATH
```

Without linking, run it from the checkout with `bun run ledger -- <arguments>`.

## Usage

```text
ledger analyze [path] [options]

  -o, --out <dir>         Output directory (default: <repository root>/.ledger)
  -f, --format <format>   md, html, json, or all (default: all). Repeatable;
                          also accepts a comma-separated list such as md,html
  -s, --session <file>    Development-session transcript to include as
                          evidence: .md, .txt, .json, or .jsonl. Repeatable
  -h, --help              Show help
```

```sh
ledger analyze                                   # the repository you are in
ledger analyze ~/code/api --out ~/case-studies/api
ledger analyze . --format html
ledger analyze . --format md,json
ledger analyze . --session notes/session-1.md --session exports/chat.jsonl
```

`path` can be any directory inside a working tree; Ledger finds the repository root. Ledger analyzes the history reachable from `HEAD`. Consider adding `.ledger/` to your `.gitignore`.

Exit codes: `0` success, `1` analysis failed (not a repository, unreadable session file, and so on), `2` invalid arguments.

## Evidence levels

| Level | Meaning | Examples |
| --- | --- | --- |
| **Observed** | Read directly from Git history or tracked files. | Commit counts and dates, files present at `HEAD`, a dependency declared in `package.json`, a command in a CI workflow. |
| **Documented** | Stated by the project itself or by a session you supplied. Ledger reports that it was stated, not that it is true. | An ADR, a "Design decisions" section in the README, a commit message explaining a trade-off, a sentence in a session transcript. |
| **Inferred** | Derived by Ledger's heuristics. An interpretation, not a fact. | Language mix by file extension, milestone grouping, "Adopted GitHub Actions" because a workflow file first appeared in a later commit. |

Inferred statements are always labeled. Ledger does not upgrade an inference into a fact, and it does not claim anything it did not check: it never says tests pass, only that tests exist and what CI is configured to run.

## Development sessions

Transcripts of development sessions often hold the reasoning that commits leave out: alternatives considered, why something was chosen, what a bug turned out to be. Pass them with `--session`:

- **Markdown or text**: speaker turns such as `User:`, `**Assistant:**`, or `## Claude` are recognized; otherwise each paragraph is an event. Commands in shell code blocks (and `$ ` prompts) become command events, with their output.
- **JSON**: an array of entries, or an object holding one under a key such as `messages`, `events`, or `entries`.
- **JSONL**: one entry per line. Malformed lines are skipped with a warning.

For structured entries, Ledger recognizes common fields (`role`, `timestamp`, `content`, `text`, `command`, `tool`, `output`, `result`, and typed content parts such as `tool_use` and `tool_result`) and ignores the rest. Private model reasoning parts (`thinking`) are skipped. Every event keeps an identifier from the source file (an `id`, or a line number) so each excerpt in the report can be traced.

From sessions, Ledger extracts explicitly stated decisions, recorded commands, recorded test output, and debugging notes, all at the *documented* level. The report quotes short excerpts only, never whole transcripts. Ledger only reads files you pass explicitly; it does not look for Claude Code, Codex, or any other tool's history on its own.

## Privacy and security

Ledger is designed to be safe to point at private and commercial repositories.

- **Nothing leaves your machine.** No network requests, telemetry, or accounts. Git is run with `protocol.allow=never` and lazy fetching disabled, so even a partial clone cannot make it download.
- **Nothing from the repository runs.** Ledger does not install dependencies, run scripts, or run tests. It invokes Git with argument arrays (never a shell) and overrides configuration a hostile `.git/config` could use to run programs (`core.fsmonitor`, signature verification, external diff and textconv drivers). The test suite checks this against a repository configured to run a payload.
- **Only tracked files, and only a few of them.** Ledger lists files tracked at `HEAD` and reads an allowlist of metadata, CI configuration, and documentation files, from Git's object database rather than the working tree, so untracked, ignored, and modified-but-uncommitted files are never read, and tracked symlinks cannot point it elsewhere. Credential-like files (`.env`, keys, `.npmrc`, ...) are never read. Source code contents are not read at all. Each file read is capped at 256 KB.
- **Reports are safe to publish.** All repository-controlled text is escaped. The HTML report is built with an escaping template, carries a restrictive Content-Security-Policy, and contains no scripts. Bidirectional-override characters are neutralized. Reports contain no absolute paths, and author email addresses are never included.

What *does* end up in a report: the repository directory name, branch, commit subjects and short SHAs, author display names (for the contributor count, in `report.json`), file paths, excerpts of documentation, and short excerpts from sessions you supplied. Review a report before publishing it, as you would any document.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## How it works

```text
CLI (src/cli)           parse arguments, print summary, map errors to exit codes
  -> app (src/app)      the analyze use case: snapshot + sessions -> case study -> files
    -> git (src/git)          read-only Git access: commits, tree, tags, blobs
    -> session (src/session)  normalize explicitly supplied transcripts
    -> analysis (src/analysis) classify paths and commits, detect technologies,
                               parse manifests and CI, extract decisions
    -> synthesis (src/synthesis) milestones, selected commits, overview, limits
  -> render (src/render)  Markdown, HTML, JSON from the case study only
  -> output (src/output)  write report files
```

The case study (`src/domain/model.ts`) is the contract between analysis and presentation, and it is exactly what `report.json` contains. Synthesis is a pure function with no clock or randomness, so the same repository state produces byte-identical reports. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the evidence model, the JSON schema, and how the heuristics work.

## Design decisions

- **Deterministic core, no LLM.** Every statement comes from rules that can be read and tested. An optional AI narrative pass can be layered on later without the core depending on it.
- **Zero runtime dependencies.** Bun, the Git CLI, and web-standard APIs cover what Ledger needs; TOML, YAML, and JSONC are read with small purpose-built readers for the subset manifests use.
- **Git CLI rather than a Git library.** Git itself is the most faithful reader of a repository, and NUL-delimited output (`-z`) makes parsing robust to any file name or commit message.
- **Read from the object database, not the working tree.** Reports describe committed history; this also rules out symlink tricks and uncommitted secrets.
- **Certainty is part of the data model.** Evidence levels live in the model and the JSON, not only in the prose, so every consumer inherits the distinction.
- **Escaping by construction.** HTML is produced only through a tagged template that escapes every interpolation, so forgetting to escape is not possible.

## Limitations

- Only history reachable from `HEAD` is analyzed; other branches are not.
- Ledger never runs the project, so it cannot say whether tests or builds pass, or measure coverage.
- Languages are classified by file extension. Technology detection covers common manifests and configuration files and will miss unusual setups.
- Milestones are heuristic groupings of adjacent commits; a squash-merged or single-commit history has little timeline to recover.
- Decisions are found only where they are stated explicitly (ADRs, design sections, "Why ...?" headings, explicit commit messages, session transcripts) or visible as tooling changes. Undocumented reasoning stays undocumented.
- Line counts exclude lockfiles, binary files, merge commits, and automated commits; author dates can be rewritten by rebases.
- Automated commits are recognized by author name (`*[bot]`, Dependabot, Renovate, ...). A bot committing under a person's name counts as that person.
- Rust unit tests inside source files are not counted as test files, because Ledger does not read source code.
- The whole history is held in memory, which is fine for typical projects but not tuned for very large monorepos.

## Development

```sh
bun install
bun run check              # TypeScript, strict mode
bun test                   # unit and integration tests (creates temporary Git repositories)
bun run ledger -- analyze . --out .ledger --format all    # analyze Ledger itself
```

The test suite configures Git identity inside its own temporary repositories and never touches your global Git configuration.

## Future direction

Likely next steps, none of which the core needs to change for: native adapters for Claude Code and Codex session exports, analyzing a repository by URL, an optional AI pass that rewrites the narrative while keeping evidence links, report themes, PDF export, and a GitHub Action that publishes a report per release.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
