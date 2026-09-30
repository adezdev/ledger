import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { analyzeRepository } from "../src/app/analyze.ts";
import { renderReports } from "../src/app/report.ts";
import type { CaseStudy } from "../src/domain/model.ts";
import { SCHEMA_VERSION } from "../src/domain/model.ts";
import { code, inlineSegments } from "../src/domain/statement.ts";
import { escapeHtml, escapeMarkdown, html, markdownCode, sanitizeText, trustedHtml } from "../src/render/escape.ts";
import { renderHtml } from "../src/render/html.ts";
import { renderJson } from "../src/render/json.ts";
import { renderMarkdown } from "../src/render/markdown.ts";
import { buildCaseStudy } from "../src/synthesis/case-study.ts";
import { makeCommit, makeSnapshot } from "./helpers/builders.ts";
import { FixtureRepo } from "./helpers/fixture-repo.ts";

const XSS = `<script>alert("x")</script>`;

/** Markdown outside code spans; code span contents render literally, never as HTML. */
function outsideCodeSpans(markdown: string): string {
  return markdown.replace(/(`+)[\s\S]*?\1/g, "");
}
const IMG = `<img src=x onerror=alert(1)>`;

describe("escaping primitives", () => {
  test("escapeHtml neutralizes markup and quotes", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });

  test("html template escapes interpolations but not SafeHtml", () => {
    const inner = html`<b>${"<i>"}</b>`;
    expect(html`<p title="${`"quoted"`}">${inner}${[1, "<", null, false, undefined]}</p>`.value).toBe('<p title="&quot;quoted&quot;"><b>&lt;i&gt;</b>1&lt;</p>');
    expect(html`${trustedHtml("<hr>")}`.value).toBe("<hr>");
  });

  test("control and bidirectional override characters are replaced", () => {
    expect(sanitizeText("a\u0000b\u202Ec\u2066d\ne\tf")).toBe("a\uFFFDb\uFFFDc\uFFFDd\ne\tf");
  });

  test("escapeMarkdown prevents links, HTML, emphasis, and table breaks", () => {
    expect(escapeMarkdown("[x](javascript:alert(1)) <b>*y*</b> | _z_")).toBe("\\[x\\](javascript:alert(1)) \\<b\\>\\*y\\*\\</b\\> \\| \\_z\\_");
    expect(escapeMarkdown("# heading\nnext")).toBe("\\# heading next");
    expect(escapeMarkdown("- not a list")).toBe("\\- not a list");
  });

  test("markdownCode cannot be broken out of", () => {
    expect(markdownCode("a`b")).toBe("``a`b``");
    expect(markdownCode("`edge`")).toBe("`` `edge` ``");
    expect(markdownCode("a|b", true)).toBe("`a\\|b`");
  });

  test("statement code spans fall back to quotes for unsafe values", () => {
    expect(code("src/a b.ts")).toBe("`src/a b.ts`");
    expect(code("we`ird")).toBe("“we`ird”");
    expect(inlineSegments("see `a` and `b")).toEqual([
      { text: "see ", code: false },
      { text: "a", code: true },
      { text: " and `b", code: false },
    ]);
  });
});

function maliciousStudy(): CaseStudy {
  const files = {
    [`docs/${IMG}.md`]: "# Doc\n",
    [`src/${XSS}.ts`]: "",
    "package.json": JSON.stringify({ name: `pkg${XSS}`, description: `Desc "><script>alert(2)</script>`, homepage: "javascript:alert(3)" }),
    "README.md": `# Title\n\n## Design decisions\n\n- **${XSS}** detail [click](javascript:alert(4))\n- **Second** ${IMG}\n`,
  };
  const snapshot = makeSnapshot({
    files,
    commits: [
      makeCommit(`feat(${XSS}): add ${IMG}`, { parents: [], changes: Object.keys(files).map((path) => ({ path, status: "added" as const, additions: 3, deletions: 0 })) }),
      makeCommit(`fix: </style><script>alert(5)</script>`, { body: `Because </style><script>alert(6)</script> was chosen instead of safety.`, changes: [`src/${XSS}.ts`] }),
    ],
    tags: [],
  });
  return buildCaseStudy({
    snapshot,
    sessions: [
      {
        file: `evil${IMG}.md`,
        format: "text",
        warnings: [],
        events: [{ id: "line 1", kind: "message", role: "user", text: `We decided to use ${XSS} instead of a parser for this.` }],
      },
    ],
    generatorVersion: "test",
  });
}

