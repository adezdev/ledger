import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

export class OutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutputError";
  }
}

export interface ReportFile {
  fileName: string;
  content: string;
}

/** Writes report files into `directory`, creating it if needed. Returns the written paths. */
export async function writeReports(directory: string, files: readonly ReportFile[]): Promise<string[]> {
  try {
    const info = await stat(directory);
    if (!info.isDirectory()) throw new OutputError(`Output path exists and is not a directory: ${directory}`);
  } catch (error) {
    if (error instanceof OutputError) throw error;
    try {
      await mkdir(directory, { recursive: true });
    } catch (cause) {
      throw new OutputError(`Cannot create output directory ${directory}: ${messageOf(cause)}`);
    }
  }

  const written: string[] = [];
  for (const file of files) {
    const path = join(directory, file.fileName);
    try {
      await Bun.write(path, file.content);
    } catch (cause) {
      throw new OutputError(`Cannot write ${path}: ${messageOf(cause)}`);
    }
    written.push(path);
  }
  return written;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
