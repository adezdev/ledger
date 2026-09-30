/**
 * Locale-independent formatting, so reports are byte-identical regardless of
 * the machine that generates them.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The calendar date of an ISO timestamp, in the timezone it was recorded in. */
export function isoDate(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/** "2024-03-04T10:00:00+01:00" → "Mar 4, 2024". */
export function formatDate(timestamp: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(timestamp);
  if (!match) return timestamp;
  const [, year, month, day] = match;
  return `${MONTHS[Number(month) - 1] ?? month} ${Number(day)}, ${year}`;
}

/** 1234567 → "1,234,567". */
export function formatCount(value: number): string {
  const sign = value < 0 ? "-" : "";
  const digits = String(Math.abs(Math.round(value)));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Whole days between two calendar dates, counting both ends. */
export function inclusiveDays(firstDate: string, lastDate: string): number {
  const first = Date.parse(`${isoDate(firstDate)}T00:00:00Z`);
  const last = Date.parse(`${isoDate(lastDate)}T00:00:00Z`);
  if (Number.isNaN(first) || Number.isNaN(last)) return 0;
  return Math.round(Math.abs(last - first) / 86_400_000) + 1;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatCount(count)} ${count === 1 ? singular : pluralForm}`;
}
