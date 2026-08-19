import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Decimal from 'decimal.js';

import { BackLink } from '@/components/back-link';
import { DataList, DataRow, PageTitle } from '@/components/data-list';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { trimQuantity } from '@/lib/quantity';
import { requireOrg, roleAtLeast } from '@/server/auth/session';
import { getSale } from '@/server/pos/checkout';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function SaleDetailPage({ params }: PageProps<'/[locale]/sales/[id]'>) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('sales');
  const tVat = await getTranslations('vat');
  const tBack = await getTranslations('back');
  const format = await getFormatter();
  const { orgId, role } = await requireOrg(locale);

  // RLS scopes this, so another tenant's id is indistinguishable from a missing one.
  const receipt = await getSale(orgId, id);
  if (!receipt) notFound();
  const { sale, lines, vatBreakdown } = receipt;

  const [org] = await withTenant(orgId, (tx) => tx.select().from(organizations));
  const money = (v: string) => format.number(Number(v), { style: 'currency', currency: org.currencyCode });
  const netTotal = new Decimal(sale.subtotal);

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-24">
      <BackLink href={`/${locale}/sales`} label={tBack('sales')} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <PageTitle>{sale.saleNumber}</PageTitle>
          <p className="text-muted-foreground text-sm">
            {t('receiptMeta', {
              tender: t(`tenderTypes.${sale.tenderType}`),
              time: format.dateTime(new Date(sale.occurredAt ?? sale.createdAt), {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            })}
          </p>
        </div>
        {sale.status === 'voided' && <Badge variant="destructive">{t('voided')}</Badge>}
      </div>

      <DataList>
        {lines.map((l) => (
          <DataRow
            key={l.productId}
            href={`/${locale}/products/${l.productId}`}
            title={l.name}
            subtitle={
              <>
                {trimQuantity(l.quantity)} {l.unit} × {money(l.unitPrice)}
              </>
            }
            value={money(l.lineTotal)}
          />
        ))}
      </DataList>

      <div className="flex flex-col gap-1 border-t pt-3">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t('subtotal')}</span>
          <span className="tabular-nums">{money(netTotal.toFixed(2))}</span>
        </div>
        {vatBreakdown.map((b) => (
          <div key={b.band} className="flex justify-between text-sm">
            <span className="text-muted-foreground">{tVat(`bands.${b.band}`)}</span>
            <span className="tabular-nums">{money(b.vat)}</span>
          </div>
        ))}
        <div className="flex justify-between border-t pt-2 text-lg font-semibold">
          <span>{t('total')}</span>
          <span className="tabular-nums">{money(sale.total)}</span>
        </div>
      </div>

      {sale.status !== 'voided' && roleAtLeast(role, 'manager') && (
        <Link
          href={`/${locale}/sales/${id}/void`}
          className={buttonVariants({ variant: 'destructive', className: 'h-11 w-fit' })}
        >
          {t('void')}
        </Link>
      )}
    </main>
  );
}
