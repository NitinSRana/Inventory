import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import Decimal from 'decimal.js';
import { Info } from 'lucide-react';

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
 *
 * Laid out as the "Correct Stock Level" frame. Its amber notice is neutral
 * here: amber means expiry or money at risk, and this is guidance. The submit
 * button is ink, as every primary action is.
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
  const format = await getFormatter();
  const { orgId } = await requireRole(locale, 'manager');

  // RLS scopes this, so another tenant's id is indistinguishable from a missing one.
  const product = await getProduct(orgId, id);
  if (!product) notFound();

  const stock = await getProductStock(orgId, id);
  const onHand = stock.reduce((sum, s) => sum.plus(s.quantity ?? '0'), new Decimal(0)).toString();
  const lastMovementAt = stock
    .map((s) => s.lastMovementAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];

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
    <main className="flex flex-1 flex-col gap-5 p-4 pb-24">
      <BackLink href={`/${locale}/products/${id}`} label={tBack('product')} />
      <PageTitle>{t('correctStock')}</PageTitle>

      <p className="bg-muted flex items-start gap-2 rounded-lg border p-3 text-sm md:max-w-lg">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        {t('correctStockBody')}
      </p>

      <section className="bg-card flex flex-col gap-1 rounded-xl border p-4 md:max-w-lg">
        <span className="text-base font-bold">{product.name}</span>
        <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-sm">
          <span className="tabular-nums">
            {t.rich('currentStockLine', {
              quantity: trimQuantity(onHand),
              unit: product.unit,
              strong: (chunks) => <strong className="text-foreground font-semibold">{chunks}</strong>,
            })}
          </span>
          {lastMovementAt && (
            <>
              <span aria-hidden>•</span>
              <span>
                {t('lastMovementLine', {
                  date: format.dateTime(lastMovementAt, { dateStyle: 'medium', timeStyle: 'short' }),
                })}
              </span>
            </>
          )}
        </span>
      </section>

      <form action={save} className="flex flex-col gap-5 pb-32 md:pb-0">
        <Field name="quantity" label={t('correctQuantity', { unit: product.unit })} required>
          <Input
            id="quantity"
            name="quantity"
            inputMode="decimal"
            required
            autoFocus
            defaultValue={trimQuantity(onHand)}
            className="h-14 text-lg tabular-nums"
          />
        </Field>

        <Field
          name="reason"
          label={t('correctReason')}
          hint={t('correctReasonHint')}
          required
          error={error === 'reason' ? t('correctReasonRequired') : undefined}
        >
          {/* A sentence, so a box a sentence fits in. */}
          <textarea
            id="reason"
            name="reason"
            required
            rows={4}
            className="border-input bg-card focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-lg border px-3 py-2 text-base outline-none focus-visible:ring-3 md:text-sm"
          />
        </Field>

        {error === 'unchanged' && (
          <p role="alert" className="text-destructive text-sm">
            {t('correctUnchanged')}
          </p>
        )}

        <StickyAction>
          <Button type="submit" className="h-12 w-full sm:w-fit sm:px-8">
            {t('correctSubmit')}
          </Button>
        </StickyAction>
      </form>
    </main>
  );
}
