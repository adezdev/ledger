import { describe, expect, test } from "bun:test";
import { classifyCommand, parseCiConfiguration } from "../src/analysis/ci.ts";
import { classifyCommit } from "../src/analysis/commits.ts";
import { decisionsFromCommits, decisionsFromDocuments } from "../src/analysis/decisions.ts";
import { analyzeEngineering } from "../src/analysis/engineering.ts";
import { parseManifest } from "../src/analysis/manifests.ts";
import { releaseWeight } from "../src/analysis/releases.ts";
import { EvidenceLog } from "../src/domain/evidence.ts";
import type { Commit } from "../src/domain/model.ts";
import { buildCaseStudy } from "../src/synthesis/case-study.ts";
import { buildMilestones, workLabel } from "../src/synthesis/milestones.ts";
import { makeCommit, makeSnapshot, summaries } from "./helpers/builders.ts";

/**
 * Regressions found by analyzing long, multi-author open-source histories
 * (ripgrep, express, httpie): thousands of commits, hundreds of tags,
 * component releases in monorepos, and pre-Conventional-Commits subjects.
 */

describe("release tags", () => {
  test("weigh project releases by significance and ignore component tags", () => {
    expect(releaseWeight("0.4.0")).toBe(1);
    expect(releaseWeight("v5.0.0")).toBe(1);
    expect(releaseWeight("1.2")).toBe(1);
    expect(releaseWeight("15.1.3")).toBe(0.5);
    expect(releaseWeight("2.0.0beta2")).toBe(0.3);
    expect(releaseWeight("5.0.0-rc.1")).toBe(0.3);
    expect(releaseWeight("ignore-0.4.26")).toBe(0);
    expect(releaseWeight("pkg@1.2.3")).toBe(0);
    expect(releaseWeight("stable")).toBe(0);
  });

  test("the releases finding separates project releases from component tags", () => {
    const commits = [makeCommit("feat: a", { parents: [] }), makeCommit("feat: b"), makeCommit("feat: c")];
    const tags = [
      { name: "0.1.0", sha: commits[0]?.sha ?? "" },
      { name: "globset-0.4.1", sha: commits[1]?.sha ?? "" },
      { name: "0.2.0", sha: commits[2]?.sha ?? "" },
    ];
    const report = analyzeEngineering(makeSnapshot({ commits, tags }), [], [], new EvidenceLog());
    expect(report.findings.find((finding) => finding.area === "release")?.statement.text).toBe(
      "History includes 3 tags: 2 project releases from `0.1.0` to `0.2.0`, and 1 other tag, such as component releases.",
    );
  });
});

describe("milestones over long histories", () => {
  function longHistory(): { commits: Commit[]; tags: { name: string; sha: string }[] } {
    const commits: Commit[] = [];
    const tags: { name: string; sha: string }[] = [];
    let time = Date.UTC(2016, 0, 1);
    for (let i = 0; i < 1500; i++) {
      // Busy early years, then a long quiet tail, as in many mature projects.
      time += (i < 1000 ? 6 : 72) * 3_600_000;
      const area = ["core", "cli", "printer", "globset", "ignore"][i % 5] ?? "core";
      const commit = makeCommit(`${area}: change ${i}`, { at: new Date(time).toISOString(), changes: [{ path: `crates/${area}/src/lib.rs`, additions: 10 + (i % 7), deletions: 3 }] });
      commits.push(commit);
      if (i % 40 === 39) tags.push({ name: `0.${i}.0`, sha: commit.sha });
      if (i % 9 === 0) tags.push({ name: `${area}-0.${i}.1`, sha: commit.sha });
    }
    return { commits, tags };
  }

  test("stay balanced instead of letting tag-bounded crumbs and giants form", () => {
    const { commits, tags } = longHistory();
    const milestones = buildMilestones(summaries(commits), tags, new EvidenceLog());
    const sizes = milestones.map((milestone) => milestone.commits.length);
    expect(milestones).toHaveLength(12);
    expect(Math.max(...sizes)).toBeLessThan(commits.length * 0.25);
    expect(Math.min(...sizes)).toBeGreaterThan(20);
  });

  test("are named after project releases only", () => {
    const { commits, tags } = longHistory();
    const titles = buildMilestones(summaries(commits), tags, new EvidenceLog()).map((milestone) => milestone.title);
    expect(titles.every((title) => !/[a-z]+-0\.\d+\.1/.test(title))).toBe(true);
    expect(titles.filter((title) => /^0\.\d+\.0/.test(title)).length).toBeGreaterThan(6);
  });

  test("a single very large commit can stand as its own milestone", () => {
    const raw: Commit[] = [];
    for (let i = 0; i < 30; i++) raw.push(makeCommit(`feat: step ${i}`, { at: new Date(Date.UTC(2024, 0, 1) + i * 3_600_000).toISOString(), changes: [{ path: "src/lib.rs", additions: 100 }] }));
    raw.push(makeCommit("refactor: split crate into modules", { at: new Date(Date.UTC(2024, 0, 3)).toISOString(), changes: [{ path: "src/lib.rs", additions: 6000, deletions: 6000 }] }));
    const milestones = buildMilestones(summaries(raw), [], new EvidenceLog());
    expect(milestones.at(-1)?.commits).toHaveLength(1);
  });
});

