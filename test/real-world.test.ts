import { describe, expect, test } from "bun:test";
import { classifyCommand, commandSegments, parseCiConfiguration } from "../src/analysis/ci.ts";
import { isAutomatedAuthor } from "../src/analysis/commits.ts";
import { analyzeEngineering } from "../src/analysis/engineering.ts";
import { parseManifest } from "../src/analysis/manifests.ts";
import { EvidenceLog } from "../src/domain/evidence.ts";
import type { Commit } from "../src/domain/model.ts";
import { commandKey, extractSessionInsights, statesDecision } from "../src/session/extract.ts";
import { parseTextSession } from "../src/session/formats.ts";
import { buildCaseStudy } from "../src/synthesis/case-study.ts";
import { buildMilestones, isReleaseBookkeeping, ridesAlong } from "../src/synthesis/milestones.ts";
import { makeCommit, makeSnapshot, summaries } from "./helpers/builders.ts";

/**
 * Regressions found by running Ledger on real repositories: bot-maintained
 * profiles, release-tagged CLIs, Rust crates, and Claude Code transcripts.
 */

function hour(n: number): string {
  return new Date(Date.UTC(2024, 0, 1, 9) + n * 3_600_000).toISOString();
}

describe("automated commits", () => {
  test("are recognized by author name", () => {
    for (const name of ["github-actions[bot]", "dependabot[bot]", "renovate[bot]", "Renovate Bot", "dependabot-preview"]) expect(isAutomatedAuthor(name)).toBe(true);
    for (const name of ["Ada Lovelace", "bottle", "robotics-team", "renovator"]) expect(isAutomatedAuthor(name)).toBe(false);
  });

  test("are counted but kept out of activity, milestones, and highlights", () => {
    const commits: Commit[] = [
      makeCommit("Add profile README", { parents: [], at: hour(0), body: "Start the profile with a short introduction to the projects.", changes: [{ path: "README.md", status: "added", additions: 60 }] }),
      makeCommit("Generate cards in CI", { at: hour(2), body: "Render the stats cards in a workflow because the hosted service kept failing.", changes: [{ path: "scripts/cards.mjs", status: "added", additions: 300 }] }),
    ];
    for (let day = 1; day <= 30; day++) {
      const bot = makeCommit("chore: refresh profile cards", { at: hour(24 * day), changes: [{ path: "profile/card.svg", additions: 4, deletions: 4 }] });
      commits.push({ ...bot, authorName: "github-actions[bot]" });
    }
    const study = buildCaseStudy({ snapshot: makeSnapshot({ files: { "README.md": "# Profile\n" }, commits }), sessions: [], generatorVersion: "test" });

    expect(study.metrics).toMatchObject({ commits: 32, automatedCommits: 30, automatedAuthors: ["github-actions[bot]"], contributors: 1, activeDays: 1, timespanDays: 1, additions: 360 });
    expect(study.commits.filter((commit) => commit.automated)).toHaveLength(30);
    expect(study.timeline.flatMap((milestone) => milestone.commits)).toHaveLength(2);
    expect(study.selectedCommits.every((commit) => !commit.subject.includes("refresh"))).toBe(true);
    expect(study.overview[0]?.text).toContain("2 by 1 contributor");
    expect(study.overview[0]?.text).toContain("30 automated commits by `github-actions[bot]`");
    expect(study.limitations.some((limitation) => limitation.includes("automation accounts"))).toBe(true);
  });
});

