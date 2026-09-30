import { selectDocuments } from "../analysis/documents.ts";
import { decodeText } from "../analysis/text.ts";
import type { RepositorySnapshot } from "../domain/model.ts";
import { readCommits } from "../git/log.ts";
import {
  findRepository,
  readBlobs,
  readBranch,
  readHead,
  readIsShallow,
  readTags,
  readTrackedFiles,
} from "../git/repository.ts";

/** Gathers everything Ledger needs from a repository. Read-only; runs nothing from the repository. */
export async function collectSnapshot(path: string): Promise<{ root: string; snapshot: RepositorySnapshot }> {
  const { root, name } = await findRepository(path);
  const headSha = await readHead(root);
  const [branch, isShallow, tags, files, commits] = await Promise.all([
    readBranch(root),
    readIsShallow(root),
    readTags(root),
    readTrackedFiles(root, headSha),
    readCommits(root, headSha),
  ]);

  const selection = selectDocuments(files);
  const blobs = await readBlobs(
    root,
    selection.read.map((file) => file.objectId),
  );

  const documents = new Map<string, string>();
  const skippedDocuments = [...selection.skipped];
  for (const file of selection.read) {
    const bytes = blobs.get(file.objectId);
    if (!bytes) continue;
    const text = decodeText(bytes);
    if (text === null) skippedDocuments.push({ path: file.path, reason: "binary" });
    else documents.set(file.path, text);
  }

  const commitShas = new Set(commits.map((commit) => commit.sha));
  return {
    root,
    snapshot: {
      name,
      branch,
      headSha,
      isShallow,
      tags: tags.filter((tag) => commitShas.has(tag.sha)),
      files,
      commits,
      documents,
      skippedDocuments,
    },
  };
}