describe("commit subjects without Conventional Commits", () => {
  test("area prefixes become scopes and the message is classified", () => {
    expect(classifyCommit(makeCommit("globset: fix a panic on empty patterns"))).toEqual({ kind: "fix", source: "keyword", scope: "globset", breaking: false });
    expect(classifyCommit(makeCommit("ignore/types: add janet"))).toMatchObject({ kind: "feat", scope: "ignore/types" });
    expect(classifyCommit(makeCommit("printer: tweak colors"))).toMatchObject({ kind: "other", scope: "printer" });
  });

  test("common verbs of older projects are recognized", () => {
    expect(classifyCommit(makeCommit("Fix typo in README")).kind).toBe("docs");
    expect(classifyCommit(makeCommit("Typo")).kind).toBe("docs");
    expect(classifyCommit(makeCommit("Release 1.2.0")).kind).toBe("chore");
    expect(classifyCommit(makeCommit("update type-is to 1.2.0")).kind).toBe("build");
    expect(classifyCommit(makeCommit("Updated connect submodule")).kind).toBe("build");
    expect(classifyCommit(makeCommit("Updated the router docs")).kind).toBe("other");
  });

  test("milestone labels ignore commits of unknown type when most are known", () => {
    const commits = summaries(["feat: a", "feat: b", "fix: c", "fix: d", "tweak things", "polish"].map((subject) => makeCommit(subject, { changes: ["src/a.ts"] })));
    // Counting the two unknown commits, no pair of kinds would reach 75%.
    expect(workLabel(commits)).toBe("Feature work and fixes");
  });
});

describe("decisions in long histories", () => {
  test("a commit decision must state what was chosen over what", () => {
    const subjects = [
      "Switch from Docopt to Clap.",
      "Replace crossbeam with deque.",
      "Use Thread instead of Timer for progress reporting.",
      "Removed the lists in favour of generators",
      "globset: switch to regex-automata",
      "Moved style.css to public/style.css",
      "Remove lazy_static from globset",
      "Using Plugin.init() to add methods to Request",
      "Fix typo, should be 'mode' instead of 'more'",
    ];
    const titles = decisionsFromCommits(subjects.map((subject) => makeCommit(subject, { changes: ["src/a.rs"] })), new EvidenceLog()).map((decision) => decision.title);
    expect(titles).toEqual(subjects.slice(0, 5).map((subject) => subject.charAt(0).toUpperCase() + subject.slice(1)));
  });

  test("documentation-only commits are not decisions", () => {
    expect(decisionsFromCommits([makeCommit("Switch over to the real README.", { changes: ["README.md"] })], new EvidenceLog())).toEqual([]);
  });

  test("FAQ questions addressed to the reader are not design rationale", () => {
    const documents = new Map([["README.md", "# Tool\n\n## Why should I use Tool?\n\n- It is fast.\n- It is small.\n\n## Why Rust?\n\nMemory safety without a garbage collector.\n"]]);
    expect(decisionsFromDocuments(documents, new EvidenceLog()).map((decision) => decision.title)).toEqual(["Why Rust?"]);
  });
});

