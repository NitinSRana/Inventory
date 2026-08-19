import type { ExternalSale, FetchWindow, SalesSource } from './types';

/**
 * EposNow adapter — STUB.
 *
 * Everything downstream of this file is finished and tested against
 * FixtureSalesSource. What is missing is only the HTTP: the endpoint paths, the
 * auth header, the response shape, and paging. Fill in the four TODOs and the
 * integration is live.
 *
 * ---------------------------------------------------------------------------
 * Before writing any of it, get API access. It is the long pole and the one
 * thing outside your control — partner approval commonly runs 4-8 weeks.
 * ---------------------------------------------------------------------------
 *
 * Two rules for whoever finishes this:
 *
 * 1. This adapter FETCHES AND RESHAPES. Nothing else. No stock decisions, no
 *    VAT, no product matching — sync.ts owns all of that and owns it once, for
 *    every provider. An adapter that starts making judgements is how the second
 *    integration ends up being a second pipeline.
 *
 * 2. `externalRef` must be STABLE and unique per transaction. It is the
 *    idempotency key, enforced by a unique index on
 *    (organization_id, source, external_ref). If EposNow's id is stable, use it
 *    directly. If it is not, synthesise something deterministic from immutable
 *    fields. Never a uuid, a timestamp, or an array index — every one of those
 *    re-imports the whole day on the next retry, and the ledger is append-only,
 *    so that damage is permanent.
 */

export type EposNowCredentials = {
  /** Resolved from the secret store via pos_connections.credential_ref.
   *  Never read a token out of the database. */
  apiKey: string;
  apiSecret: string;
  /** Their location/site id, if the account covers more than one shop. */
  siteId?: string;
};

const API_BASE = 'https://api.eposnowhq.com/api/v4'; // TODO: confirm against their docs

export class EposNowSalesSource implements SalesSource {
  readonly provider = 'epos_now' as const;

  private readonly credentials: EposNowCredentials;

  constructor(credentials: EposNowCredentials) {
    this.credentials = credentials;
  }

  /** TODO 1: their auth scheme. Basic with key:secret at time of writing —
   *  confirm, and move to OAuth if they offer it. */
  private authHeader(): string {
    const token = Buffer.from(
      `${this.credentials.apiKey}:${this.credentials.apiSecret}`,
    ).toString('base64');
    return `Basic ${token}`;
  }

  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    // TODO 2: call the cheapest authenticated endpoint they have and return
    // whether it answered. Used by the settings screen, so it must be fast and
    // must never throw — a failed credential check is a message, not a crash.
    return {
      ok: false,
      message: 'EposNow adapter is not implemented yet — awaiting API access',
    };
  }

  async fetchSales(_window: FetchWindow): Promise<ExternalSale[]> {
    /*
     * TODO 3: fetch transactions in [since, until], following their paging to
     * the end. Return the whole window — sync.ts does not know about cursors,
     * and every provider spells paging differently.
     *
     * TODO 4: map each transaction into ExternalSale. The shape to aim for:
     *
     *   {
     *     externalRef: String(t.Id),          // stable — see the note above
     *     occurredAt:  new Date(t.DateTime),  // when it happened at THEIR till
     *     tenderType:  t.PaymentType === 'Cash' ? 'cash' : 'card',
     *     total:       String(t.GrossValue),  // gross, VAT included
     *     lines: t.TransactionItems.map((i) => ({
     *       barcode:     i.Barcode ?? null,   // null is fine; it goes to the
     *                                         // unmatched queue, not the floor
     *       description: i.ProductName,
     *       quantity:    String(i.Quantity),
     *       unitPrice:   String(i.UnitPrice), // gross, matching our convention
     *     })),
     *   }
     *
     * Field names above are illustrative. Check the real payload — and when a
     * field is ambiguous, especially whether a price is gross or net, verify it
     * against a receipt from a real shop rather than assuming. Getting that
     * backwards is precisely the bug that reached the first demo.
     *
     * Refunds: if their API returns them in the same feed, set `isRefund` and
     * leave the handling to sync.ts, which currently rejects them loudly rather
     * than guessing. That is deliberate — a refund recorded as a sale depletes
     * stock for goods that are coming back.
     */
    throw new Error('EposNow adapter is not implemented yet — awaiting API access');
  }
}

/** The URL is exported so the stub's one real fact is testable and greppable. */
export const EPOS_NOW_API_BASE = API_BASE;
