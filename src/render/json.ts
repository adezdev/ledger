import type { CaseStudy } from "../domain/model.ts";

/** report.json: the case study verbatim. Its shape is versioned by `schemaVersion`. */
export function renderJson(study: CaseStudy): string {
  return `${JSON.stringify(study, null, 2)}\n`;
}
