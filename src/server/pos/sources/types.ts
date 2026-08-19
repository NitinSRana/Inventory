/**
 * The provider-agnostic shape of an external sale.
 *
 * Everything downstream of this file — matching, depletion, idempotency,
 * reconciliation — is written against these types and knows nothing about any
 * particular EPOS. Adding a second provider later means writing one adapter,
 * not touching the pipeline.
 *
 * Adapters normalise INTO these types. They do not interpret: an adapter's only
 * job is to fetch and reshape. Deciding what a sale means to stock is
 * `sync.ts`'s job, and it is the same decision for every provider.
 */

/** One line of an external transaction, as the provider reported it. */
export type ExternalSaleLine = {
  /**
   * Whatever identifier the provider gives. Usually an EAN-13. Normalised and
   * matched against both `products.gtin` and `products.case_gtin`.
   */
  barcode: string | null;
  /** The provider's own description. Often the only clue when the barcode is
   *  unknown, so it is carried through to the reconciliation queue. */
  description?: string | null;
  /** Positive. A refund is a separate sale with `isRefund`, not a negative. */
  quantity: string;
  /**
   * Gross unit price — VAT included, matching our own `sellPrice` convention.
   * Recorded for the audit trail; it does NOT overwrite the product's price.
   */
  unitPrice?: string | null;
};

export type ExternalSale = {
  /**
   * The provider's transaction id. This is the idempotency key: a unique index
   * on (organization_id, source, external_ref) means a re-run of a sync cannot
   * import the same sale twice, no matter how careless the caller is.
   *
   * If a provider has no stable id, the adapter must synthesise a deterministic
   * one. Never a random uuid, or every retry duplicates the whole day.
   */
  externalRef: string;
  /** When it happened at the till, not when we fetched it. A sync running at
   *  23:00 must not date the whole day's takings to 23:00. */
  occurredAt: Date;
  lines: ExternalSaleLine[];
  /** Gross total as the provider reported it. Treated as authoritative for
   *  money — see the note in sync.ts about who owns which truth. */
  total?: string | null;
  tenderType?: 'cash' | 'card' | null;
  /**
   * A refund or void at their till. Puts stock back rather than taking it out.
   * Not yet applied by the pipeline — see sync.ts.
   */
  isRefund?: boolean;
};

export type FetchWindow = {
  /** Inclusive. Callers rewind this slightly on each run; overlap is free. */
  since: Date;
  until?: Date;
};

/**
 * What an EPOS adapter must provide. Deliberately small.
 *
 * `fetchSales` is expected to handle its own paging and return the whole window
 * — the pipeline does not want to know about cursors, and every provider spells
 * paging differently.
 */
export interface SalesSource {
  readonly provider: 'epos_now';
  /** Cheap liveness/credential check for the settings screen. */
  testConnection(): Promise<{ ok: boolean; message?: string }>;
  fetchSales(window: FetchWindow): Promise<ExternalSale[]>;
}

/** What a sync run did. Rendered on the settings screen and logged. */
export type SyncResult = {
  fetched: number;
  imported: number;
  /** Already seen — the normal, healthy outcome of an overlapping window. */
  skipped: number;
  /** Lines whose barcode matched no product. Recorded, never dropped. */
  unmatched: number;
  /** Lines that depleted more stock than we believed we had. Not an error:
   *  the sale already happened. See sync.ts. */
  oversold: number;
  errors: string[];
};
