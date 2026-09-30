# Security policy

Ledger is meant to be safe to run against private and untrusted repositories. If you find a way to break that, please report it privately.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: [open a draft security advisory](https://github.com/adezdev/ledger/security/advisories/new). Please do not open a public issue for a vulnerability.

Include the Ledger version (`ledger --version`), your operating system and Git version, and the smallest repository, session file, or command that reproduces the problem. A report is acknowledged as soon as possible, and fixes are released before details are disclosed.

## Supported versions

Only the latest version on `main` receives security fixes.

## What counts as a vulnerability

Ledger promises the following. Any way to violate one of them is in scope:

- **No code execution from the analyzed repository.** Nothing in a repository (Git configuration, attributes, hooks, scripts, file names, or contents) can make Ledger or the Git processes it starts execute a program.
- **No network access.** Analysis makes no network requests, including lazy fetches from partial clones.
- **Only allowlisted, tracked files are read.** Ledger does not read untracked or ignored files, credential-like files such as `.env`, source code contents, or anything outside the repository (for example through a tracked symlink). Session files are read only when passed with `--session`.
- **Reports are safe to open and publish.** Repository or session content cannot inject script or markup into `report.html` or `report.md`, and reports do not contain absolute local paths or author email addresses.

Out of scope: problems that need an already-compromised machine, or a malicious Git or Bun installation; denial of service from very large repositories; and heuristic mistakes such as wrong technology detection or milestone grouping. Those are ordinary bugs, so please open an issue for them.
