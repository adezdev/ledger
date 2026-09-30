import { describe, expect, test } from "bun:test";
import { EvidenceLog } from "../src/domain/evidence.ts";
import type { Commit } from "../src/domain/model.ts";
import { buildCaseStudy, safeHomepage } from "../src/synthesis/case-study.ts";
import { formatCount, formatDate, inclusiveDays } from "../src/domain/format.ts";
import { buildMilestones, groupCommits, targetMilestoneCount, workLabel } from "../src/synthesis/milestones.ts";
import { makeCommit, makeSnapshot, summaries } from "./helpers/builders.ts";

function day(n: number, hour = 10): string {
  return `2024-01-${String(n).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`;
}

function subjects(groups: { subject: string }[][]): string[][] {
  return groups.map((group) => group.map((commit) => commit.subject));
}

describe("milestone grouping", () => {
  test("targets roughly the square root of the commit count", () => {
    expect(targetMilestoneCount(1)).toBe(1);
    expect(targetMilestoneCount(4)).toBe(2);
    expect(targetMilestoneCount(16)).toBe(4);
    expect(targetMilestoneCount(10_000)).toBe(12);
  });

  test("keeps a single commit as a single milestone", () => {
    const commits = summaries([makeCommit("feat: only", { changes: ["src/a.ts"] })]);
    expect(subjects(groupCommits(commits, new Map()))).toEqual([["feat: only"]]);
  });

  test("groups by shared area and splits on long gaps", () => {
    const commits = summaries([
      makeCommit("feat(parser): tokenizer", { at: day(1, 9), changes: ["src/parser/token.ts"] }),
      makeCommit("feat(parser): grammar", { at: day(1, 10), changes: ["src/parser/grammar.ts"] }),
      makeCommit("test(parser): cases", { at: day(1, 11), changes: ["src/parser/grammar.ts", "test/parser.test.ts"] }),
      makeCommit("feat(parser): errors", { at: day(1, 12), changes: ["src/parser/errors.ts"] }),
      makeCommit("feat(ui): layout", { at: day(20, 9), changes: ["src/ui/layout.ts"] }),
      makeCommit("feat(ui): theme", { at: day(20, 10), changes: ["src/ui/theme.ts"] }),
      makeCommit("fix(ui): contrast", { at: day(20, 11), changes: ["src/ui/theme.ts"] }),
      makeCommit("docs(ui): screenshots", { at: day(20, 12), changes: ["src/ui/README.md"] }),
      makeCommit("feat(ui): menu", { at: day(20, 13), changes: ["src/ui/menu.ts"] }),
    ]);
    expect(subjects(groupCommits(commits, new Map()))).toEqual([
      ["feat(parser): tokenizer", "feat(parser): grammar", "test(parser): cases", "feat(parser): errors"],
      ["feat(ui): layout", "feat(ui): theme", "fix(ui): contrast", "docs(ui): screenshots", "feat(ui): menu"],
    ]);
  });

  test("a tag ends a milestone", () => {
    const raw = [
      makeCommit("feat: a", { at: day(1, 9), changes: ["src/core/a.ts"] }),
      makeCommit("feat: b", { at: day(1, 10), changes: ["src/core/b.ts"] }),
      makeCommit("feat: c", { at: day(1, 11), changes: ["src/core/c.ts"] }),
      makeCommit("feat: d", { at: day(1, 12), changes: ["src/core/d.ts"] }),
    ];
    const tagged = new Map([[raw[1]?.sha ?? "", 1]]);
    expect(subjects(groupCommits(summaries(raw), tagged))).toEqual([
      ["feat: a", "feat: b"],
      ["feat: c", "feat: d"],
    ]);
  });

  test("merge commits stay with the work before them", () => {
    const commits = summaries([
      makeCommit("feat: a", { at: day(1), changes: ["src/a.ts"] }),
      makeCommit("Merge branch 'a'", { at: day(1, 11), parents: ["x", "y"] }),
      makeCommit("feat: b", { at: day(9), changes: ["lib/b.ts"] }),
      makeCommit("feat: c", { at: day(9, 11), changes: ["lib/c.ts"] }),
    ]);
    const groups = subjects(groupCommits(commits, new Map()));
    expect(groups[0]).toEqual(["feat: a", "Merge branch 'a'"]);
  });

  test("is deterministic and covers every commit exactly once, in order", () => {
    const raw: Commit[] = [];
    for (let i = 0; i < 60; i++) {
      const area = ["src/api", "src/db", "docs", "src/ui"][Math.floor(i / 15)] ?? "src";
      raw.push(makeCommit(`feat: change ${i}`, { at: new Date(Date.UTC(2024, 0, 1) + i * 5 * 3_600_000).toISOString(), changes: [`${area}/file${i % 3}.ts`] }));
    }
    const commits = summaries(raw);
    const first = groupCommits(commits, new Map());
    const second = groupCommits(commits, new Map());
    expect(subjects(first)).toEqual(subjects(second));
    expect(first.flat().map((commit) => commit.sha)).toEqual(commits.map((commit) => commit.sha));
    expect(first.map((group) => group.length)).toEqual([15, 15, 15, 15]);
  });

  test("milestones link every commit and describe themselves as inferred", () => {
    const raw = [makeCommit("feat(cli): parse flags", { at: day(1), changes: ["src/cli/args.ts"] }), makeCommit("feat(cli): help", { at: day(1, 11), changes: ["src/cli/help.ts"] })];
    const log = new EvidenceLog();
    const [milestone] = buildMilestones(summaries(raw), [{ name: "v0.1.0", sha: raw[1]?.sha ?? "" }], log);
    expect(milestone?.commits).toEqual(raw.map((commit) => commit.sha));
    expect(milestone?.title).toBe("v0.1.0 · Feature work: cli");
    expect(milestone?.summary.level).toBe("inferred");
    expect(milestone?.tags).toEqual(["v0.1.0"]);
    const evidence = log.items.find((item) => item.id === milestone?.evidence[0]);
    expect(evidence).toMatchObject({ level: "inferred", category: "milestone", source: { kind: "commit-range", count: 2 } });
  });
});

