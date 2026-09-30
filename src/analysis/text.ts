/** Text helpers shared by the documentation, manifest, and session analyzers. */

const decoder = new TextDecoder("utf-8");

/** Decodes UTF-8 text, or returns null when the bytes look binary. */
export function decodeText(bytes: Uint8Array): string | null {
  const probe = bytes.subarray(0, 8192);
  if (probe.includes(0)) return null;
  const text = decoder.decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Parses JSON that may contain comments and trailing commas (tsconfig.json, deno.jsonc). */
export function parseJsonc(text: string): unknown {
  let output = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    if (inString) {
      output += char;
      if (char === "\\") {
        output += nextChar ?? "";
        i++;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
      output += char;
    } else if (char === "/" && nextChar === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      output += "\n";
    } else if (char === "/" && nextChar === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else {
      output += char;
    }
  }
  return JSON.parse(output.replace(/,(\s*[}\]])/g, "$1"));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export interface MarkdownSection {
  level: number;
  title: string;
  /** 1-based line number of the heading (0 for text before the first heading). */
  line: number;
  body: string;
}

/** Splits Markdown into ATX-heading sections, ignoring headings inside fenced code. */
export function markdownSections(text: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection = { level: 0, title: "", line: 0, body: "" };
  const bodyLines: string[] = [];
  let fence: string | null = null;

  const flush = (): void => {
    current.body = bodyLines.join("\n").trim();
    if (current.level > 0 || current.body !== "") sections.push(current);
    bodyLines.length = 0;
  };

  text.split(/\r?\n/).forEach((line, index) => {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch?.[1]) {
      const marker = fenceMatch[1];
      if (fence === null) fence = marker[0] ?? null;
      else if (marker[0] === fence) fence = null;
      bodyLines.push(line);
      return;
    }
    const heading = fence === null ? /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line) : null;
    if (heading?.[1] && heading[2] !== undefined) {
      flush();
      current = { level: heading[1].length, title: stripInlineMarkdown(heading[2]), line: index + 1, body: "" };
      return;
    }
    bodyLines.push(line);
  });
  flush();
  return sections;
}

/** The first prose paragraph of a Markdown body: skips badges, images, HTML, and code. */
export function firstParagraph(markdown: string): string | undefined {
  let fence = false;
  for (const block of markdown.split(/\n\s*\n/)) {
    const trimmed = block.trim();
    const fenceCount = (trimmed.match(/^\s*(```|~~~)/gm) ?? []).length;
    if (fence || fenceCount > 0) {
      if (fenceCount % 2 === 1) fence = !fence;
      continue;
    }
    if (trimmed === "" || /^(#|<|!\[|\[!\[|\||>\s*\[!|---|===|\*\*\*)/.test(trimmed)) continue;
    if (/^\s*([-*+]|\d+\.)\s/.test(trimmed)) continue;
    const text = stripInlineMarkdown(trimmed.replace(/\s*\n\s*/g, " "));
    if (text.length >= 12) return text;
  }
  return undefined;
}

export interface ListItem {
  text: string;
  /** Text of a leading bold phrase, e.g. "Local first" in "**Local first.** Works offline." */
  lead?: string;
  line: number;
}

/** Top-level list items of a Markdown body, with continuation lines folded in. */
export function topLevelListItems(markdown: string, firstLine = 1): ListItem[] {
  const items: ListItem[] = [];
  let current: { raw: string; line: number } | null = null;
  let fence = false;
  const push = (): void => {
    if (!current) return;
    const lead = /^\*\*(.+?)\*\*|^__(.+?)__/.exec(current.raw);
    const item: ListItem = { text: stripInlineMarkdown(current.raw), line: current.line };
    const leadText = lead?.[1] ?? lead?.[2];
    if (leadText) item.lead = stripInlineMarkdown(leadText).replace(/[.:]\s*$/, "");
    items.push(item);
    current = null;
  };

  markdown.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) return;
    const bullet = /^([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet?.[2] !== undefined) {
      push();
      current = { raw: bullet[2], line: firstLine + index };
    } else if (current && /^\s+\S/.test(line) && !/^\s+([-*+]|\d+[.)])\s/.test(line)) {
      current.raw += ` ${line.trim()}`;
    } else if (line.trim() === "" || /^\S/.test(line)) {
      push();
    }
  });
  push();
  return items;
}

/** Removes the Markdown syntax that would read as noise in a plain sentence. */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,:;!?]|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits prose into sentences. Code spans are protected from splitting. */
export function sentences(text: string): string[] {
  const result: string[] = [];
  for (const line of text.split(/\n+/)) {
    const cleaned = line.replace(/^\s*([-*+>]|\d+[.)])\s+/, "").trim();
    if (cleaned === "") continue;
    const parts = cleaned.match(/(?:`[^`]*`|[^.!?`]|[.!?](?=\S))+[.!?]*/g) ?? [cleaned];
    for (const part of parts) {
      const sentence = part.trim();
      if (sentence !== "") result.push(sentence);
    }
  }
  return result;
}

/** Shortens text to `max` characters on a word boundary. */
export function truncate(text: string, max: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  if (single.length <= max) return single;
  const cut = single.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}
