/**
 * Report shape and CSV serialisation. Kept free of any database import so it
 * stays a pure module — testable on its own, and cheap to reason about.
 */

export type Column = { key: string; label: string; numeric?: boolean };
export type Report = { columns: Column[]; rows: Record<string, string>[] };

/**
 * Serialises a report to CSV. The mirror of parseCsv: quote anything containing
 * a delimiter, a quote or a newline, and double embedded quotes. A store will
 * open this in Excel and may well re-import it.
 */
export function toCsv(report: Report, headers: string[]): string {
  const escape = (v: string) => (/[",;\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [headers.map(escape).join(',')];
  for (const row of report.rows) {
    lines.push(report.columns.map((c) => escape(row[c.key] ?? '')).join(','));
  }
  return lines.join('\r\n');
}
