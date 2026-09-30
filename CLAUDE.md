# Ledger

CLI that turns a Git repository (plus optional session transcripts) into an evidence-backed case study: `.ledger/report.{md,html,json}`. TypeScript on Bun, zero runtime dependencies. Details: `README.md` (usage), `docs/ARCHITECTURE.md` (design, JSON schema, heuristics).

## Commands

```sh
bun install
bun run check                  # tsc --noEmit, strict
bun test                       # all tests; creates temp Git repos, needs git on PATH
bun test test/render.test.ts   # one file
bun run ledger -- analyze . --out .ledger --format all   # dogfood
```

Run `bun run check` and `bun test` before every commit.

## Architecture boundaries

`cli -> app -> {git, session, synthesis -> analysis} -> domain`, then `app -> render -> output`.

- `src/domain/model.ts` is the contract. `CaseStudy` *is* `report.json`: changing its shape is a schema change (see the compatibility policy in docs/ARCHITECTURE.md).
- Only `src/git/exec.ts` starts processes. Git logic stays out of analysis; analysis policy (what to read) stays out of `git/`.
- `synthesis/` is pure: no I/O, no `Date.now()`, no randomness, no locale-dependent formatting (use `domain/format.ts`).
- Renderers consume the `CaseStudy` only: no Git, filesystem, or session imports. `test/security.test.ts` enforces this.

## Invariants

- Every report statement has an evidence level (`observed`, `documented`, `inferred`) and evidence IDs that resolve. Never present an inference as a fact; never state that tests/CI pass (Ledger does not run them).
- Evidence levels: Git facts and file contents are observed; things the project or a session *says* are documented; heuristics are inferred and carry a `basis`.
- Output is deterministic for a given repository state and inputs.
- Reports never contain absolute paths or author emails.
- Put repository-controlled values in statement text with `code()` from `src/domain/statement.ts`, not raw backticks.

## Security rules

- Never execute anything from the analyzed repository: no scripts, hooks, installs, or tests. Keep the Git hardening flags in `git/exec.ts`.
- Pass Git arguments as arrays. Never build shell strings.
- Read file contents from Git objects (`readBlobs`), only for paths allowed by `analysis/documents.ts`. Never read untracked/ignored files or credential-like paths; never read source code contents.
- No network access at runtime.
- Build HTML only with the `html` tagged template (`render/escape.ts`). `trustedHtml` is for constant, developer-authored markup only. Escape Markdown with `escapeMarkdown`/`markdownCode`.
- Session files are read only when passed via `--session`. Do not add auto-discovery of tool history.
- Write non-ASCII characters in source as `\uXXXX` escapes when they are invisible or directional.

## Contributing

- Conventional Commits, one logical change per commit.
- Tests for new behavior; integration tests create repositories with `test/helpers/fixture-repo.ts` (local identity, isolated config, cleaned up).
- Validate at boundaries (CLI args, Git output, session files, manifests); keep internal transformations simple. No `any`, no unchecked casts.
- No new runtime dependencies without a strong reason. No frameworks, servers, databases, or LLM calls in the core.
- Dogfood after changing analysis or rendering: run Ledger on this repository and read the report.
