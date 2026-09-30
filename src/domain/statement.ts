/**
 * Statement text may contain inline code spans delimited by single backticks.
 * `code` wraps a value so it renders as code; values that could break the span
 * (backticks, line breaks) are quoted as plain text instead.
 */
export function code(value: string): string {
  const single = value.replace(/\s*[\r\n]+\s*/g, " ");
  return single.includes("`") || single === "" ? `“${single}”` : `\`${single}\``;
}

export interface InlineSegment {
  text: string;
  code: boolean;
}

/** Splits statement text into plain and code segments. Unpaired backticks stay literal. */
export function inlineSegments(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let rest = text;
  while (rest !== "") {
    const open = rest.indexOf("`");
    const close = open === -1 ? -1 : rest.indexOf("`", open + 1);
    if (open === -1 || close === -1) {
      segments.push({ text: rest, code: false });
      break;
    }
    if (open > 0) segments.push({ text: rest.slice(0, open), code: false });
    segments.push({ text: rest.slice(open + 1, close), code: true });
    rest = rest.slice(close + 1);
  }
  return segments;
}
