import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * A throwaway Git repository for integration tests. Git runs with an empty
 * global config and a local identity, so tests never read or modify the
 * developer's own Git configuration.
 */
export class FixtureRepo {
  private clock = Date.parse("2024-03-04T09:00:00Z");

  private constructor(
    readonly base: string,
    readonly root: string,
    private readonly globalConfig: string,
  ) {}

  static async create(name = "fixture-project"): Promise<FixtureRepo> {
    const base = await mkdtemp(join(tmpdir(), "ledger-test-"));
    const root = join(base, name);
    await mkdir(root, { recursive: true });
    const globalConfig = join(base, "empty-gitconfig");
    await writeFile(globalConfig, "");
    const repo = new FixtureRepo(base, root, globalConfig);
    await repo.git("init", "--quiet", "--initial-branch=main");
    await repo.git("config", "user.name", "Fixture Author");
    await repo.git("config", "user.email", "fixture@example.com");
    await repo.git("config", "commit.gpgsign", "false");
    await repo.git("config", "tag.gpgsign", "false");
    return repo;
  }

  async git(...args: string[]): Promise<string> {
    const date = new Date(this.clock).toISOString();
    const proc = Bun.spawn({
      cmd: ["git", ...args],
      cwd: this.root,
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: this.base,
        GIT_CONFIG_GLOBAL: this.globalConfig,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code !== 0) throw new Error(`fixture git ${args.join(" ")} failed: ${stderr}`);
    return stdout;
  }

  async write(path: string, content: string | Uint8Array): Promise<void> {
    const full = join(this.root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }

  /** Advances the fixture clock so commits get distinct, predictable timestamps. */
  advance(hours: number): void {
    this.clock += hours * 3_600_000;
  }

  /** Writes files, stages everything, and commits. Returns the new commit SHA. */
  async commit(message: string, files: Record<string, string | Uint8Array> = {}, options: { hoursLater?: number } = {}): Promise<string> {
    this.advance(options.hoursLater ?? 1);
    for (const [path, content] of Object.entries(files)) await this.write(path, content);
    await this.git("add", "--all");
    await this.git("commit", "--quiet", "--allow-empty", "--no-verify", "-m", message);
    return (await this.git("rev-parse", "HEAD")).trim();
  }

  async cleanup(): Promise<void> {
    await rm(this.base, { recursive: true, force: true });
  }
}
