import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import Decimal from 'decimal.js';

import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { requireRole } from '@/server/auth/session';
import { DataList, DataRow, PageTitle } from '@/components/data-list';
import { Button } from '@/components/ui/button';
import { createPurchaseOrder } from '@/server/purchasing/orders';
import { getReorderSuggestions } from '@/server/purchasing/reorder';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function ReorderPage({ params }: PageProps<'/[locale]/reorder'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('reorder');
  const format = await getFormatter();
  const { orgId } = await requireRole(locale, 'manager');

  const [org] = await withTenant(orgId, (tx) => tx.select().from(organizations));
  const { groups, withoutRate } = await getReorderSuggestions(orgId);
  const money = (v: string) => format.number(Number(v), { style: 'currency', currency: org.currencyCode });

  async function draftOrder(formData: FormData) {
    'use server';
    const { orgId, userId } = await requireRole(locale, 'manager');
    const supplierId = String(formData.get('supplierId'));
    const { groups } = await getReorderSuggestions(orgId);
    const group = groups.find((g) => g.supplierId === supplierId);
    if (!group) redirect(`/${locale}/reorder`);

    // Re-read the suggestions server-side rather than trusting quantities posted
    // from the page: the numbers may have moved since it rendered, and they must
    // never come from the client.
    const po = await createPurchaseOrder(orgId, {
      supplierId,
      createdBy: userId,
      lines: group.lines.map((l) => ({
        productId: l.productId,
        quantity: l.suggestedQuantity,
        unitCost: l.costPrice,
      })),
    });
    redirect(`/${locale}/orders/${po.id}`);
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-4">
      <PageTitle>{t('title')}</PageTitle>

      {groups.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('nothingToOrder')}</p>
      ) : (
        groups.map((g) => {
          // A supplier minimum is a hard gate on placing the order, so it is
          // stated here rather than discovered at checkout.
          const belowMinimum =
            g.minOrderValue !== null && new Decimal(g.estimatedTotal).lessThan(g.minOrderValue);

          return (
            <section key={g.supplierId ?? 'none'} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-medium">{g.supplierName ?? t('noSupplier')}</h2>
                <p className="text-muted-foreground text-sm tabular-nums">
                  {t('leadTime', { days: g.leadTimeDays })} · {money(g.estimatedTotal)}
                </p>
                {belowMinimum && (
                  <p className="text-warning text-sm">
                    {t('belowMinimum', { minimum: money(g.minOrderValue!) })}
                  </p>
                )}
              </div>

              {/* Quantities right-aligned and tabular so a column of them can be
                  scanned down by eye. */}
              <DataList>
                {g.lines.map((l) => (
                  <DataRow
                    key={l.productId}
                    title={l.productName}
                    subtitle={
                      <>
                        {t('onHandAndRate', { onHand: l.onHand, rate: l.dailyRate ?? '—' })}
                        {l.confidence === 'low' && ` · ${t('lowConfidence')}`}
                        {new Decimal(l.onOrder).greaterThan(0) &&
                          ` · ${t('alreadyOnOrder', { quantity: l.onOrder })}`}
                      </>
                    }
                    value={
                      <>
                        {l.suggestedQuantity} <span className="opacity-70">{l.unit}</span>
                      </>
                    }
                  />
                ))}
              </DataList>

              {g.supplierId && (
                <form action={draftOrder}>
                  <input type="hidden" name="supplierId" value={g.supplierId} />
                  <Button type="submit" className="h-11 w-fit">
                    {t('createOrder')}
                  </Button>
                </form>
              )}
            </section>
          );
        })
      )}

      {withoutRate > 0 && (
        <p className="text-muted-foreground border-t pt-4 text-sm">
          {t('notEnoughData', { count: withoutRate })}
        </p>
      )}
    </main>
  );
}
