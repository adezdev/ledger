import { describe, expect, test } from "bun:test";
import { classifyCommand, parseCiConfiguration } from "../src/analysis/ci.ts";
import { classifyCommit, subjectText } from "../src/analysis/commits.ts";
import { decisionsFromCommits, decisionsFromDocuments, inferredToolingDecisions } from "../src/analysis/decisions.ts";
import { selectDocuments } from "../src/analysis/documents.ts";
import { analyzeEngineering, strictTypeScriptFlags } from "../src/analysis/engineering.ts";
import { parseManifest, parseTomlLite } from "../src/analysis/manifests.ts";
import { areaOf, isSensitivePath, isTestSource } from "../src/analysis/paths.ts";
import { detectTechnologies } from "../src/analysis/technology.ts";
import { markdownSections, parseJsonc } from "../src/analysis/text.ts";
import { EvidenceLog } from "../src/domain/evidence.ts";
import type { TrackedFile } from "../src/domain/model.ts";
import { makeCommit, makeSnapshot } from "./helpers/builders.ts";

function tracked(paths: Record<string, number>): TrackedFile[] {
  return Object.entries(paths).map(([path, size], index) => ({ path, size, objectId: String(index), kind: "file" }));
}

describe("path classification", () => {
  test("recognizes test files across ecosystems", () => {
    for (const path of ["src/app.test.ts", "pkg/parser_test.go", "tests/test_api.py", "spec/user_spec.rb", "src/__tests__/a.js", "FooTests.cs"]) {
      expect(isTestSource(path)).toBe(true);
    }
    for (const path of ["src/testing.ts", "docs/testing.md", "test/fixtures/data.json", "latest.ts"]) {
      expect(isTestSource(path)).toBe(false);
    }
  });

  test("never selects credential files for reading", () => {
    expect(isSensitivePath(".env")).toBe(true);
    expect(isSensitivePath("config/.env.production")).toBe(true);
    expect(isSensitivePath("deploy/server.pem")).toBe(true);
    expect(isSensitivePath(".npmrc")).toBe(true);
    const selection = selectDocuments(tracked({ ".env": 10, "README.md": 10, "src/index.ts": 10, "package.json": 10, "docs/secrets.md": 10 }));
    expect(selection.read.map((file) => file.path).sort()).toEqual(["README.md", "package.json"]);
  });

  test("skips oversized documents and symlinks", () => {
    const files: TrackedFile[] = [
      { path: "README.md", size: 10 * 1024 * 1024, objectId: "a", kind: "file" },
      { path: "docs/guide.md", size: 100, objectId: "b", kind: "symlink" },
    ];
    expect(selectDocuments(files).skipped).toEqual([
      { path: "README.md", reason: "too-large" },
      { path: "docs/guide.md", reason: "symlink" },
    ]);
  });

  test("maps paths to coarse areas", () => {
    expect(areaOf("src/git/log.ts")).toBe("src/git");
    expect(areaOf("src/main.ts")).toBe("src");
    expect(areaOf("test/cli.test.ts")).toBe("test");
    expect(areaOf("README.md")).toBe("documentation");
    expect(areaOf("package.json")).toBe("project root");
    expect(areaOf(".github/workflows/ci.yml")).toBe("ci");
  });
});

describe("commit classification", () => {
  test("uses Conventional Commits prefixes as declared", () => {
    expect(classifyCommit(makeCommit("feat(cli): add flag"))).toEqual({ kind: "feat", source: "conventional", scope: "cli", breaking: false });
    expect(classifyCommit(makeCommit("fix!: drop node 16"))).toMatchObject({ kind: "fix", breaking: true });
    expect(classifyCommit(makeCommit("refactor: x", { body: "BREAKING CHANGE: api moved" })).breaking).toBe(true);
  });

  test("falls back to wording, then to changed files, and labels the source", () => {
    expect(classifyCommit(makeCommit("Fix crash on empty input"))).toMatchObject({ kind: "fix", source: "keyword" });
    expect(classifyCommit(makeCommit("Update things", { changes: ["README.md", "docs/a.md"] }))).toMatchObject({ kind: "docs", source: "structure" });
    expect(classifyCommit(makeCommit("wip"))).toMatchObject({ kind: "other", source: "none" });
    expect(classifyCommit(makeCommit("Merge branch 'x'", { parents: ["a", "b"] }))).toMatchObject({ kind: "merge" });
  });

  test("strips the prefix from subjects", () => {
    expect(subjectText("feat(api)!: add endpoint")).toBe("add endpoint");
    expect(subjectText("Plain subject")).toBe("Plain subject");
  });
});