describe("milestone bookkeeping", () => {
  test("release commits and tiny commits ride along with the preceding work", () => {
    const [feature, release, bump, tagged] = summaries([
      makeCommit("feat: parse flags", { changes: [{ path: "src/lib.rs", additions: 80 }] }),
      makeCommit("chore(release): 0.13.0", { changes: [{ path: "package.json", additions: 1, deletions: 1 }, { path: "CHANGELOG.md", additions: 20 }] }),
      makeCommit("ci: bump actions/checkout to v5", { changes: [{ path: ".github/workflows/ci.yml", additions: 1, deletions: 1 }] }),
      makeCommit("fix: typo", { changes: [{ path: "src/lib.rs", additions: 1, deletions: 1 }] }),
    ]);
    if (!feature || !release || !bump || !tagged) throw new Error("fixture");
    expect(ridesAlong(feature, new Set())).toBe(false);
    expect(ridesAlong(release, new Set())).toBe(true);
    expect(ridesAlong(bump, new Set())).toBe(true);
    expect(ridesAlong(tagged, new Set([tagged.sha]))).toBe(false);
  });

  test("recognizes release bookkeeping subjects", () => {
    const released = (subject: string) => isReleaseBookkeeping(summaries([makeCommit(subject)])[0] ?? summaries([makeCommit("x")])[0]!);
    for (const subject of ["chore(release): 0.13.0", "chore: prepare 0.1.0 release", "chore: prepare 0.1.0", "Bump version to 2.0.0", "v1.4.2", "release 3.1"]) expect(released(subject)).toBe(true);
    for (const subject of ["feat: add release notes view", "chore: refresh cards", "fix: prepare statement cache"]) expect(released(subject)).toBe(false);
  });

  test("titles describe the substantive work and show tag ranges", () => {
    const raw = [
      makeCommit("feat(repl): add history", { at: hour(0), changes: [{ path: "src/repl.ts", additions: 50 }] }),
      makeCommit("chore(release): 0.2.0", { at: hour(1), changes: [{ path: "package.json", additions: 1, deletions: 1 }] }),
      makeCommit("feat(repl): add banner", { at: hour(2), changes: [{ path: "src/repl.ts", additions: 40 }] }),
      makeCommit("chore(release): 0.3.0", { at: hour(3), changes: [{ path: "package.json", additions: 1, deletions: 1 }] }),
    ];
    const tags = [
      { name: "v0.2.0", sha: raw[1]?.sha ?? "" },
      { name: "v0.3.0", sha: raw[3]?.sha ?? "" },
    ];
    const log = new EvidenceLog();
    const milestones = buildMilestones(summaries(raw), tags, log);
    expect(milestones.map((milestone) => milestone.title)).toEqual(["v0.2.0 – v0.3.0 · Feature work: repl and src"]);
    expect(milestones[0]?.evidence).toHaveLength(3);
  });

  test("small leading commits join a milestone instead of standing alone", () => {
    const raw = [
      makeCommit("chore: initialize", { parents: [], at: hour(0), changes: [{ path: "Cargo.toml", status: "added", additions: 30 }] }),
      makeCommit("docs: add metadata", { at: hour(1), changes: [{ path: "README.md", additions: 10 }] }),
      makeCommit("ci: add checks", { at: hour(2), changes: [{ path: ".github/workflows/ci.yml", status: "added", additions: 30 }] }),
    ];
    for (let i = 0; i < 20; i++) raw.push(makeCommit(`feat: parser step ${i}`, { at: hour(3 + i), changes: [{ path: "src/lib.rs", additions: 200 }] }));
    raw.push(makeCommit("refactor: split crate into modules", { at: hour(30), changes: [{ path: "src/lib.rs", additions: 4000, deletions: 4000 }, { path: "src/command/mod.rs", additions: 4000 }] }));
    const milestones = buildMilestones(summaries(raw), [], new EvidenceLog());
    expect(milestones.every((milestone) => milestone.commits.length >= 3 || milestone.additions + milestone.deletions > 1000)).toBe(true);
    expect(milestones.at(-1)?.title).toBe("Refactoring: src and command");
  });
});

