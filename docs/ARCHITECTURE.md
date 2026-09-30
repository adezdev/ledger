# Architecture

This document covers how Ledger is put together, the evidence model, the `report.json` contract, and how each heuristic works. The README covers usage.

## Data flow

```text
argv ──> cli/args ──> app/analyze ─┬─> app/snapshot ──> git/*            RepositorySnapshot
                                   ├─> session/load ──> session/formats   SessionSource[]
                                   └─> synthesis/case-study                CaseStudy
                                           ├─ analysis/* (manifests, technology, ci,
                                           │             engineering, decisions, commits)
                                           ├─ session/extract
                                           ├─ synthesis/milestones, highlights
                                           └─ domain/evidence (EvidenceLog)
         app/report ──> render/{markdown,html,json} ──> output/write
```

| Module | Responsibility | May depend on |
| --- | --- | --- |
| `domain/` | Types (`model.ts`), the evidence log, statement code spans, locale-independent formatting. No I/O. | nothing |
| `git/` | The only place a process is started (`exec.ts`). Discovery, log/tree/tag parsing, blob reads. Knows nothing about analysis policy. | `domain` |
| `analysis/` | Pure functions over repository facts: path classification, manifests, technologies, CI, findings, decisions. | `domain` |
| `session/` | Session file loading (the only file reads outside `git/`), format parsing, normalization, evidence extraction. | `domain`, `analysis` helpers |
| `synthesis/` | Assembles the `CaseStudy`. Pure: no I/O, clock, or randomness. | `domain`, `analysis`, `session/extract` |
| `render/` | Case study to text. Never touches Git, sessions, or the filesystem. | `domain` |
| `output/` | Writes files. | nothing |
| `app/` | Use cases wiring the above together. | everything below the CLI |
| `cli/` | Arguments, help, summary, exit codes. | `app` |

`test/security.test.ts` enforces two of these boundaries: only `git/exec.ts` may start processes, nothing may use the network, and renderers may not import Git, sessions, or filesystem APIs.

A web service or hosted report viewer would sit beside `cli/`, calling `app/analyze` (or consuming `report.json`) and reusing `render/`.

## Repository access

- `git rev-parse --show-toplevel` finds the root from any path inside a working tree.
- HEAD is resolved once; the log, tree, and blobs are then read from that SHA so a snapshot is internally consistent.
- `git log -z --raw --numstat -M --diff-merges=off` with a NUL-separated `--format` gives one record per commit. The parser (`git/log.ts`) walks tokens by grammar rather than splitting on separators, so no commit message or file name can break it. Merge commits have no diff; binary files have `null` line counts.
- `git ls-tree -r -z --long HEAD` lists tracked files with sizes. Submodules are skipped.
- `git cat-file --batch` reads selected blobs in one process.

Every invocation runs with `-c core.fsmonitor=false -c log.showSignature=false -c protocol.allow=never` (and related overrides), `GIT_NO_LAZY_FETCH=1`, `GIT_OPTIONAL_LOCKS=0`, and with inherited `GIT_*` variables removed so `GIT_DIR` and friends cannot redirect the analysis.

`analysis/documents.ts` decides which blobs are read: root and near-root manifests, `tsconfig.json`, CI configuration, the root README and license, `ARCHITECTURE.md`/`DESIGN.md`, ADRs, and Markdown under `docs/`. At most 200 files of up to 256 KB each; credential-like paths are excluded before anything else.

## Evidence model

```ts
type EvidenceLevel = "observed" | "documented" | "inferred";

interface Evidence {
  id: string;             // "E7", sequential in insertion order
  level: EvidenceLevel;
  category: EvidenceCategory;
  statement: string;      // what this evidence shows, phrased at its level
  basis?: string;         // for inferred evidence: how it was derived
  source: EvidenceSource; // commit | commit-range | file | file-set | tag | session
}
```

Report sections hold `Statement`s (`{ text, level, evidence: string[] }`) or richer records (`Milestone`, `Decision`, `SelectedCommit`) that carry evidence IDs. `EvidenceLog` deduplicates identical evidence, and a test checks that every referenced ID exists and every evidence item is referenced.

Statement text may contain inline code spans delimited by backticks. `domain/statement.ts#code` produces them and falls back to curly quotes for values that contain a backtick, so the span grammar cannot be broken by repository content. Renderers split spans with `inlineSegments` and escape each segment for their format.

Level assignment rules:

- Git facts, file presence, manifest declarations, CI commands, and compiler options are **observed**.
- Project metadata descriptions, documentation sections, ADRs, commit-message rationale, and anything from a session are **documented**. The report attributes them ("Commit message states ...", "Session x records ...").
- Extension-based language shares, milestone grouping, keyword-based commit types, and tooling adoption decisions are **inferred**, with a `basis`.

## report.json (schema version 1)

`report.json` is `JSON.stringify(caseStudy, null, 2)`; `CaseStudy` in `src/domain/model.ts` is the authoritative definition. Top-level fields:

| Field | Contents |
| --- | --- |
| `schemaVersion` | `"1"` |
| `generator` | `{ name: "ledger", version }` |
| `project` | name, optional description statement, repository directory name, branch, HEAD SHA, optional homepage (http/https only), license, version, tags |
| `overview` | `Statement[]` |
| `metrics` | commit, merge, and automated-commit counts (with the automation accounts' names), contributors, first/latest commit timestamps, timespan and active days, tracked and touched files, additions/deletions, test/CI/doc file counts, language shares. Activity figures cover commits by people: automated commits, lockfiles, binaries, and merge diffs are excluded |
| `technologies` | `{ name, kind, level, basis, evidence }[]` |
| `timeline` | `Milestone[]`: id, title, inferred summary statement, start/end, commit SHAs, themes, kind counts, tags, line counts, evidence |
| `decisions` | `Decision[]`: id, title, `status` (`documented` or `inferred`), detail, basis, date, evidence |
| `findings` | `{ area, statement }[]` where area is testing, ci, types, linting, build, benchmarks, documentation, release, process, or session |
| `selectedCommits` | SHA, subject, date, size, milestone, reasons, evidence |
| `sessions` | per supplied file: format, event and command counts, time range, import warnings |
| `commits` | every analyzed commit with classification, file changes, and an `automated` flag |
| `evidence` | `Evidence[]` |
| `limitations` | strings (may contain code spans) |

Compatibility policy: adding optional fields keeps `schemaVersion` at `"1"`. Removing or renaming a field, or changing its meaning, requires a new schema version.

Timestamps are ISO 8601 exactly as Git recorded them (with the author's offset); session timestamps are normalized to UTC.

## Heuristics

### Commit classification (`analysis/commits.ts`)

A Conventional Commits prefix is taken as declared (`source: "conventional"`). Otherwise the first word of the subject is matched against keyword lists (`"keyword"`), and failing that the changed files decide (`"structure"`: all docs, all tests, all CI, all manifests). The overview only calls the type breakdown observed when at least 80% of commits declare their type.

### Automated commits (`analysis/commits.ts`)

Commits whose author name marks an automation account (`*[bot]`, Dependabot, Renovate, and similar) are flagged `automated`. They stay in `commits` and are counted in `metrics.automatedCommits`, but activity figures, milestones, selected commits, commit-message decisions, and commit-practice statistics use commits by people only, and the report says so. A bot that commits under a person's name is not recognized.

### Milestones (`synthesis/milestones.ts`)

Agglomerative clustering over *adjacent* groups only, so milestones never interleave:

1. Each commit starts as a group, except commits that ride along with the group before them: merges (no diff of their own), release bookkeeping (`chore(release): ...`, "prepare 0.1.0", version bumps), and very small untagged commits (at most 5 changed lines in at most 2 files).
2. The merge cost of two neighbors combines topic dissimilarity (weighted Jaccard over Conventional Commits scopes and changed areas, where `src/cli` and scope `cli` are the same topic), commit-type dissimilarity, the time gap (log scale, saturating at two weeks), the combined size, and a penalty when the left group ends at a tag.
3. The cheapest merge is applied until at most `round(sqrt(n))` groups remain (capped at 12). Below that, neighbors merge only if they share at least half their topics and are within 12 hours, or if one of them is a crumb (at most 2 commits and under 10% of an average milestone's changed lines) within a week. Neither rule merges across a tag.

Titles come from the commit types and top themes of the substantive commits, ignoring ride-along bookkeeping (for example "Feature work and fixes: session, render"), prefixed with the tag or tag range a milestone contains ("v0.2.0 – v0.8.0").

### Selected commits (`synthesis/highlights.ts`)

Scores favor a descriptive message body, tests changed together with implementation, feature/fix/perf/refactor types, explicit decision statements, and tags, with a capped bonus for size. Bulk and vendored changes are penalized. The best commit of each milestone is taken first so the selection spans the history; up to six are shown, chronologically, each with its reasons.

### Decisions (`analysis/decisions.ts`, `session/extract.ts`)

Documented decisions come from ADR files (title, status, "Decision" section), from sections whose heading is about decisions, rationale, trade-offs, or principles or asks "Why ...?" (each top-level list item becomes a decision), from commit subjects that state a replacement or switch, from commit bodies of non-fix commits that give a reason ("because", "instead of", ...), and from session sentences that state a choice. A session sentence qualifies if it states a choice outright ("decided to", "chose", "went with", "I'll use", "in favor of") or pairs "instead of"/"rather than" with a verb such as use, keep, switch, or replace; sentences ending in ":" or "?" never qualify, and at most two decisions come from one message. Inferred decisions come from tooling marker files (lockfiles, CI workflows, linter configs) that first appear after the initial commit, or that disappear, with a replacement in the same category read as a migration.

### Engineering findings (`analysis/engineering.ts`)

Findings describe presence and configuration only: test files by naming convention (with a caveat for Rust, whose unit tests usually live inside source files that Ledger does not read), how many commits touched tests, package scripts for tests/type checking/linting/builds, CI commands classified by purpose (with `bun run x`-style commands, including chained ones, resolved to the scripts they run; workflows with no recognized purpose list their commands, minus shell plumbing), strict compiler flags, lint configuration files, benchmark files, documentation structure, tags, and commit-message practice.

In sessions, recorded commands are split into individual commands (heredoc bodies removed) and counted by their essentials, so `bun test test/a.test.ts 2>&1 | tail` counts as `bun test`.