describe("manifests", () => {
  test("reads package.json fields defensively", () => {
    const manifest = parseManifest(
      "package.json",
      JSON.stringify({ name: "@scope/tool", description: "Does things", bin: "./cli.js", scripts: { test: "vitest run", bad: 3 }, dependencies: { react: "^18" }, devDependencies: { typescript: "^5" } }),
    );
    expect(manifest).toMatchObject({ name: "@scope/tool", description: "Does things", binaries: ["tool"], scripts: { test: "vitest run" }, dependencies: ["react"], devDependencies: ["typescript"] });
    expect(parseManifest("package.json", "{ not json")).toBeNull();
    expect(parseManifest("package.json", "[]")).toBeNull();
  });

  test("reads Cargo.toml, pyproject.toml, and go.mod", () => {
    const cargo = parseManifest("Cargo.toml", '[package]\nname = "fast" # comment\nversion = "0.2.0"\ndescription = "A \\"quick\\" tool"\n\n[dependencies]\nserde = { version = "1" }\ntokio = "1"\n\n[dependencies.clap]\nversion = "4"\n');
    expect(cargo).toMatchObject({ name: "fast", version: "0.2.0", description: 'A "quick" tool' });
    expect(cargo?.dependencies.sort()).toEqual(["clap", "serde", "tokio"]);

    const pyproject = parseManifest("pyproject.toml", '[project]\nname = "svc"\ndependencies = [\n  "fastapi>=0.100",\n  "pydantic",\n]\n\n[tool.ruff]\nline-length = 100\n');
    expect(pyproject?.dependencies).toEqual(["fastapi", "pydantic"]);
    expect(pyproject?.details["tool.ruff"]).toBe("configured");

    const gomod = parseManifest("go.mod", "module github.com/me/app\n\ngo 1.22\n\nrequire (\n\tgithub.com/spf13/cobra v1.8.0\n\tgithub.com/stretchr/testify v1.9.0 // indirect\n)\n");
    expect(gomod).toMatchObject({ name: "github.com/me/app", details: { go: "1.22" } });
    expect(gomod?.dependencies).toEqual(["github.com/spf13/cobra", "github.com/stretchr/testify"]);
  });

  test("TOML reader ignores what it does not understand", () => {
    const toml = parseTomlLite('# c\nweird line\n[a]\nkey = 1_000\nflag = true\nmulti = """\nx\n"""\n');
    expect(toml.get("a")?.get("key")).toBe(1000);
    expect(toml.get("a")?.get("flag")).toBe(true);
    expect(toml.get("a")?.get("multi")).toBe("x");
  });
});

