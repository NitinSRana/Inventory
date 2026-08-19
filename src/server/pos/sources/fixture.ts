import type { ExternalSale, FetchWindow, SalesSource } from './types';

/**
 * An in-memory SalesSource.
 *
 * The point of the port/adapter split: the whole import pipeline can be built
 * and tested today, with no API credentials and no network. When EposNow access
 * arrives, the only new code is the HTTP client — everything the ledger cares
 * about is already covered by tests that run against this.
 *
 * Also useful for local development and demos, where a fake day of trading is
 * more convenient than a real till.
 */
export class FixtureSalesSource implements SalesSource {
  readonly provider = 'epos_now' as const;

  private readonly sales: ExternalSale[];
  private readonly failOnFetch: string | null;

  /** Every call is recorded so tests can assert the window was narrowed. */
  readonly calls: FetchWindow[] = [];

  constructor(sales: ExternalSale[] = [], options: { failOnFetch?: string } = {}) {
    this.sales = sales;
    this.failOnFetch = options.failOnFetch ?? null;
  }

  async testConnection() {
    return this.failOnFetch
      ? { ok: false, message: this.failOnFetch }
      : { ok: true as const };
  }

  async fetchSales(window: FetchWindow): Promise<ExternalSale[]> {
    this.calls.push(window);
    if (this.failOnFetch) throw new Error(this.failOnFetch);

    return this.sales.filter(
      (s) =>
        s.occurredAt >= window.since && (!window.until || s.occurredAt <= window.until),
    );
  }
}

/** Terse builder, so a test reads as a shopping basket rather than a fixture. */
export function externalSale(
  externalRef: string,
  lines: { barcode: string | null; quantity: string; unitPrice?: string; description?: string }[],
  options: { occurredAt?: Date; tenderType?: 'cash' | 'card'; total?: string } = {},
): ExternalSale {
  return {
    externalRef,
    occurredAt: options.occurredAt ?? new Date(),
    tenderType: options.tenderType ?? 'card',
    total: options.total ?? null,
    lines: lines.map((l) => ({
      barcode: l.barcode,
      quantity: l.quantity,
      unitPrice: l.unitPrice ?? null,
      description: l.description ?? null,
    })),
  };
}