describe("milestone titles", () => {
  test("name one dominant kind, two shared kinds, or mixed work", () => {
    const kinds = (...subjects: string[]) => summaries(subjects.map((subject) => makeCommit(subject, { changes: ["src/a.ts"] })));
    expect(workLabel(kinds("feat: a", "feat: b", "fix: c"))).toBe("Feature work");
    const mixed = summaries([
      makeCommit("fix: a", { changes: ["src/a.ts"] }),
      makeCommit("fix: b", { changes: ["src/a.ts"] }),
      makeCommit("test: c", { changes: [{ path: "test/a.test.ts", additions: 400 }] }),
      makeCommit("build: d", { changes: [{ path: "package.json", additions: 1 }] }),
    ]);
    expect(workLabel(mixed)).toBe("Fixes and testing");
    expect(workLabel(kinds("fix: a", "fix: b", "build: c"))).toBe("Fixes");
    expect(workLabel(kinds("fix: a", "build: b", "build: c", "fix: d"))).toBe("Fixes and build tooling");
    expect(workLabel(kinds("feat: a", "fix: b", "docs: c", "test: d"))).toBe("Development");
  });

  test("do not repeat the kind as a theme", () => {
    const raw = [makeCommit("docs: guide", { at: day(1), changes: ["docs/guide.md"] }), makeCommit("docs: readme", { at: day(1, 11), changes: ["README.md"] })];
    const [milestone] = buildMilestones(summaries(raw), [], new EvidenceLog());
    expect(milestone?.title).toBe("Documentation");
  });
});