describe("technology detection", () => {
  test("marks manifest and marker evidence as observed and extension evidence as inferred", () => {
    const log = new EvidenceLog();
    const files = tracked({ "package.json": 300, "bun.lock": 1000, "tsconfig.json": 200, "src/a.ts": 9000, "src/b.ts": 1000, "styles/site.css": 500, "data/big.json": 90000 });
    const manifest = parseManifest("package.json", JSON.stringify({ name: "x", dependencies: { react: "18" } }));
    const { technologies, languages } = detectTechnologies(files, manifest ? [manifest] : [], log);
    const byName = new Map(technologies.map((technology) => [technology.name, technology]));

    expect(byName.get("React")).toMatchObject({ kind: "framework", level: "observed" });
    expect(byName.get("Bun")).toMatchObject({ level: "observed" });
    expect(byName.get("TypeScript")?.level).toBe("observed");
    expect(byName.get("CSS")).toMatchObject({ kind: "language", level: "inferred" });
    expect(languages.map((language) => language.language)).toEqual(["TypeScript", "CSS"]);
    expect(languages[0]?.share).toBeCloseTo(10000 / 10500);
    const cssEvidence = log.items.find((item) => item.id === byName.get("CSS")?.evidence[0]);
    expect(cssEvidence?.basis).toContain("file extension");
  });

  test("detects ecosystems beyond JavaScript", () => {
    const log = new EvidenceLog();
    const files = tracked({ "Cargo.toml": 10, "src/main.rs": 100, "CMakeLists.txt": 10, "app/App.csproj": 10, "pyproject.toml": 10, "go.mod": 10, "pnpm-lock.yaml": 10 });
    const names = detectTechnologies(files, [], log).technologies.map((technology) => technology.name);
    for (const name of ["Rust", "Cargo", "CMake", ".NET", "Go modules", "pnpm"]) expect(names).toContain(name);
  });
});

describe("CI configuration", () => {
  test("extracts inline, block, and list commands from GitHub Actions", () => {
    const workflow = [
      "name: CI",
      "on: [push]",
      "jobs:",
      "  test:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: oven-sh/setup-bun@v2",
      "      - run: bun install --frozen-lockfile",
      "      - name: Check",
      "        run: |",
      "          bun run check",
      "          bun test --coverage \\",
      "            --bail",
    ].join("\n");
    const config = parseCiConfiguration(".github/workflows/ci.yml", workflow, { check: "tsc --noEmit" });
    expect(config?.system).toBe("GitHub Actions");
    expect(config?.actions).toEqual(["actions/checkout@v4", "oven-sh/setup-bun@v2"]);
    expect(config?.commands.map((command) => [command.command, command.line, command.purposes])).toEqual([
      ["bun install --frozen-lockfile", 9, []],
      ["bun run check", 12, ["typecheck"]],
      ["bun test --coverage --bail", 13, ["test", "coverage"]],
    ]);
    expect(config?.commands[1]?.resolvedScript).toEqual({ name: "check", command: "tsc --noEmit" });
  });

  test("reads GitLab script lists", () => {
    const config = parseCiConfiguration(".gitlab-ci.yml", "test:\n  script:\n    - pytest -q\n    - ruff check .\n");
    expect(config?.commands.map((command) => command.purposes)).toEqual([["test"], ["lint"]]);
  });

  test("classifies common commands", () => {
    expect(classifyCommand("cargo test --all").purposes).toEqual(["test"]);
    expect(classifyCommand("npx eslint .").purposes).toEqual(["lint"]);
    expect(classifyCommand("npm run build").purposes).toEqual(["build"]);
  });
});

describe("engineering findings", () => {
  test("states what is configured without claiming that it passes", () => {
    const snapshot = makeSnapshot({
      files: {
        "package.json": JSON.stringify({ name: "x", scripts: { test: "bun test" } }),
        ".github/workflows/ci.yml": "jobs:\n  t:\n    steps:\n      - run: bun test\n",
        "tsconfig.json": '{ // comment\n "compilerOptions": { "strict": true, "noUncheckedIndexedAccess": true, }\n}',
        "test/a.test.ts": "",
        "test/b.test.ts": "",
        "README.md": "# X\n\n## Install\n\n## Usage\n",
      },
    });
    const manifest = parseManifest("package.json", snapshot.documents.get("package.json") ?? "");
    const ci = parseCiConfiguration(".github/workflows/ci.yml", snapshot.documents.get(".github/workflows/ci.yml") ?? "");
    const report = analyzeEngineering(snapshot, manifest ? [manifest] : [], ci ? [ci] : [], new EvidenceLog());
    const texts = report.findings.map((finding) => finding.statement.text);

    expect(texts).toContain("Repository contains 2 test files.");
    expect(texts).toContain("GitHub Actions configuration `.github/workflows/ci.yml` includes steps running `bun test` for tests.");
    expect(texts).toContain("`tsconfig.json` enables TypeScript `strict` mode plus `noUncheckedIndexedAccess`.");
    expect(texts.some((text) => /\b(pass|passing|coverage is|excellent)\b/i.test(text))).toBe(false);
    expect(report.findings.every((finding) => finding.statement.evidence.length > 0)).toBe(true);
  });

  test("reads strict flags from JSON with comments and trailing commas", () => {
    expect(strictTypeScriptFlags('{"compilerOptions": {"strict": true, /* x */ "noImplicitReturns": true,},}')).toEqual(["strict", "noImplicitReturns"]);
    expect(strictTypeScriptFlags("not json")).toEqual([]);
    expect(parseJsonc('{"url": "http://example.com/*not-a-comment*/"}')).toEqual({ url: "http://example.com/*not-a-comment*/" });
  });
});

