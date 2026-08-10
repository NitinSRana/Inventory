import { sql } from 'drizzle-orm';

import { COUNT_FREQUENCIES } from '@/db/schema';
import { withTenant } from '@/db/tenant';

import { DEFAULT_FREQUENCY, daysOverdue, type ScheduledFrequency } from './schedule';

/**
 * Which products are overdue a count.
 *
 * The whole depletion model rests on counts happening. Without this the store
 * has no idea what has drifted, and cycle counting degrades into counting
 * whatever happens to be nearest the door.
 */

// Compile-time guard: adding a value to COUNT_FREQUENCIES without giving it an
// interval in schedule.ts breaks the build here rather than silently defaulting
// everything on that frequency to monthly.
type FrequenciesAreScheduled = (typeof COUNT_FREQUENCIES)[number] extends ScheduledFrequency
  ? true
  : never;
const _frequenciesAreScheduled: FrequenciesAreScheduled = true;
void _frequenciesAreScheduled;

export type DueProduct = {
  id: string;
  name: string;
  gtin: string | null;
  frequency: string;
  lastCountedAt: Date | null;
  daysOverdue: number;
};

/**
 * Overdue products, never-counted first, then longest overdue.
 *
 * One query with a lateral join rather than a lookup per product: a 2,000-SKU
 * catalogue would otherwise be 2,000 round trips.
 */
export async function getDueForCount(orgId: string, limit = 100): Promise<DueProduct[]> {
  const rows = await withTenant(orgId, (tx) =>
    tx.execute<{
      id: string;
      name: string;
      gtin: string | null;
      frequency: string;
      last_counted_at: string | null;
    }>(sql`
      select
        p.id,
        p.name,
        p.gtin,
        coalesce(p.count_frequency, c.default_count_frequency, ${DEFAULT_FREQUENCY}) as frequency,
        lc.last_counted_at
      from products p
      left join categories c on c.id = p.category_id
      left join lateral (
        select max(cl.counted_at) as last_counted_at
        from count_lines cl
        join count_sessions cs on cs.id = cl.count_session_id
        where cl.product_id = p.id and cs.status = 'completed'
      ) lc on true
      where p.is_active
      order by lc.last_counted_at asc nulls first, p.name asc
      limit ${limit}
    `),
  );

  const now = new Date();
  return rows
    .map((r) => {
      const lastCountedAt = r.last_counted_at ? new Date(r.last_counted_at) : null;
      return {
        id: r.id,
        name: r.name,
        gtin: r.gtin,
        frequency: r.frequency,
        lastCountedAt,
        daysOverdue: daysOverdue(lastCountedAt, r.frequency, now),
      };
    })
    .filter((p) => p.daysOverdue >= 0);
}

export { DEFAULT_FREQUENCY, daysOverdue, intervalDays } from './schedule';
