import { sql } from 'drizzle-orm';

import { appQuery } from '@/db/tenant';

/**
 * Every shop on the platform, for the owner's admin screen.
 *
 * One call to app.platform_shops(), which is security definer for two reasons
 * the app cannot work around: it reads across tenants, which RLS forbids to
 * app_runtime, and it reads auth.users.last_sign_in_at, which app_runtime has no
 * grant on at all. See migration 0018 — and note that Postgres cannot tell who
 * the platform owner is, so the check that only they reach this lives in
 * requirePlatformAdmin, at every entry point.
 */
export type PlatformShop = {
  id: string;
  name: string;
  countryCode: string;
  createdAt: Date;
  memberCount: number;
  productCount: number;
  saleCount: number;
  lastSaleAt: Date | null;
  /** Null when nobody has ever signed in — or when the cluster has no auth schema, as in tests. */
  lastSignInAt: Date | null;
};

type Row = {
  id: string;
  name: string;
  country_code: string;
  created_at: Date;
  member_count: number;
  product_count: number;
  sale_count: number;
  last_sale_at: Date | null;
  last_sign_in_at: Date | null;
};

export async function listShops(): Promise<PlatformShop[]> {
  const rows = await appQuery<Row>(sql`select * from app.platform_shops()`);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    countryCode: r.country_code,
    createdAt: r.created_at,
    memberCount: r.member_count,
    productCount: r.product_count,
    saleCount: r.sale_count,
    lastSaleAt: r.last_sale_at,
    lastSignInAt: r.last_sign_in_at,
  }));
}
