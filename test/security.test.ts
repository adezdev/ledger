import { afterEach, describe, expect, test } from "bun:test";
import { chmod, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { analyzeRepository } from "../src/app/analyze.ts";
import { renderReports } from "../src/app/report.ts";
import { FixtureRepo } from "./helpers/fixture-repo.ts";

const posix = process.platform !== "win32";
const repos: FixtureRepo[] = [];

afterEach(async () => {
  await Promise.all(repos.splice(0).map((repo) => repo.cleanup()));
});

describe("analysis never executes repository-controlled programs", () => {
  test.if(posix)("ignores hostile Git configuration, attributes, and hooks", async () => {
    const repo = await FixtureRepo.create();
    repos.push(repo);
    const marker = join(repo.base, "PWNED");
    const payload = join(repo.base, "payload.sh");
    await writeFile(payload, `#!/bin/sh\ntouch "${marker}"\n`);
    await chmod(payload, 0o755);

    await repo.commit("feat: start", { "a.txt": "one\n", ".gitattributes": "*.txt diff=evil\n", "README.md": "# Readme\n" });
    await repo.commit("feat: more", { "a.txt": "two\n" });

    // Each of these makes Git run a program when the relevant feature is used.
    for (const [key, value] of [
      ["core.fsmonitor", payload],
      ["core.pager", payload],
      ["log.showSignature", "true"],
      ["gpg.program", payload],
      ["diff.evil.textconv", payload],
      ["diff.evil.command", payload],
      ["diff.external", payload],
      ["core.hooksPath", join(repo.base, "hooks")],
    ]) {
      await repo.git("config", key ?? "", value ?? "");
    }
    for (const hook of ["post-checkout", "pre-commit", "post-index-change", "reference-transaction"]) {
      await Bun.write(join(repo.base, "hooks", hook), `#!/bin/sh\ntouch "${marker}"\n`);
      await chmod(join(repo.base, "hooks", hook), 0o755);
    }

    const result = await analyzeRepository({ repositoryPath: repo.root, sessionPaths: [] });
    renderReports(result.caseStudy, new Set(["md", "html", "json"]));
    expect(result.caseStudy.metrics.commits).toBe(2);
    expect(await readdir(repo.base)).not.toContain("PWNED");
  });

  test.if(posix)("does not follow tracked symlinks out of the repository", async () => {
    const repo = await FixtureRepo.create();
    repos.push(repo);
    const secret = join(repo.base, "outside-secret.md");
    await writeFile(secret, "# Secret\n\nTOP-SECRET-CONTENT that must never appear in a report.\n");
    await symlink(secret, join(repo.root, "README.md"));
    await symlink(secret, join(repo.root, "ARCHITECTURE.md"));
    await repo.commit("feat: link docs", { "src/index.ts": "export {};\n" });

    const result = await analyzeRepository({ repositoryPath: repo.root, sessionPaths: [] });
    const rendered = renderReports(result.caseStudy, new Set(["md", "html", "json"]));
    for (const file of rendered) expect(file.content).not.toContain("TOP-SECRET-CONTENT");
    expect(result.caseStudy.limitations.some((limitation) => limitation.includes("symlink"))).toBe(true);
  });

  test("does not read untracked, ignored, or credential files", async () => {
    const repo = await FixtureRepo.create();
    repos.push(repo);
    await repo.commit("feat: start", { ".gitignore": "notes/\n", ".env": "API_KEY=tracked-but-private\n", "README.md": "# Demo\n\nPublic description.\n" });
    await repo.write("notes/ARCHITECTURE.md", "# Private\n\n## Design decisions\n\n- **UNTRACKED-DECISION** here.\n- **Another** one.\n");
    await repo.write("docs/draft.md", "# Draft\n\n## Decisions\n\n- **UNTRACKED-DRAFT** here.\n- **More** text.\n");

    const result = await analyzeRepository({ repositoryPath: repo.root, sessionPaths: [] });
    const json = JSON.stringify(result.caseStudy);
    expect(json).not.toContain("UNTRACKED-DECISION");
    expect(json).not.toContain("UNTRACKED-DRAFT");
    expect(json).not.toContain("tracked-but-private");
  });
});

describe("architectural invariants", () => {
  async function sourceFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true, recursive: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".ts")).map((entry) => join(entry.parentPath, entry.name));
  }

  test("only the Git runner starts processes, and nothing uses the network", async () => {
    const root = join(import.meta.dir, "..", "src");
    for (const file of await sourceFiles(root)) {
      const text = await Bun.file(file).text();
      const relative = file.slice(root.length + 1).replaceAll("\\", "/");
      if (relative !== "git/exec.ts") expect({ file: relative, spawns: /\bBun\.(spawn|spawnSync|\$)|child_process|\bexecFile/.test(text) }).toEqual({ file: relative, spawns: false });
      expect({ file: relative, network: /\bfetch\(|XMLHttpRequest|WebSocket|node:(http|https|net|tls|dgram|dns)|Bun\.(connect|listen|serve)/.test(text) }).toEqual({ file: relative, network: false });
    }
  });

  test("renderers depend only on the case study, not on Git or the filesystem", async () => {
    const root = join(import.meta.dir, "..", "src", "render");
    for (const file of await sourceFiles(root)) {
      const text = await Bun.file(file).text();
      expect(text).not.toMatch(/from "\.\.\/(git|app|output|session)\//);
      expect(text).not.toMatch(/node:fs|Bun\.(file|write)/);
    }
  });
});
