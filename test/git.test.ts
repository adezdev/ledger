import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectSnapshot } from "../src/app/snapshot.ts";
import { parseLog, readCommits } from "../src/git/log.ts";
import { findRepository, parseTree, RepositoryError } from "../src/git/repository.ts";
import { FixtureRepo } from "./helpers/fixture-repo.ts";

const repos: FixtureRepo[] = [];
async function fixture(name?: string): Promise<FixtureRepo> {
  const repo = await FixtureRepo.create(name);
  repos.push(repo);
  return repo;
}

afterEach(async () => {
  await Promise.all(repos.splice(0).map((repo) => repo.cleanup()));
});

describe("repository discovery", () => {
  test("finds the working tree root from a nested directory", async () => {
    const repo = await fixture("discover me");
    await repo.commit("chore: init", { "src/deep/file.ts": "export {};\n" });
    const location = await findRepository(join(repo.root, "src", "deep"));
    expect(location.name).toBe("discover me");
    expect(location.root.replaceAll("\\", "/")).toEndWith("/discover me");
  });

  test("rejects a directory that is not inside a Git repository", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ledger-nogit-"));
    try {
      const plain = join(dir, "plain");
      await mkdir(plain);
      await expect(findRepository(plain)).rejects.toThrow(RepositoryError);
      await expect(findRepository(plain)).rejects.toThrow(/Not a Git repository/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects a path that does not exist", async () => {
    await expect(findRepository(join(tmpdir(), "ledger-definitely-missing-path"))).rejects.toThrow(/does not exist/);
  });

  test("reports a repository without commits clearly", async () => {
    const repo = await fixture();
    await expect(collectSnapshot(repo.root)).rejects.toThrow(/no commits/);
  });
});

describe("commit history", () => {
  test("reads a single-commit repository", async () => {
    const repo = await fixture();
    const sha = await repo.commit("Initial commit", { "README.md": "# Solo\n" });
    const commits = await readCommits(repo.root);
    expect(commits).toHaveLength(1);
    const [commit] = commits;
    expect(commit?.sha).toBe(sha);
    expect(commit?.parents).toEqual([]);
    expect(commit?.subject).toBe("Initial commit");
    expect(commit?.authorName).toBe("Fixture Author");
    expect(commit?.authoredAt).toBe("2024-03-04T10:00:00Z");
    expect(commit?.changes).toEqual([{ path: "README.md", status: "added", additions: 1, deletions: 0 }]);
  });

  test("returns multiple commits oldest first with bodies and stats", async () => {
    const repo = await fixture();
    await repo.commit("feat: first", { "a.txt": "1\n2\n3\n" });
    await repo.commit("fix(core): second\n\nExplain why the fix is needed.\nSecond line.", { "a.txt": "1\n3\n4\n5\n" });
    await repo.commit("chore: empty");
    const commits = await readCommits(repo.root);
    expect(commits.map((commit) => commit.subject)).toEqual(["feat: first", "fix(core): second", "chore: empty"]);
    expect(commits[1]?.body).toBe("Explain why the fix is needed.\nSecond line.");
    expect(commits[1]?.changes).toEqual([{ path: "a.txt", status: "modified", additions: 2, deletions: 1 }]);
    expect(commits[2]?.changes).toEqual([]);
  });

  test("handles spaces, Unicode, renames, binary files, and merges", async () => {
    const repo = await fixture();
    await repo.commit("add files", {
      "docs/read me.md": "hello world\n",
      "données/résumé ✓.txt": "unicode\n",
      "image.bin": new Uint8Array([0, 1, 2, 0, 255]),
    });
    await repo.git("mv", "docs/read me.md", "docs/guide with spaces.md");
    await repo.commit("rename guide");
    await repo.git("checkout", "--quiet", "-b", "feature");
    await repo.commit("feature work", { "feature file.txt": "x\n" });
    await repo.git("checkout", "--quiet", "main");
    await repo.commit("main work", { "main.txt": "y\n" });
    repo.advance(1);
    await repo.git("merge", "--quiet", "--no-ff", "feature", "-m", "Merge branch 'feature'");

    const commits = await readCommits(repo.root);
    const first = commits[0];
    expect(first?.changes.map((change) => change.path).sort()).toEqual(["docs/read me.md", "données/résumé ✓.txt", "image.bin"]);
    expect(first?.changes.find((change) => change.path === "image.bin")).toMatchObject({ additions: null, deletions: null });

    const rename = commits.find((commit) => commit.subject === "rename guide");
    expect(rename?.changes).toEqual([
      { path: "docs/guide with spaces.md", previousPath: "docs/read me.md", status: "renamed", additions: 0, deletions: 0 },
    ]);

    const merge = commits.at(-1);
    expect(merge?.subject).toBe("Merge branch 'feature'");
    expect(merge?.parents).toHaveLength(2);
    expect(merge?.changes).toEqual([]);
    expect(commits).toHaveLength(5);
  });

  test("parser tolerates control characters in commit messages", () => {
    const sha = "a".repeat(40);
    const record = (subject: string, body: string, diff: string): string =>
      ["\x1eLEDGER", sha, "aaaaaaa", "", "Name", "2024-01-01T00:00:00Z", subject, body, "", diff].join("\0");
    const output = record("subject with \x1eLEDGER inside", "body \x1eLEDGER too", "\n:000000 100644 0 1 A\0x\x1eLEDGER.txt\x001\t0\tx\x1eLEDGER.txt\0");
    const [commit] = parseLog(output);
    expect(commit?.subject).toBe("subject with \x1eLEDGER inside");
    expect(commit?.changes).toEqual([{ path: "x\x1eLEDGER.txt", status: "added", additions: 1, deletions: 0 }]);
  });
});

describe("snapshot", () => {
  test("lists tracked files only and reads allowlisted documents from Git objects", async () => {
    const repo = await fixture();
    await repo.write(".gitignore", "ignored.md\n");
    await repo.write("ignored.md", "# should not be read\n");
    await repo.commit("init", {
      "README.md": "# Project\n\nA tool that does a thing well.\n",
      "package.json": JSON.stringify({ name: "project" }),
      ".env": "SECRET=1\n",
      "src/index.ts": "export const x = 1;\n",
    });
    await repo.write("untracked.md", "# untracked\n");
    await repo.write("README.md", "# Modified in working tree only\n");

    const snapshot = await collectSnapshot(repo.root);
    const paths = snapshot.files.map((file) => file.path).sort();
    expect(paths).toEqual([".env", ".gitignore", "README.md", "package.json", "src/index.ts"]);
    expect(snapshot.documents.get("README.md")).toContain("A tool that does a thing well.");
    expect(snapshot.documents.has(".env")).toBe(false);
    expect(snapshot.documents.has("src/index.ts")).toBe(false);
    expect(snapshot.branch).toBe("main");
  });

  test("resolves annotated and lightweight tags to commits", async () => {
    const repo = await fixture();
    const first = await repo.commit("one", { "a.txt": "a\n" });
    await repo.git("tag", "v0.1.0");
    const second = await repo.commit("two", { "a.txt": "b\n" });
    await repo.git("tag", "-a", "v0.2.0", "-m", "release");
    const snapshot = await collectSnapshot(repo.root);
    expect(snapshot.tags).toEqual([
      { name: "v0.1.0", sha: first },
      { name: "v0.2.0", sha: second },
    ]);
  });

  test("tree parser skips submodules and marks symlinks", () => {
    const files = parseTree(
      "100644 blob abc       12\tsrc/a b.ts\0" + "120000 blob def       7\tlink\0" + "160000 commit 123       -\tvendor/sub\0",
    );
    expect(files).toEqual([
      { path: "src/a b.ts", objectId: "abc", size: 12, kind: "file" },
      { path: "link", objectId: "def", size: 7, kind: "symlink" },
    ]);
  });
});
