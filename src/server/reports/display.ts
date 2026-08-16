import type { Column } from './csv';

/**
 * How a report cell is rendered for a person.
 *
 * Separate from the row data on purpose. `buildReport` returns raw strings —
 * `123.4500`, `22.000` — because the same rows are the CSV a shop opens in
 * Excel and may re-import, and a currency symbol in a numeric column is a
 * broken import. So the file gets the raw value and the screen gets this.
 *
 * The formatters are injected rather than imported: `Intl` currency formatting
 * needs a request-scoped locale and the tenant's own currency, neither of which
 * belongs in a pure module, and both of which make this trivial to test.
 */
export function formatCell(
  column: Column,
  raw: string | undefined,
  fmt: { money: (value: number) => string; quantity: (value: string) => string },
): string {
  // An em dash, not an empty cell: a blank reads as "the page failed to render
  // this", where the dash reads as "there is nothing here", which is the truth.
  if (raw === undefined || raw === '') return '—';
  if (column.format === 'money') {
    const n = Number(raw);
    // A non-numeric value in a money column means the query changed shape.
    // Showing it verbatim beats rendering "€NaN" over a shop's takings.
    return Number.isFinite(n) ? fmt.money(n) : raw;
  }
  if (column.format === 'quantity') return fmt.quantity(raw);
  return raw;
}