describe("case study", () => {
  test("is a pure function of its input", () => {
    const snapshot = makeSnapshot({ files: { "README.md": "# Demo\n\nA demo project for testing Ledger.\n", "src/index.ts": "export {};\n" } });
    const first = JSON.stringify(buildCaseStudy({ snapshot, sessions: [], generatorVersion: "test" }));
    const second = JSON.stringify(buildCaseStudy({ snapshot, sessions: [], generatorVersion: "test" }));
    expect(first).toBe(second);
  });

  test("every evidence reference resolves, and every evidence item is referenced", () => {
    const snapshot = makeSnapshot({
      files: {
        "package.json": JSON.stringify({ name: "demo", description: "Demo tool", scripts: { test: "bun test" } }),
        "README.md": "# Demo\n\n## Design decisions\n\n- **One.** First.\n- **Two.** Second.\n",
        "test/a.test.ts": "",
      },
      commits: [
        makeCommit("feat: start", { parents: [], at: day(1), changes: [{ path: "package.json", status: "added" }, { path: "test/a.test.ts", status: "added" }] }),
        makeCommit("feat: more", { at: day(2), body: "Explain the change in enough detail to count as a body.", changes: ["src/a.ts", "test/a.test.ts"] }),
        makeCommit("docs: readme", { at: day(3), changes: [{ path: "README.md", status: "added" }] }),
      ],
    });
    const study = buildCaseStudy({ snapshot, sessions: [], generatorVersion: "test" });
    const ids = new Set(study.evidence.map((item) => item.id));
    const referenced = new Set<string>([
      ...study.overview.flatMap((statement) => statement.evidence),
      ...(study.project.description?.evidence ?? []),
      ...study.technologies.flatMap((technology) => technology.evidence),
      ...study.timeline.flatMap((milestone) => milestone.evidence),
      ...study.decisions.flatMap((decision) => decision.evidence),
      ...study.findings.flatMap((finding) => finding.statement.evidence),
      ...study.selectedCommits.flatMap((commit) => commit.evidence),
    ]);
    for (const id of referenced) expect(ids.has(id)).toBe(true);
    for (const id of ids) expect(referenced.has(id)).toBe(true);
    expect(study.project.description).toMatchObject({ text: "Demo tool", level: "documented" });
  });

  test("evidence stays fully referenced when decision caps apply", () => {
    const markers = [".github/workflows/ci.yml", "biome.json", ".editorconfig", "Dockerfile", "Makefile", ".prettierrc", "vite.config.ts", "jest.config.js", "tsconfig.json", "bun.lock", ".nvmrc", "flake.nix"];
    const commits: Commit[] = [makeCommit("feat: start", { parents: [], at: day(1), changes: [{ path: "src/a.ts", status: "added" }] })];
    for (let i = 0; i < 40; i++) {
      commits.push(makeCommit(`feat: step ${i}`, { at: new Date(Date.UTC(2024, 0, 2) + i * 3_600_000).toISOString(), body: "Chose this approach because the alternative was slower.", changes: [{ path: `src/${i}.ts`, status: "added" }] }));
    }
    markers.forEach((path, i) => commits.push(makeCommit(`build: add ${path}`, { at: day(10 + i), changes: [{ path, status: "added" }] })));
    const bullets = Array.from({ length: 40 }, (_, i) => `- **Choice ${i}.** Reason ${i}.`).join("\n");
    const files: Record<string, string> = { "README.md": `# Big\n\n## Design decisions\n\n${bullets}\n` };
    for (const path of markers) files[path] = "{}";
    const study = buildCaseStudy({ snapshot: makeSnapshot({ files, commits }), sessions: [], generatorVersion: "test" });

    const referenced = new Set([
      ...study.overview.flatMap((statement) => statement.evidence),
      ...(study.project.description?.evidence ?? []),
      ...study.technologies.flatMap((technology) => technology.evidence),
      ...study.timeline.flatMap((milestone) => milestone.evidence),
      ...study.decisions.flatMap((decision) => decision.evidence),
      ...study.findings.flatMap((finding) => finding.statement.evidence),
      ...study.selectedCommits.flatMap((commit) => commit.evidence),
    ]);
    expect(study.evidence.filter((item) => !referenced.has(item.id)).map((item) => item.statement)).toEqual([]);
    expect(study.decisions.filter((decision) => decision.status === "inferred")).toHaveLength(10);
    expect(study.decisions.filter((decision) => decision.basis.startsWith("Commit message"))).toHaveLength(10);
    expect(study.decisions.filter((decision) => decision.basis.includes("README.md"))).toHaveLength(12);
  });

  test("never includes absolute paths", () => {
    const snapshot = makeSnapshot({ files: { "README.md": "# Demo\n\nSomething.\n" } });
    const json = JSON.stringify(buildCaseStudy({ snapshot, sessions: [], generatorVersion: "test" }));
    expect(json).not.toMatch(/\/home\/|\/Users\/|[A-Z]:\\\\/);
  });

  test("only keeps plain web homepages", () => {
    expect(safeHomepage("git+https://github.com/me/tool.git")).toBe("https://github.com/me/tool");
    expect(safeHomepage("javascript:alert(1)")).toBeUndefined();
    expect(safeHomepage("https://user:pass@example.com")).toBeUndefined();
    expect(safeHomepage("github:me/tool")).toBeUndefined();
  });
});

describe("formatting", () => {
  test("is locale-independent", () => {
    expect(formatDate("2024-03-04T23:59:00-08:00")).toBe("Mar 4, 2024");
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(inclusiveDays("2024-01-30T10:00:00Z", "2024-02-02T01:00:00Z")).toBe(4);
  });
});
