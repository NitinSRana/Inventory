import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import Decimal from 'decimal.js';

import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { requireRole } from '@/server/auth/session';
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
      <h1 className="text-2xl font-semibold">{t('title')}</h1>

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

              <ul className="flex flex-col gap-2">
                {g.lines.map((l) => (
                  <li key={l.productId} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate font-medium">{l.productName}</span>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {t('onHandAndRate', { onHand: l.onHand, rate: l.dailyRate ?? '—' })}
                        {l.confidence === 'low' && ` · ${t('lowConfidence')}`}
                      </span>
                      {new Decimal(l.onOrder).greaterThan(0) && (
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {t('alreadyOnOrder', { quantity: l.onOrder })}
                        </span>
                      )}
                    </div>
                    {/* Number before label, right-aligned, tabular so a column of
                        quantities can be scanned by eye. */}
                    <span className="shrink-0 text-right text-sm font-medium tabular-nums">
                      {l.suggestedQuantity} <span className="opacity-70">{l.unit}</span>
                    </span>
                  </li>
                ))}
              </ul>

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
