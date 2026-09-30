import { stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { Tag, TrackedFile } from "../domain/model.ts";
import { GitError, runGit, runGitBytes } from "./exec.ts";

export class RepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryError";
  }
}

export interface RepositoryLocation {
  /** Absolute path of the working tree root. Internal only; never rendered. */
  root: string;
  name: string;
}

/** Resolves any path inside a working tree to the repository root. */
export async function findRepository(path: string): Promise<RepositoryLocation> {
  const absolute = resolve(path);
  let directory: string;
  try {
    const info = await stat(absolute);
    directory = info.isDirectory() ? absolute : dirname(absolute);
  } catch {
    throw new RepositoryError(`Path does not exist: ${path}`);
  }

  let output: string;
  try {
    output = await runGit(["rev-parse", "--show-toplevel"], { cwd: directory });
  } catch (error) {
    if (error instanceof GitError) {
      if (/not a git repository/i.test(error.stderr)) {
        throw new RepositoryError(`Not a Git repository (or any parent up to the filesystem root): ${path}`);
      }
      if (/work tree/i.test(error.stderr)) {
        throw new RepositoryError(`Bare repositories are not supported; point Ledger at a checkout: ${path}`);
      }
      if (/dubious ownership/i.test(error.stderr)) {
        throw new RepositoryError(
          `Git refused to open ${path} because it is owned by another user. See \`git help config\` (safe.directory).`,
        );
      }
    }
    throw error;
  }

  const root = output.trim();
  if (root === "") throw new RepositoryError(`Could not determine the working tree root for ${path}`);
  return { root, name: basename(root) };
}

export async function readHead(root: string): Promise<string> {
  try {
    return (await runGit(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], { cwd: root })).trim();
  } catch (error) {
    if (error instanceof GitError) throw new RepositoryError("Repository has no commits yet; commit something first.");
    throw error;
  }
}

export async function readBranch(root: string): Promise<string | null> {
  try {
    const branch = (await runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: root })).trim();
    return branch === "" ? null : branch;
  } catch (error) {
    // A detached HEAD has no branch; that is not an error.
    if (error instanceof GitError) return null;
    throw error;
  }
}

export async function readIsShallow(root: string): Promise<boolean> {
  return (await runGit(["rev-parse", "--is-shallow-repository"], { cwd: root })).trim() === "true";
}

export async function readTags(root: string): Promise<Tag[]> {
  const output = await runGit(
    ["for-each-ref", "--format=%(refname:short)%00%(objectname)%00%(*objectname)", "refs/tags"],
    { cwd: root },
  );
  return parseTags(output);
}

/** Parses `for-each-ref` output; annotated tags are peeled to the commit they point at. */
export function parseTags(output: string): Tag[] {
  const tags: Tag[] = [];
  for (const line of output.split("\n")) {
    if (line === "") continue;
    const [name, objectName, peeled] = line.split("\0");
    const sha = peeled || objectName;
    if (name && sha) tags.push({ name, sha });
  }
  return tags;
}

export async function readTrackedFiles(root: string, headSha: string): Promise<TrackedFile[]> {
  const output = await runGit(["ls-tree", "-r", "-z", "--long", "--full-tree", headSha], { cwd: root });
  return parseTree(output);
}

/** Parses `git ls-tree -r -z --long`. Submodules (commits) are skipped: their contents are not tracked here. */
export function parseTree(output: string): TrackedFile[] {
  const files: TrackedFile[] = [];
  for (const entry of output.split("\0")) {
    if (entry === "") continue;
    const tab = entry.indexOf("\t");
    if (tab === -1) continue;
    const [mode, type, objectId, size] = entry.slice(0, tab).split(/ +/);
    const path = entry.slice(tab + 1);
    if (type !== "blob" || !objectId || !mode) continue;
    files.push({
      path,
      objectId,
      size: Number(size) || 0,
      kind: mode === "120000" ? "symlink" : mode === "100755" ? "executable" : "file",
    });
  }
  return files;
}

/**
 * Reads blob contents by object id in a single `cat-file --batch` process.
 * Contents come from the object database, never from the working tree, so a
 * tracked symlink can not redirect Ledger to a file outside the repository.
 */
export async function readBlobs(root: string, objectIds: readonly string[]): Promise<Map<string, Uint8Array>> {
  const blobs = new Map<string, Uint8Array>();
  const unique = [...new Set(objectIds)];
  if (unique.length === 0) return blobs;

  const input = new TextEncoder().encode(unique.map((id) => `${id}\n`).join(""));
  const output = await runGitBytes(["cat-file", "--batch"], { cwd: root, stdin: input });

  let offset = 0;
  const decoder = new TextDecoder();
  while (offset < output.length) {
    const newline = output.indexOf(0x0a, offset);
    if (newline === -1) break;
    const header = decoder.decode(output.subarray(offset, newline));
    offset = newline + 1;
    const [objectId, type, size] = header.split(" ");
    if (!objectId || type === "missing" || size === undefined) continue;
    const length = Number(size);
    if (!Number.isInteger(length) || length < 0 || offset + length > output.length) {
      throw new GitError(`git cat-file returned a malformed header: ${header}`, ["cat-file"], 0, "");
    }
    if (type === "blob") blobs.set(objectId, output.slice(offset, offset + length));
    offset += length + 1;
  }
  return blobs;
}