describe("HTML report", () => {
  const study = maliciousStudy();
  const output = renderHtml(study);

  test("contains no executable markup from repository content", () => {
    expect(output).not.toMatch(/<script/i);
    expect(output).not.toMatch(/<img/i);
    expect(output).not.toMatch(/javascript:/i);
    // Escaped text may still read "onerror=", but no real tag may carry an event handler.
    expect(output).not.toMatch(/<[^>]*\son\w+=/i);
    expect(output).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(output.match(/<\/style>/g)).toHaveLength(1);
  });

  test("is a self-contained document with a restrictive CSP", () => {
    expect(output).toStartWith("<!doctype html>");
    expect(output).toContain(`content="default-src 'none'; style-src 'unsafe-inline'`);
    expect(output).not.toMatch(/<(link|iframe|object|embed|form|base)\b/i);
    expect(output).not.toMatch(/<[^>]*\ssrc=/i);
    expect(output).not.toMatch(/url\(/i);
  });

  test("renders evidence levels, anchors, and dark mode", () => {
    expect(output).toContain("prefers-color-scheme: dark");
    for (const item of study.evidence) expect(output).toContain(`id="${item.id.toLowerCase()}"`);
    expect(output).toContain('class="level level-inferred"');
    expect(output).toContain('class="level level-documented"');
  });
});

describe("Markdown report", () => {
  const study = maliciousStudy();
  const output = renderMarkdown(study);

  test("escapes repository-controlled text", () => {
    const prose = outsideCodeSpans(output);
    // A backslash-escaped "\\<" renders as a literal character, so only unescaped tags matter.
    expect(prose).not.toMatch(/(^|[^\\])<script/im);
    expect(prose).not.toMatch(/(^|[^\\])<img/im);
    expect(output).not.toMatch(/\]\(javascript:/i);
    expect(output).toContain("\\<script\\>");
  });

  test("has the expected sections and evidence anchors", () => {
    for (const heading of ["## Overview", "## Project snapshot", "## Engineering timeline", "## Technical decisions", "## Engineering evidence", "## Limitations", "## Evidence"]) {
      expect(output).toContain(`\n${heading}\n`);
    }
    for (const item of study.evidence) expect(output).toContain(`<a id="${item.id.toLowerCase()}"></a>${item.id}`);
    expect(output).toContain("### Documented");
  });

  test("every table row has the same number of columns as its header", () => {
    const lines = output.split("\n");
    let columns = 0;
    for (const line of lines) {
      if (!line.startsWith("|")) {
        columns = 0;
        continue;
      }
      const cells = line.replace(/\\\|/g, "").split("|").length;
      if (columns === 0) columns = cells;
      expect(cells).toBe(columns);
    }
  });
});

describe("JSON report", () => {
  test("is the versioned case study", () => {
    const study = maliciousStudy();
    const parsed: unknown = JSON.parse(renderJson(study));
    expect(parsed).toMatchObject({ schemaVersion: SCHEMA_VERSION, generator: { name: "ledger", version: "test" } });
    expect(SCHEMA_VERSION).toBe("1");
    expect(parsed).toEqual(JSON.parse(JSON.stringify(study)));
  });
});

describe("end to end on a real repository", () => {
  let repo: FixtureRepo;
  beforeAll(async () => {
    repo = await FixtureRepo.create("space and ünïcode repo");
    await repo.commit(`feat: start ${XSS}`, {
      "README.md": `# Demo\n\nA small demo ${IMG} project used to exercise Ledger.\n`,
      "package.json": JSON.stringify({ name: "demo", scripts: { test: "bun test" } }),
      "src/main file.ts": "export const x = 1;\n",
    });
    await repo.commit("test: add first test", { "test/main.test.ts": "import { test } from 'bun:test';\n" });
    await repo.git("tag", "v1.0.0");
    await repo.commit("docs: expand readme\n\nDescribe usage in more detail for new readers.", { "README.md": "# Demo\n\nA small demo project.\n\n## Usage\n\nRun it.\n" });
  });
  afterAll(async () => {
    await repo.cleanup();
  });

  test("renders all formats deterministically without leaking the absolute path", async () => {
    const session = join(repo.base, "session notes.md");
    await Bun.write(session, `User: go\n\nAssistant: I chose Bun over Node because it runs TypeScript directly. ${XSS}\n`);
    const first = await analyzeRepository({ repositoryPath: repo.root, sessionPaths: [session] });
    const second = await analyzeRepository({ repositoryPath: repo.root, sessionPaths: [session] });
    const formats = new Set(["md", "html", "json"] as const);
    const rendered = renderReports(first.caseStudy, formats);
    expect(rendered.map((file) => file.fileName)).toEqual(["report.md", "report.html", "report.json"]);
    expect(renderReports(second.caseStudy, formats)).toEqual(rendered);

    for (const file of rendered) {
      expect(file.content).not.toContain(repo.base);
      expect(file.content).not.toContain(repo.root);
      if (file.fileName === "report.md") expect(outsideCodeSpans(file.content)).not.toMatch(/(^|[^\\])<script/im);
      if (file.fileName === "report.html") expect(file.content).not.toMatch(/<script/i);
    }
    const study = first.caseStudy;
    expect(study.metrics.commits).toBe(3);
    expect(study.project.tags).toEqual([{ name: "v1.0.0", sha: study.commits[1]?.sha ?? "" }]);
    expect(study.decisions.some((decision) => decision.basis.includes("session notes.md"))).toBe(true);
    expect(study.commits.flatMap((commit) => commit.changes.map((change) => change.path))).toContain("src/main file.ts");
  });
});
