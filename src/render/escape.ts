/**
 * Escaping for repository-controlled text. Commit messages, file names,
 * documentation, and session transcripts are all untrusted input.
 */

/**
 * C0 controls (except tab and newline) and bidirectional overrides are
 * replaced: the former are invalid in HTML, the latter can visually reorder
 * text ("Trojan Source") so a report shows something other than its content.
 */
const UNSAFE_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g;

export function sanitizeText(value: string): string {
  return value.replace(UNSAFE_CHARACTERS, "\uFFFD");
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapes text for HTML element content and quoted attribute values. */
export function escapeHtml(value: string): string {
  return sanitizeText(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** HTML that is already safe to emit. Only produced by {@link html} and {@link trustedHtml}. */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export type HtmlValue = string | number | SafeHtml | null | undefined | false | readonly HtmlValue[];

/**
 * Tagged template that escapes every interpolated value unless it is already
 * SafeHtml. Rendering code builds all markup through this, so forgetting to
 * escape is not possible by construction.
 */
export function html(strings: TemplateStringsArray, ...values: HtmlValue[]): SafeHtml {
  let output = strings[0] ?? "";
  values.forEach((value, index) => {
    output += renderHtmlValue(value) + (strings[index + 1] ?? "");
  });
  return new SafeHtml(output);
}

function renderHtmlValue(value: HtmlValue): string {
  if (value === null || value === undefined || value === false) return "";
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(renderHtmlValue).join("");
  return escapeHtml(String(value));
}

/** Marks a constant, developer-authored string (never repository content) as HTML. */
export function trustedHtml(markup: string): SafeHtml {
  return new SafeHtml(markup);
}

/** Escapes text for use inline in Markdown so it cannot create links, emphasis, HTML, or tables. */
export function escapeMarkdown(value: string): string {
  return sanitizeText(value)
    .replace(/\s*\r?\n\s*/g, " ")
    .replace(/[\\`*_[\]<>|#~!]/g, (char) => `\\${char}`)
    .replace(/^([+-]|\d+[.)])(\s)/, "\\$1$2");
}

/**
 * A Markdown code span that cannot be broken out of. Backticks inside the
 * value lengthen the fence, as CommonMark specifies. In table cells, pipes are
 * escaped, which GitHub requires even inside code spans.
 */
export function markdownCode(value: string, inTable = false): string {
  let text = sanitizeText(value).replace(/\s*\r?\n\s*/g, " ");
  if (inTable) text = text.replace(/\|/g, "\\|");
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longestRun + 1);
  const pad = text.startsWith("`") || text.endsWith("`") || /^ .* $/.test(text) ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}
