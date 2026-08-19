import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';

import { BackLink } from '@/components/back-link';
import { DataList, DataRow, PageTitle } from '@/components/data-list';
import { StickyAction } from '@/components/form';
import { Button } from '@/components/ui/button';
import { trimQuantity } from '@/lib/quantity';
import { requireRole } from '@/server/auth/session';
import { getSale, voidSale } from '@/server/pos/checkout';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

/**
 * Confirms a void before it happens, and names exactly what comes back — this
 * reverses real stock movements, so it gets a review screen rather than a
 * one-click button. Manager-gated: checked here again, not only by the link
 * that hides on the previous screen being missing.
 */
export default async function VoidSalePage({ params }: PageProps<'/[locale]/sales/[id]/void'>) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('sales');
  const tBack = await getTranslations('back');
  const { orgId } = await requireRole(locale, 'manager');

  const receipt = await getSale(orgId, id);
  if (!receipt) notFound();
  // Already voided: nothing left to confirm, so send them back rather than
  // showing a form that will just fail.
  if (receipt.sale.status === 'voided') redirect(`/${locale}/sales/${id}`);

  async function confirm() {
    'use server';
    const { orgId, userId } = await requireRole(locale, 'manager');
    await voidSale(orgId, id, userId);
    redirect(`/${locale}/sales/${id}`);
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-24">
      <BackLink href={`/${locale}/sales/${id}`} label={tBack('sale')} />
      <PageTitle>{t('voidTitle', { number: receipt.sale.saleNumber })}</PageTitle>
      <p className="text-muted-foreground text-sm">{t('voidBody')}</p>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{t('stockRestored')}</h2>
        <DataList>
          {receipt.lines.map((l) => (
            <DataRow
              key={l.productId}
              title={l.name}
              value={`+${trimQuantity(l.quantity)}`}
              meta={<span className="opacity-70">{l.unit}</span>}
            />
          ))}
        </DataList>
      </div>

      <form action={confirm}>
        <StickyAction>
          <Button type="submit" variant="destructive" className="h-12 w-full sm:w-fit">
            {t('confirmVoid')}
          </Button>
        </StickyAction>
      </form>
    </main>
  );
}
