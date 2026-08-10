import { and, asc, eq } from 'drizzle-orm';

import { suppliers } from '@/db/schema';
import { withTenant } from '@/db/tenant';

export type SupplierInput = {
  name: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  leadTimeDays?: number;
  minOrderValue?: string | null;
  /** ISO weekdays: 1 = Monday .. 7 = Sunday */
  deliveryWeekdays?: number[];
};

export async function listSuppliers(orgId: string, options: { includeInactive?: boolean } = {}) {
  return withTenant(orgId, (tx) =>
    tx
      .select()
      .from(suppliers)
      .where(options.includeInactive ? undefined : eq(suppliers.isActive, true))
      .orderBy(asc(suppliers.name)),
  );
}

export async function createSupplier(orgId: string, input: SupplierInput) {
  const name = input.name.trim();
  if (!name) throw new Error('Supplier name is required');

  const [supplier] = await withTenant(orgId, (tx) =>
    tx
      .insert(suppliers)
      .values({ ...input, name, organizationId: orgId })
      .returning(),
  );
  return supplier;
}

export async function getSupplier(orgId: string, supplierId: string) {
  const [supplier] = await withTenant(orgId, (tx) =>
    tx.select().from(suppliers).where(eq(suppliers.id, supplierId)).limit(1),
  );
  return supplier ?? null;
}

/** Deactivated, never deleted — products and purchase orders still reference them. */
export async function deactivateSupplier(orgId: string, supplierId: string) {
  const [supplier] = await withTenant(orgId, (tx) =>
    tx
      .update(suppliers)
      .set({ isActive: false })
      .where(eq(suppliers.id, supplierId))
      .returning(),
  );
  return supplier ?? null;
}

export async function updateSupplier(orgId: string, supplierId: string, input: SupplierInput) {
  const name = input.name.trim();
  if (!name) throw new Error('Supplier name is required');

  const [supplier] = await withTenant(orgId, (tx) =>
    tx
      .update(suppliers)
      .set({ ...input, name })
      .where(and(eq(suppliers.id, supplierId)))
      .returning(),
  );
  return supplier ?? null;
}