describe("manifests and CI of mature projects", () => {
  test("setup.cfg metadata names the project; directives and markers are skipped", () => {
    const text = [
      "[metadata]",
      "name = httpie",
      "version = attr: httpie.__version__",
      "description = Modern command-line HTTP client",
      "",
      "[options]",
      "install_requires =",
      "    requests[socks]>=2.22.0",
      "    importlib-metadata>=1.4.0; python_version<\"3.8\"",
      "",
      "[options.entry_points]",
      "console_scripts =",
      "    http = httpie.__main__:main",
    ].join("\n");
    const manifest = parseManifest("setup.cfg", text);
    expect(manifest).toMatchObject({ name: "httpie", description: "Modern command-line HTTP client", dependencies: ["requests", "importlib-metadata"], binaries: ["http"] });
    expect(manifest?.version).toBeUndefined();
    const study = buildCaseStudy({ snapshot: makeSnapshot({ files: { "setup.cfg": text } }), sessions: [], generatorVersion: "test" });
    expect(study.project.name).toBe("httpie");
  });

  test("tools run through variables and make targets are recognized", () => {
    expect(classifyCommand("${{ env.CARGO }} test --verbose --workspace").purposes).toEqual(["test"]);
    expect(classifyCommand("$PYTHON -m pytest").purposes).toEqual(["test"]);
    expect(classifyCommand("make test-cover").purposes).toEqual(["test", "coverage"]);
    expect(classifyCommand("make codestyle").purposes).toEqual(["lint"]);
    expect(classifyCommand("make venv").purposes).toEqual([]);
    expect(classifyCommand("make install && make build").purposes).toEqual(["build"]);
  });

  test("heredoc bodies in workflow scripts are not commands", () => {
    const workflow = ["jobs:", "  publish:", "    steps:", "      - run: |", "          node <<'EOF'", "          const fs = require('fs')", "          EOF", "          npm publish"].join("\n");
    expect(parseCiConfiguration(".github/workflows/publish.yml", workflow)?.commands.map((command) => command.command)).toEqual(["node <<'EOF'", "npm publish"]);
  });

  test("several workflows without recognized steps are summarized in one statement", () => {
    const configurations = ["stale", "codeql", "tests"].map((name) =>
      parseCiConfiguration(`.github/workflows/${name}.yml`, `jobs:\n  a:\n    steps:\n      - run: ${name === "tests" ? "pytest" : "echo hi && ./notify.sh"}\n`),
    );
    const report = analyzeEngineering(makeSnapshot(), [], configurations.filter((configuration) => configuration !== null), new EvidenceLog());
    expect(report.findings.map((finding) => finding.statement.text)).toEqual([
      "GitHub Actions configuration `.github/workflows/tests.yml` includes steps running `pytest` for tests.",
      "2 other CI configurations, such as release or maintenance workflows, run no step recognized as tests, linting, or builds: `.github/workflows/stale.yml` and `.github/workflows/codeql.yml`.",
    ]);
  });
});

describe("overview wording", () => {
  test("lists directories with a correct count of the rest", () => {
    const files: Record<string, string> = {};
    for (const directory of ["a", "b", "c", "d", "e", "f", "g"]) files[`${directory}/x.txt`] = "";
    const study = buildCaseStudy({ snapshot: makeSnapshot({ files }), sessions: [], generatorVersion: "test" });
    expect(study.overview[1]?.text).toContain("organized under `a/`, `b/`, `c/`, `d/`, `e/`, `f/`, and 1 other directory.");
  });
});
