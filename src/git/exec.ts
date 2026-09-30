/**
 * The only place Ledger starts a process.
 *
 * Git is always invoked with an argument array (never a shell string) and with
 * configuration overrides that stop a repository's own config from making Git
 * run programs or reach the network on our behalf.
 */

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: readonly string[],
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "GitError";
  }
}

export class GitNotFoundError extends Error {
  constructor() {
    super("Git executable not found. Install Git and make sure `git` is on your PATH.");
    this.name = "GitNotFoundError";
  }
}

/**
 * Overrides applied to every invocation. A target repository's .git/config is
 * untrusted: settings such as core.fsmonitor or a GPG program would otherwise
 * let it execute commands when Ledger reads it.
 */
const HARDENING_CONFIG: readonly string[] = [
  "core.fsmonitor=false",
  "core.untrackedCache=false",
  "core.quotePath=false",
  "log.showSignature=false",
  "color.ui=false",
  "i18n.logOutputEncoding=UTF-8",
  "protocol.allow=never",
];

function gitEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    // GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE and friends would silently redirect
    // Ledger to a different repository than the one the user pointed at.
    if (value !== undefined && !key.startsWith("GIT_")) env[key] = value;
  }
  env["GIT_TERMINAL_PROMPT"] = "0";
  env["GIT_OPTIONAL_LOCKS"] = "0";
  env["GIT_NO_LAZY_FETCH"] = "1";
  env["GIT_PAGER"] = "cat";
  env["LC_ALL"] = "C";
  return env;
}

export interface GitRunOptions {
  cwd: string;
  stdin?: Uint8Array;
}

export async function runGitBytes(args: readonly string[], options: GitRunOptions): Promise<Uint8Array> {
  const cmd = ["git", "--no-pager", ...HARDENING_CONFIG.flatMap((setting) => ["-c", setting]), ...args];
  const spawn = () =>
    Bun.spawn({
      cmd,
      cwd: options.cwd,
      env: gitEnvironment(),
      stdin: options.stdin ?? "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  let proc: ReturnType<typeof spawn>;
  try {
    proc = spawn();
  } catch (error) {
    if (isMissingExecutable(error)) throw new GitNotFoundError();
    throw error;
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).bytes(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    const detail = stderr.trim().split("\n")[0] ?? "";
    throw new GitError(`git ${args[0] ?? ""} failed${detail ? `: ${detail}` : ""}`, args, exitCode, stderr);
  }
  return stdout;
}

const utf8 = new TextDecoder("utf-8");

export async function runGit(args: readonly string[], options: GitRunOptions): Promise<string> {
  return utf8.decode(await runGitBytes(args, options));
}

function isMissingExecutable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? error.code : undefined;
  return code === "ENOENT" || /ENOENT|not found/i.test(error.message);
}
