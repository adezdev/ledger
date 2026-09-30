import type { SkippedDocument, TrackedFile } from "../domain/model.ts";
import { isManifestPath } from "./manifests.ts";
import {
  baseName,
  ciSystemOf,
  isArchitectureRecord,
  isDocumentation,
  isReadme,
  isSensitivePath,
  isVendoredOrGenerated,
} from "./paths.ts";

/** Upper bound on any single file Ledger reads. */
export const MAX_DOCUMENT_BYTES = 256 * 1024;
/** Upper bound on how many tracked files Ledger reads in one analysis. */
export const MAX_DOCUMENTS = 200;

export interface DocumentSelection {
  read: TrackedFile[];
  skipped: SkippedDocument[];
}

/**
 * Decides which tracked files Ledger reads. This is an allowlist: project
 * metadata, CI configuration, and documentation. Source code is never read.
 */
export function selectDocuments(files: readonly TrackedFile[]): DocumentSelection {
  const candidates = files
    .map((file) => ({ file, priority: readPriority(file.path) }))
    .filter((candidate): candidate is { file: TrackedFile; priority: number } => candidate.priority !== null)
    .sort((a, b) => a.priority - b.priority || a.file.path.localeCompare(b.file.path));

  const read: TrackedFile[] = [];
  const skipped: SkippedDocument[] = [];
  for (const { file } of candidates) {
    if (file.kind === "symlink") skipped.push({ path: file.path, reason: "symlink" });
    else if (file.size > MAX_DOCUMENT_BYTES) skipped.push({ path: file.path, reason: "too-large" });
    else if (read.length < MAX_DOCUMENTS) read.push(file);
  }
  return { read, skipped };
}

function readPriority(path: string): number | null {
  if (isSensitivePath(path) || isVendoredOrGenerated(path)) return null;
  const depth = path.split("/").length - 1;
  const name = baseName(path);

  if (isManifestPath(path) && depth <= 2) return depth;
  if (/^(tsconfig|jsconfig)(\.[a-z]+)?\.json$/.test(name) && depth === 0) return 1;
  if (ciSystemOf(path)) return 2;
  if (depth === 0 && isReadme(path)) return 3;
  if (depth === 0 && /^(licen[sc]e|copying)(\.(md|txt))?$/i.test(name)) return 4;
  if (/^(architecture|design)\.(md|markdown)$/i.test(name) && depth <= 2) return 5;
  if (isArchitectureRecord(path)) return 6;
  if (/^(docs?|documentation)\//i.test(path) && isDocumentation(path) && /\.(md|markdown)$/i.test(path)) return 7;
  return null;
}