describe("decisions", () => {
  test("extracts documented decisions from ADRs and design sections", () => {
    const log = new EvidenceLog();
    const documents = new Map([
      ["docs/adr/0001-use-sqlite.md", "# 1. Use SQLite for storage\n\nDate: 2024-02-01\n\n## Status\n\nAccepted\n\n## Decision\n\nWe will store data in SQLite because it needs no server.\n"],
      ["README.md", "# Tool\n\n## Design decisions\n\n- **Zero dependencies.** Keeps installs fast.\n- **Local first.** Works offline.\n\n## Why it exists\n\nMotivation, not a decision.\n\n## Why Bun?\n\nBun runs TypeScript directly.\n"],
    ]);
    const decisions = decisionsFromDocuments(documents, log);
    expect(decisions.map((decision) => decision.title)).toEqual(["Use SQLite for storage", "Zero dependencies", "Local first", "Why Bun?"]);
    expect(decisions[0]).toMatchObject({ status: "documented", date: "2024-02-01", detail: "We will store data in SQLite because it needs no server." });
    expect(decisions[1]?.detail).toBe("Keeps installs fast.");
    const source = log.items.find((item) => item.id === decisions[1]?.evidence[0])?.source;
    expect(source).toMatchObject({ kind: "file", path: "README.md", section: "Design decisions" });
  });

  test("takes decisions from explicit commit messages only", () => {
    const log = new EvidenceLog();
    const decisions = decisionsFromCommits(
      [
        makeCommit("refactor: replace regex parser with a tokenizer"),
        makeCommit("feat: add cache", { body: "Cache results in memory because disk IO dominated runtime in profiles." }),
        makeCommit("fix: handle null", { body: "Crashed because the value was null." }),
        makeCommit("feat: add button"),
      ],
      log,
    );
    expect(decisions.map((decision) => decision.title)).toEqual(["Replace regex parser with a tokenizer", "Add cache"]);
    expect(decisions[1]?.detail).toContain("because disk IO dominated");
  });

  test("infers tooling adoption and migrations from marker files, labeled as inferred", () => {
    const log = new EvidenceLog();
    const commits = [
      makeCommit("init", { parents: [], changes: [{ path: "package-lock.json", status: "added" }, { path: "src/a.ts", status: "added" }] }),
      makeCommit("switch", { changes: [{ path: "package-lock.json", status: "deleted" }, { path: "bun.lock", status: "added" }] }),
      makeCommit("ci", { changes: [{ path: ".github/workflows/ci.yml", status: "added" }] }),
    ];
    const files = tracked({ "bun.lock": 1, "src/a.ts": 1, ".github/workflows/ci.yml": 1 });
    const decisions = inferredToolingDecisions(commits, files, log);
    expect(decisions.map((decision) => [decision.title, decision.status])).toEqual([
      ["Moved from npm to Bun", "inferred"],
      ["Adopted GitHub Actions", "inferred"],
    ]);
  });
});

describe("markdown sections", () => {
  test("ignores headings inside fenced code", () => {
    const sections = markdownSections("# Title\n\nIntro\n\n```sh\n# not a heading\n```\n\n## Next\nBody");
    expect(sections.map((section) => section.title)).toEqual(["Title", "Next"]);
    expect(sections[0]?.body).toContain("# not a heading");
  });
});
