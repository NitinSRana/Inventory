import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import Decimal from 'decimal.js';

import { BackLink } from '@/components/back-link';
import { PageTitle } from '@/components/data-list';
import { Field, StickyAction } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trimQuantity } from '@/lib/quantity';
import { requireRole } from '@/server/auth/session';
import { getProduct } from '@/server/catalog/products';
import { adjustStock } from '@/server/stock/movements';
import { getProductStock } from '@/server/stock/levels';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

/**
 * Fixes a keying error — received 100 instead of 10, typed the wrong count —
 * without needing a full stocktake to find it.
 *
 * Not a write-off: there is no reason-code picker, only a required sentence
 * explaining what happened. Posts through `adjustStock()`, the same
 * compensating-movement mechanism every other correction in this ledger uses,
 * tagged `manual_adjustment` so it never reads as a count's own variance.
 */
export default async function CorrectStockPage({
  params,
  searchParams,
}: PageProps<'/[locale]/products/[id]/correct'>) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const { error } = await searchParams;
  const t = await getTranslations('products');
  const tBack = await getTranslations('back');
  const { orgId } = await requireRole(locale, 'manager');

  // RLS scopes this, so another tenant's id is indistinguishable from a missing one.
  const product = await getProduct(orgId, id);
  if (!product) notFound();

  const stock = await getProductStock(orgId, id);
  const onHand = stock.reduce((sum, s) => sum + Number(s.quantity ?? 0), 0);

  async function save(formData: FormData) {
    'use server';
    const { orgId, userId } = await requireRole(locale, 'manager');

    const typed = String(formData.get('quantity') ?? '').trim();
    const reason = String(formData.get('reason') ?? '').trim();
    if (!reason) redirect(`/${locale}/products/${id}/correct?error=reason`);

    // Re-read fresh rather than trusting the value the page rendered with —
    // this runs on submit, which can be long after the page loaded.
    const current = await getProductStock(orgId, id);
    const before = current.reduce((sum, s) => sum.plus(s.quantity ?? '0'), new Decimal(0));
    const after = new Decimal(typed || '0');
    const delta = after.minus(before);

    if (delta.isZero()) redirect(`/${locale}/products/${id}/correct?error=unchanged`);

    await adjustStock(orgId, {
      productId: id,
      quantityDelta: delta.toString(),
      reasonCode: 'correction',
      note: reason,
      actorId: userId,
    });
    redirect(`/${locale}/products/${id}`);
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-24">
      <BackLink href={`/${locale}/products/${id}`} label={tBack('product')} />
      <PageTitle>{t('correctStock')}</PageTitle>
      <p className="text-muted-foreground text-sm">{t('correctStockBody')}</p>

      <form action={save} className="flex flex-col gap-4 pb-20 sm:pb-0">
        <Field name="quantity" label={t('correctQuantity', { unit: product.unit })}>
          <Input
            id="quantity"
            name="quantity"
            inputMode="decimal"
            required
            autoFocus
            defaultValue={trimQuantity(String(onHand))}
            className="h-14 text-right text-lg tabular-nums"
          />
        </Field>

        <Field
          name="reason"
          label={t('correctReason')}
          hint={t('correctReasonHint')}
          error={error === 'reason' ? t('correctReasonRequired') : undefined}
        >
          <Input id="reason" name="reason" required className="h-12" />
        </Field>

        {error === 'unchanged' && (
          <p role="alert" className="text-destructive text-sm">
            {t('correctUnchanged')}
          </p>
        )}

        <StickyAction>
          <Button type="submit" variant="destructive" className="h-12 w-full sm:w-fit">
            {t('correctSubmit')}
          </Button>
        </StickyAction>
      </form>
    </main>
  );
}
