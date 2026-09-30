# Changelog

All notable changes to Ledger are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

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

[0.1.0]: https://github.com/adezdev/ledger/releases/tag/v0.1.0
