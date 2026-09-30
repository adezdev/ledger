import type { CaseStudy } from "../domain/model.ts";
import type { ReportFile } from "../output/write.ts";
import { renderHtml } from "../render/html.ts";
import { renderJson } from "../render/json.ts";
import { renderMarkdown } from "../render/markdown.ts";

export type ReportFormat = "md" | "html" | "json";

export const REPORT_FORMATS: readonly ReportFormat[] = ["md", "html", "json"];

const RENDERERS: Record<ReportFormat, { fileName: string; render: (study: CaseStudy) => string }> = {
  md: { fileName: "report.md", render: renderMarkdown },
  html: { fileName: "report.html", render: renderHtml },
  json: { fileName: "report.json", render: renderJson },
};

/** Renders the requested formats in a fixed order (md, html, json). */
export function renderReports(study: CaseStudy, formats: ReadonlySet<ReportFormat>): ReportFile[] {
  return REPORT_FORMATS.filter((format) => formats.has(format)).map((format) => ({
    fileName: RENDERERS[format].fileName,
    content: RENDERERS[format].render(study),
  }));
}