describe("engineering findings on real configurations", () => {
  test("chained scripts are described by every purpose they serve", () => {
    const scripts = { typecheck: "tsc --noEmit", lint: "biome check .", test: "bun test", check: "bun run typecheck && bun run lint && bun run test", format: "biome format --write ." };
    expect(classifyCommand(scripts.check, scripts).purposes).toEqual(["test", "typecheck", "lint"]);
    const manifest = parseManifest("package.json", JSON.stringify({ name: "x", scripts }));
    const report = analyzeEngineering(makeSnapshot({ files: { "package.json": "{}" } }), manifest ? [manifest] : [], [], new EvidenceLog());
    const texts = report.findings.map((finding) => finding.statement.text);
    expect(texts).toContain("`package.json` defines a `check` script for tests, type checking, and linting: `bun run typecheck && bun run lint && bun run test`.");
    expect(texts).toContain("`package.json` defines a `format` script for formatting: `biome format --write .`.");
  });

  test("workflows without recognized checks show what they do run", () => {
    const workflow = [
      "jobs:",
      "  cards:",
      "    steps:",
      "      - run: node scripts/generate-cards.mjs",
      "      - run: |",
      "          set -euo pipefail",
      "          git config user.name 'github-actions[bot]'",
      "          git push",
    ].join("\n");
    const ci = parseCiConfiguration(".github/workflows/cards.yml", workflow);
    expect(ci?.commands.map((command) => command.command)).toContain("git config user.name 'github-actions[bot]'");
    const report = analyzeEngineering(makeSnapshot(), [], ci ? [ci] : [], new EvidenceLog());
    expect(report.findings.map((finding) => finding.statement.text)).toEqual([
      "GitHub Actions configuration `.github/workflows/cards.yml` includes steps running `node scripts/generate-cards.mjs`; none are recognized as tests, linting, or builds.",
    ]);
  });

  test("Rust projects say that in-source unit tests are not counted", () => {
    const snapshot = makeSnapshot({ files: { "Cargo.toml": "", "src/lib.rs": "", "tests/api.rs": "" } });
    const report = analyzeEngineering(snapshot, [], [], new EvidenceLog());
    expect(report.findings[0]?.statement.text).toBe(
      "Repository contains 1 separate test file. Rust unit tests written inside source files are not counted, because Ledger does not read source code.",
    );
    const study = buildCaseStudy({ snapshot, sessions: [], generatorVersion: "test" });
    expect(study.limitations.some((limitation) => limitation.startsWith("Rust unit tests"))).toBe(true);
  });
});

describe("sessions from real transcripts", () => {
  test("only explicit choices count as decisions", () => {
    for (const sentence of [
      "We decided to read files from Git's object database.",
      "I'll use the canonical SPDX copy rather than retyping the license.",
      "Pass Git arguments as an array using Bun's process APIs rather than building shell strings.",
      "Went with a ruleset because classic branch protection kept failing.",
    ]) {
      expect(statesDecision(sentence)).toBe(true);
    }
    for (const sentence of [
      "That points to something environmental in CI rather than a platform bug.",
      "I'll track the source line number per line instead of deriving offsets:",
      "Should we use SQLite rather than Postgres?",
      "Ledger read the committed file rather than the working copy of it.",
    ]) {
      expect(statesDecision(sentence)).toBe(false);
    }
  });

  test("at most two decisions come from one message, and regression tests are not debugging notes", () => {
    const text = [
      "Assistant: We decided to use plain files. We chose Bun over Node. We went with NUL-delimited output instead of parsing text.",
      "",
      "Adding regression tests for each finding so they stay fixed.",
      "",
      "User: The root cause was a stale cache entry in the parser.",
    ].join("\n");
    const insights = extractSessionInsights([parseTextSession("notes.md", text)], new EvidenceLog());
    expect(insights.decisions).toHaveLength(2);
    expect(insights.findings.filter((finding) => finding.statement.text.startsWith("Debugging note")).map((finding) => finding.statement.text)).toEqual([
      "Debugging note from `notes.md`: “The root cause was a stale cache entry in the parser.”",
    ]);
  });

  test("commands are counted by their essentials, not as raw pipelines", () => {
    expect(commandKey("bun test 2>&1")).toBe("bun test");
    expect(commandKey("bun test test/render.test.ts")).toBe("bun test");
    expect(commandKey("CI=1 timeout 60 bunx tsc --noEmit")).toBe("bunx tsc --noEmit");
    expect(commandKey("cd /tmp/x")).toBeUndefined();
    expect(commandSegments("python3 - <<'EOF'\nprint('a; b | c')\nEOF\nbun test && bunx tsc --noEmit").map(commandKey)).toEqual(["python3 -", "bun test", "bunx tsc --noEmit"]);

    const session = parseTextSession(
      "log.md",
      ["```console", "$ bun test 2>&1 | tail -5 && bunx tsc --noEmit", "$ bun test test/a.test.ts", "$ bunx tsc --noEmit && echo ok", "```"].join("\n"),
    );
    const [commands] = extractSessionInsights([session], new EvidenceLog()).findings;
    expect(commands?.statement.text).toBe("Session `log.md` records 3 commands, including `bun test` (2×) and `bunx tsc --noEmit` (2×).");
  });
});
