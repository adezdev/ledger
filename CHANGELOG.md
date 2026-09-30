# Changelog

All notable changes to Ledger are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-09-30

Better reports for long, multi-author histories, found by analyzing ripgrep, express, and HTTPie.

### Added

- Python projects are identified from `setup.cfg` metadata: name, description, dependencies, and executables.

### Changed

- Milestones stay balanced over long histories: size counts both commits and changed lines, and a single milestone can no longer absorb years of work.
- Only releases of the project itself shape and name milestones, weighted by significance (major and minor over patch and pre-release). Component tags in monorepos, such as `ignore-0.4.26`, no longer do.
- Subjects in the `area: message` style (`globset: fix ...`) are classified, with the area as the scope, and more common verbs are recognized ("Typo", "Release 1.2.0", "Updated ... submodule").
- Milestone labels come from the commits whose type is known.
- A commit states a decision only when it names what was chosen over what ("Replace X with Y", "Switch from X to Y", "Use X instead of Y"); moves, removals, typo fixes, and documentation-only commits no longer count.
- Several CI workflows without recognized checks are summarized in one statement, and the releases summary separates project releases from component tags.

### Fixed

- CI steps that run a tool through a variable, such as `${{ env.CARGO }} test`, are recognized, so projects testing this way no longer appear untested.
- `make` targets are classified by name instead of all counting as builds.
- Heredoc bodies in workflow scripts are no longer listed as commands.
- "Why should I use ...?" sections addressed to the reader are no longer read as design decisions.
- Large counts are formatted with digit grouping, and overview wording is corrected.
- Reports note that contributors are counted by author name.

## [0.1.0] - 2026-09-30

First release.

### Added

- `ledger analyze` turns a Git repository into an engineering case study, written as `report.md`, a self-contained `report.html`, and a versioned `report.json` (schema version 1).
- Every statement is labeled observed, documented, or inferred and links to the commit, file, or session excerpt it came from, collected in an evidence appendix.
- Reports cover an overview, project metrics, detected technologies, a milestone timeline, documented and inferred technical decisions, test/CI/type-checking/documentation evidence, selected commits, and limitations.
- `--session` adds development-session transcripts (Markdown, text, JSON, or JSONL, including Claude Code exports) as evidence of decisions, commands, test runs, and debugging notes.
- Commits by automation accounts such as `github-actions[bot]` are counted separately and kept out of activity figures, milestones, and highlights.
- Standalone executables for Linux, macOS, and Windows on x64 and ARM64, which need only Git installed.

### Security

- Ledger never executes code from the analyzed repository, never reads untracked, ignored, or credential files, and makes no network requests. Git runs with hardening that stops a hostile repository configuration from executing programs.
- Repository content is escaped in every report, and the HTML report ships a restrictive Content-Security-Policy with no scripts.

[0.2.0]: https://github.com/adezdev/ledger/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/adezdev/ledger/releases/tag/v0.1.0
