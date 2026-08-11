import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { BarcodeField } from '@/components/barcode-field';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requireOrg } from '@/server/auth/session';
import { findProductByBarcode } from '@/server/catalog/products';
import { getDueForCount } from '@/server/counting/due';
import { getOpenSession, getSessionLines, recordCount, startCountSession } from '@/server/counting/sessions';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function CountPage({ params, searchParams }: PageProps<'/[locale]/count'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { gtin, notFound } = await searchParams;
  const t = await getTranslations('count');
  const { orgId } = await requireOrg(locale);

  const session = await getOpenSession(orgId);

  async function start(formData: FormData) {
    'use server';
    const { orgId, userId } = await requireOrg(locale);
    const name = String(formData.get('name') ?? '').trim();
    await startCountSession(orgId, { name: name || null, startedBy: userId });
    redirect(`/${locale}/count`);
  }

  if (!session) {
    // What's overdue, so the queue decides where to walk rather than habit.
    const due = await getDueForCount(orgId, 20);

    return (
      <main className="flex flex-1 flex-col gap-6 p-4">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('noSession')}</p>

        <form action={start} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">{t('sectionLabel')}</Label>
            <Input id="name" name="name" placeholder={t('sectionPlaceholder')} className="h-12" />
          </div>
          <Button type="submit" className="h-12 w-fit">
            {t('start')}
          </Button>
        </form>

        {due.length > 0 && (
          <section className="flex flex-col gap-2 border-t pt-4">
            <h2 className="text-sm font-medium">{t('dueTitle', { count: due.length })}</h2>
            <ul className="flex flex-col gap-1">
              {due.slice(0, 10).map((p) => (
                <li key={p.id} className="flex justify-between gap-3 border-b py-2 text-sm">
                  <span className="truncate">{p.name}</span>
                  {/* Stated in words as well as by position — "never counted"
                      and "3 days over" are different kinds of urgent. */}
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {p.lastCountedAt
                      ? t('daysOver', { days: p.daysOverdue })
                      : t('neverCounted')}
                  </span>
                </li>
              ))}
            </ul>
            {due.length > 10 && (
              <p className="text-muted-foreground text-xs tabular-nums">
                {t('andMore', { count: due.length - 10 })}
              </p>
            )}
          </section>
        )}
      </main>
    );
  }

  const barcode = typeof gtin === 'string' ? gtin : undefined;
  const product = barcode ? await findProductByBarcode(orgId, barcode) : null;
  const lines = await getSessionLines(orgId, session.id);

  async function save(formData: FormData) {
    'use server';
    const { orgId, userId } = await requireOrg(locale);
    await recordCount(orgId, {
      countSessionId: String(formData.get('countSessionId')),
      productId: String(formData.get('productId')),
      countedQuantity: String(formData.get('countedQuantity') ?? '').trim(),
      countedBy: userId,
    });
    // Straight back to an empty scanner: the next item is already in hand.
    redirect(`/${locale}/count`);
  }

  async function lookUp(formData: FormData) {
    'use server';
    const { orgId } = await requireOrg(locale);
    const code = String(formData.get('gtin') ?? '').trim();
    const found = await findProductByBarcode(orgId, code);
    redirect(found ? `/${locale}/count?gtin=${code}` : `/${locale}/count?notFound=${code}`);
  }

  return (
    <main className="flex flex-1 flex-col gap-5 p-4 pb-28">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">{session.name ?? t('title')}</h1>
        <span className="text-muted-foreground text-sm tabular-nums">
          {t('countedSoFar', { count: lines.length })}
        </span>
      </div>

      {product ? (
        // Step two: quantity. Autofocused, numeric keypad, one action.
        <form action={save} className="flex flex-col gap-4">
          <input type="hidden" name="countSessionId" value={session.id} />
          <input type="hidden" name="productId" value={product.id} />
          <div className="flex flex-col gap-1">
            <span className="text-lg font-medium">{product.name}</span>
            <span className="text-muted-foreground font-mono text-xs">{product.gtin}</span>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="countedQuantity">{t('countedLabel', { unit: product.unit })}</Label>
            <Input
              id="countedQuantity"
              name="countedQuantity"
              inputMode="decimal"
              required
              autoFocus
              className="h-14 text-right text-lg tabular-nums"
            />
          </div>
          <Button type="submit" className="fixed inset-x-4 bottom-20 sm:bottom-6 h-12 sm:static sm:w-fit">
            {t('saveAndNext')}
          </Button>
        </form>
      ) : (
        // Step one: identify. Field is live on load so a scanner gun or a thumb
        // can go straight in without a tap.
        <form action={lookUp} className="flex flex-col gap-3">
          <BarcodeField autoFocus />
          {notFound && (
            <p role="alert" className="text-destructive text-sm">
              {t('notFound', { barcode: String(notFound) })}
            </p>
          )}
          <Button type="submit" variant="outline" className="h-11 w-fit">
            {t('lookUp')}
          </Button>
        </form>
      )}

      {lines.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-muted-foreground text-sm font-medium">{t('counted')}</h2>
          <ul className="flex flex-col gap-1">
            {lines.map((l) => (
              <li key={l.id} className="flex justify-between gap-3 border-b py-2 text-sm">
                <span className="truncate">{l.productName}</span>
                <span className="shrink-0 tabular-nums">
                  {l.countedQuantity} <span className="opacity-70">{l.unit}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link
        href={`/${locale}/count/review`}
        className={buttonVariants({ variant: 'outline', className: 'h-11 w-fit' })}
      >
        {t('review')}
      </Link>
    </main>
  );
}
