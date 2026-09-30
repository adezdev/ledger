import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, UsageError } from "../src/cli/args.ts";
import { runCli } from "../src/cli/run.ts";
import { VERSION } from "../src/version.ts";
import { FixtureRepo } from "./helpers/fixture-repo.ts";

interface Captured {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(argv: string[], cwd: string): Promise<Captured> {
  let stdout = "";
  let stderr = "";
  const code = await runCli(argv, { stdout: (text) => (stdout += text), stderr: (text) => (stderr += text), cwd });
  return { code, stdout, stderr };
}

describe("argument parsing", () => {
  test("defaults to analyzing the current directory in every format", () => {
    expect(parseArgs(["analyze"])).toEqual({ kind: "analyze", repositoryPath: ".", formats: new Set(["md", "html", "json"]), sessionPaths: [] });
  });

  test("accepts short, long, and inline option forms", () => {
    expect(parseArgs(["analyze", "../repo", "-o", "out dir", "--format=html", "-f", "json", "-s", "a.md", "--session=b.jsonl"])).toEqual({
      kind: "analyze",
      repositoryPath: "../repo",
      outDir: "out dir",
      formats: new Set(["html", "json"]),
      sessionPaths: ["a.md", "b.jsonl"],
    });
    expect(parseArgs(["analyze", "--format", "md,json"])).toMatchObject({ formats: new Set(["md", "json"]) });
    expect(parseArgs(["analyze", "--format", "all"])).toMatchObject({ formats: new Set(["md", "html", "json"]) });
    expect(parseArgs(["analyze", "--", "--weird-dir"])).toMatchObject({ repositoryPath: "--weird-dir" });
  });

  test("recognizes help and version", () => {
    expect(parseArgs([])).toEqual({ kind: "help", topic: "global" });
    expect(parseArgs(["--help"])).toEqual({ kind: "help", topic: "global" });
    expect(parseArgs(["analyze", "--help"])).toEqual({ kind: "help", topic: "analyze" });
    expect(parseArgs(["help", "analyze"])).toEqual({ kind: "help", topic: "analyze" });
    expect(parseArgs(["--version"])).toEqual({ kind: "version" });
  });

  test("rejects bad input with specific messages", () => {
    const cases: [string[], RegExp][] = [
      [["analyse"], /Unknown command "analyse"/],
      [["--bogus"], /Unknown option --bogus/],
      [["analyze", "--format", "pdf"], /Unknown format "pdf"/],
      [["analyze", "--out"], /--out requires a directory/],
      [["analyze", "--out="], /--out requires a directory/],
      [["analyze", "--session", "--format", "md"], /--session requires a file path/],
      [["analyze", "a", "b"], /at most one repository path/],
      [["analyze", "--verbose"], /Unknown option --verbose/],
    ];
    for (const [argv, message] of cases) {
      expect(() => parseArgs(argv)).toThrow(UsageError);
      expect(() => parseArgs(argv)).toThrow(message);
    }
  });
});

describe("ledger analyze", () => {
  let repo: FixtureRepo;
  beforeAll(async () => {
    repo = await FixtureRepo.create("my project");
    await repo.commit("feat: initial version", { "README.md": "# My Project\n\nA project with a space in its path.\n", "src/app.ts": "export {};\n" });
    await repo.commit("test: add tests", { "test/app.test.ts": "\n" });
  });
  afterAll(async () => {
    await repo.cleanup();
  });

  test("writes all reports to .ledger at the repository root and prints a summary", async () => {
    const result = await run(["analyze", "src"], repo.root);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect((await readdir(join(repo.root, ".ledger"))).sort()).toEqual(["report.html", "report.json", "report.md"]);
    expect(result.stdout).toContain("Project");
    expect(result.stdout).toContain("2 analyzed on main");
    expect(result.stdout).toContain(join(".ledger", "report.html"));
    expect(result.stdout).toMatch(/Evidence\s+\d+ items: \d+ observed, \d+ documented, \d+ inferred/);
  });

  test("honors --out and --format", async () => {
    const out = join(repo.base, "custom output");
    const result = await run(["analyze", repo.root, "--out", out, "--format", "md"], repo.base);
    expect(result.code).toBe(0);
    expect(await readdir(out)).toEqual(["report.md"]);
    const markdown = await Bun.file(join(out, "report.md")).text();
    expect(markdown).toStartWith("# my project\n");
    expect(markdown).toContain("A project with a space in its path.");
  });

  test("includes session files and reports their warnings on stderr", async () => {
    const session = join(repo.base, "chat log.jsonl");
    await Bun.write(session, '{"role":"assistant","content":"We went with plain files rather than a database."}\nnot json\n');
    const out = join(repo.base, "with-session");
    const result = await run(["analyze", repo.root, "-o", out, "-f", "json", "--session", session], repo.base);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("ledger: warning: chat log.jsonl: Skipped 1 line");
    const report = await Bun.file(join(out, "report.json")).json();
    expect(report.sessions[0].file).toBe("chat log.jsonl");
    expect(result.stdout).toContain("Sessions");
  });

  test("fails with exit code 1 outside a Git repository", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ledger-cli-"));
    try {
      const result = await run(["analyze", "."], dir);
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/^ledger: error: Not a Git repository/);
      expect(result.stdout).toBe("");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("fails with exit code 1 for a missing session file", async () => {
    const result = await run(["analyze", repo.root, "--session", "nope.md", "--out", join(repo.base, "x")], repo.base);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Session file not found");
  });

  test("fails with exit code 2 for usage errors", async () => {
    const result = await run(["analyze", "--format", "pdf"], repo.root);
    expect(result.code).toBe(2);
    expect(result.stderr).toBe('ledger: Unknown format "pdf". Use md, html, json, or all.\nRun "ledger analyze --help" for usage.\n');
  });

  test("refuses to write into a path that is a file", async () => {
    const file = join(repo.base, "occupied");
    await Bun.write(file, "x");
    const result = await run(["analyze", repo.root, "--out", file], repo.base);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("is not a directory");
  });

  test("prints help and version", async () => {
    expect((await run(["--help"], repo.root)).stdout).toContain("ledger analyze [path] [options]");
    expect((await run(["analyze", "-h"], repo.root)).stdout).toContain("--session <file>");
    expect((await run(["--version"], repo.root)).stdout).toBe(`${VERSION}\n`);
  });
});

describe("executable", () => {
  test("runs through the bin entry point", async () => {
    const proc = Bun.spawn({ cmd: [process.execPath, join(import.meta.dir, "..", "src", "cli", "main.ts"), "--bogus"], stdout: "pipe", stderr: "pipe" });
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    expect(code).toBe(2);
    expect(stderr).toContain("Unknown option --bogus");

    const version = Bun.spawn({ cmd: [process.execPath, join(import.meta.dir, "..", "src", "cli", "main.ts"), "--version"], stdout: "pipe" });
    expect(await new Response(version.stdout).text()).toBe(`${VERSION}\n`);
    expect(await version.exited).toBe(0);
  });
});
