import Decimal from 'decimal.js';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';

import { BackLink } from '@/components/back-link';
import { PageTitle } from '@/components/data-list';
import { trimQuantity } from '@/lib/quantity';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { requireOrg, requireRole } from '@/server/auth/session';
import {
  cancelPurchaseOrder,
  getPurchaseOrder,
  markPurchaseOrderSent,
  receiveAgainstPurchaseOrder,
  type ReceiptLineInput,
} from '@/server/purchasing/orders';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function OrderPage({ params, searchParams }: PageProps<'/[locale]/orders/[id]'>) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const { over } = await searchParams;
  const t = await getTranslations('orders');
  const tBack = await getTranslations('back');
  const format = await getFormatter();
  const { orgId } = await requireOrg(locale);

  // RLS scopes this, so another tenant's id is indistinguishable from a missing one.
  const po = await getPurchaseOrder(orgId, id);
  if (!po) notFound();

  const [org] = await withTenant(orgId, (tx) => tx.select().from(organizations));
  const money = (v: string) => format.number(Number(v), { style: 'currency', currency: org.currencyCode });

  async function send() {
    'use server';
    const { orgId } = await requireRole(locale, 'manager');
    await markPurchaseOrderSent(orgId, id);
    redirect(`/${locale}/orders/${id}`);
  }

  async function receive(formData: FormData) {
    'use server';
    // Staff book in deliveries — that is who unloads the van.
    const { orgId, userId } = await requireOrg(locale);
    const receipts: ReceiptLineInput[] = [];
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith('qty:') || typeof value !== 'string' || !value.trim()) continue;
      const lineId = key.slice(4);
      receipts.push({
        lineId,
        quantity: value.trim(),
        expiryDate: (formData.get(`exp:${lineId}`) as string) || null,
        lotNumber: (formData.get(`lot:${lineId}`) as string) || null,
      });
    }
    if (receipts.length === 0) redirect(`/${locale}/orders/${id}`);

    const { discrepancies } = await receiveAgainstPurchaseOrder(orgId, id, receipts, userId);
    redirect(`/${locale}/orders/${id}${discrepancies.length ? `?over=${discrepancies.length}` : ''}`);
  }

  async function cancel() {
    'use server';
    const { orgId } = await requireRole(locale, 'manager');
    await cancelPurchaseOrder(orgId, id);
    redirect(`/${locale}/orders`);
  }

  const outstanding = po.lines.filter((l) =>
    new Decimal(l.quantityOrdered).greaterThan(l.quantityReceived),
  );

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-28">
      <BackLink href={`/${locale}/orders`} label={tBack('orders')} />
      <div className="flex flex-col gap-1">
        <PageTitle>{po.supplierName}</PageTitle>
        <p className="text-muted-foreground text-sm">
          <span className="font-mono">{po.poNumber}</span> · {t(`status.${po.status}`)} ·{' '}
          <span className="tabular-nums">{money(po.total)}</span>
        </p>
      </div>

      {over && (
        <p role="alert" className="text-warning text-sm">
          {t('overDelivered', { count: Number(over) })}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {po.lines.map((l) => {
          const short = new Decimal(l.quantityOrdered).greaterThan(l.quantityReceived);
          return (
            <li key={l.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-medium">{l.productName}</span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {t('receivedOfOrdered', {
                    received: trimQuantity(l.quantityReceived),
                    ordered: trimQuantity(l.quantityOrdered),
                    unit: l.unit,
                  })}
                </span>
              </div>
              {/* Outstanding stated in words, not implied by a colour. */}
              <span className="text-muted-foreground shrink-0 text-xs">
                {short ? t('outstanding') : t('complete')}
              </span>
            </li>
          );
        })}
      </ul>

      {po.status === 'draft' && (
        <form action={send} className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">{t('sendHint')}</p>
          <Button type="submit" className="h-12 w-fit">
            {t('markSent')}
          </Button>
        </form>
      )}

      {po.status !== 'received' && po.status !== 'cancelled' && (
        <form action={cancel}>
          {/* Stops the outstanding quantity so reorder suggestions come back.
              Anything already delivered stays in the ledger. */}
          <Button type="submit" variant="outline" className="h-11">
            {t('cancelOrder')}
          </Button>
        </form>
      )}

      {outstanding.length > 0 && po.status !== 'draft' && po.status !== 'cancelled' && (
        <form action={receive} className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">{t('receiveTitle')}</h2>
          <p className="text-muted-foreground text-sm">{t('receiveHint')}</p>

          {outstanding.map((l) => (
            <fieldset key={l.id} className="flex flex-col gap-2 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">{l.productName}</legend>

              <div className="flex gap-3">
                <div className="flex flex-1 flex-col gap-1">
                  <Label htmlFor={`qty:${l.id}`} className="text-xs">
                    {t('quantity')}
                  </Label>
                  <Input
                    id={`qty:${l.id}`}
                    name={`qty:${l.id}`}
                    inputMode="decimal"
                    // Pre-filled with what is still outstanding: the common case
                    // is the rest of the order arriving, so accepting the default
                    // is one tap.
                    defaultValue={new Decimal(l.quantityOrdered)
                      .minus(l.quantityReceived)
                      .toString()}
                    className="h-12 text-right tabular-nums"
                  />
                </div>
                <div className="flex flex-1 flex-col gap-1">
                  <Label htmlFor={`exp:${l.id}`} className="text-xs">
                    {t('expiry')}
                  </Label>
                  <Input id={`exp:${l.id}`} name={`exp:${l.id}`} type="date" className="h-12" />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor={`lot:${l.id}`} className="text-xs">
                  {t('lot')}
                </Label>
                <Input
                  id={`lot:${l.id}`}
                  name={`lot:${l.id}`}
                  autoComplete="off"
                  className="h-12 font-mono"
                />
              </div>
            </fieldset>
          ))}

          <Button type="submit" className="fixed inset-x-4 bottom-20 sm:bottom-6 h-12 sm:static sm:w-fit">
            {t('recordDelivery')}
          </Button>
        </form>
      )}
    </main>
  );
}
