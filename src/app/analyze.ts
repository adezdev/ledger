import type { CaseStudy, SessionSource } from "../domain/model.ts";
import { loadSession } from "../session/load.ts";
import { buildCaseStudy } from "../synthesis/case-study.ts";
import { VERSION } from "../version.ts";
import { collectSnapshot } from "./snapshot.ts";

export interface AnalyzeOptions {
  repositoryPath: string;
  /** Session files explicitly supplied by the user, in order. */
  sessionPaths: readonly string[];
}

export interface AnalysisResult {
  caseStudy: CaseStudy;
  /** Absolute working tree root. For choosing an output location; never rendered into reports. */
  repositoryRoot: string;
  sessions: readonly SessionSource[];
}

/** The core use case: repository (+ optional sessions) in, case study out. Writes nothing. */
export async function analyzeRepository(options: AnalyzeOptions): Promise<AnalysisResult> {
  const { root, snapshot } = await collectSnapshot(options.repositoryPath);
  const sessions: SessionSource[] = [];
  for (const path of options.sessionPaths) sessions.push(await loadSession(path));
  return {
    caseStudy: buildCaseStudy({ snapshot, sessions, generatorVersion: VERSION }),
    repositoryRoot: root,
    sessions,
  };
}
