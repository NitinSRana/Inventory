import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Check } from 'lucide-react';

import { DataList, DataRow, PageTitle } from '@/components/data-list';
import { BarcodeField } from '@/components/barcode-field';
import { Field, StickyAction } from '@/components/form';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trimQuantity } from '@/lib/quantity';
import { requireOrg } from '@/server/auth/session';
import { findProductByBarcode } from '@/server/catalog/products';
import { getDueForCount } from '@/server/counting/due';
import {
  ProductAlreadyCountedError,
  getOpenSession,
  getSessionLines,
  listOpenSessions,
  recordCount,
  startCountSession,
} from '@/server/counting/sessions';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function CountPage({ params, searchParams }: PageProps<'/[locale]/count'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { gtin, notFound, session: sessionId, taken, saved } = await searchParams;
  const t = await getTranslations('count');
  const { orgId, userId } = await requireOrg(locale);

  // Your own count, unless you have explicitly opened someone else's to finish it.
  const session = await getOpenSession(orgId, userId, typeof sessionId === 'string' ? sessionId : undefined);
  const otherCounts = (await listOpenSessions(orgId)).filter((s) => s.id !== session?.id);

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
        <PageTitle caption={t('noSession')}>{t('title')}</PageTitle>

        <form action={start} className="flex flex-col gap-4">
          <Field name="name" label={t('sectionLabel')}>
            <Input id="name" name="name" placeholder={t('sectionPlaceholder')} className="h-12" />
          </Field>
          <Button type="submit" className="h-12 w-fit">
            {t('start')}
          </Button>
        </form>

      {otherCounts.length > 0 && (
        <section className="flex flex-col gap-2 border-t pt-4">
          <h2 className="text-sm font-medium">{t('otherCounts', { count: otherCounts.length })}</h2>
          <p className="text-muted-foreground text-sm">{t('otherCountsHint')}</p>
          {/* Reachable, or a count left open by someone who went home would lock
              its products out of every future count with no way to clear it. */}
          <DataList>
            {otherCounts.map((s) => (
              <DataRow
                key={s.id}
                href={`/${locale}/count?session=${s.id}`}
                title={s.name ?? t('title')}
                subtitle={t('linesCounted', { count: s.lineCount })}
              />
            ))}
          </DataList>
        </section>
      )}

        {due.length > 0 && (
          <section className="flex flex-col gap-2 border-t pt-4">
            <h2 className="text-sm font-medium">{t('dueTitle', { count: due.length })}</h2>
            {/* Urgency stated in words, not by position alone — "never counted"
                and "3 days over" are different kinds of urgent. */}
            <DataList>
              {due.slice(0, 10).map((p) => (
                <DataRow
                  key={p.id}
                  href={`/${locale}/products/${p.id}`}
                  title={p.name}
                  meta={
                    p.lastCountedAt ? t('daysOver', { days: p.daysOverdue }) : t('neverCounted')
                  }
                />
              ))}
            </DataList>
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

  // Lines come back sorted by product name, because the review screen shares
  // this query and wants them that way — so "the last one" cannot be inferred
  // from position. The id from the redirect names it instead.
  const justSaved = typeof saved === 'string' ? lines.find((l) => l.productId === saved) : undefined;

  async function save(formData: FormData) {
    'use server';
    const { orgId, userId } = await requireOrg(locale);
    const countSessionId = String(formData.get('countSessionId'));
    const productId = String(formData.get('productId'));
    try {
      await recordCount(orgId, {
        countSessionId,
        productId,
        countedQuantity: String(formData.get('countedQuantity') ?? '').trim(),
        countedBy: userId,
      });
    } catch (e) {
      // Somebody else has this product on their count. Say whose, so the answer
      // is "go and ask Pawel", not "the app is broken".
      if (e instanceof ProductAlreadyCountedError) {
        redirect(`/${locale}/count?taken=${encodeURIComponent(e.sessionName ?? '')}`);
      }
      throw e;
    }
    // Straight back to an empty scanner: the next item is already in hand. The
    // id rides along so the scanner can say what just landed — without it the
    // screen a counter sees after every single item is indistinguishable from
    // one where nothing saved.
    redirect(`/${locale}/count?saved=${productId}`);
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
        <PageTitle>{session.name ?? t('title')}</PageTitle>
        <span className="text-muted-foreground text-sm tabular-nums">
          {t('countedSoFar', { count: lines.length })}
        </span>
      </div>

      {taken !== undefined && (
        <p role="alert" className="text-warning text-sm">
          {t('taken', { section: String(taken) || t('takenUnnamed') })}
        </p>
      )}

      {sessionId && (
        <p className="text-muted-foreground text-sm">{t('viewingOther')}</p>
      )}

      {product ? (
        // Step two: quantity. Autofocused, numeric keypad, one action.
        <form action={save} className="flex flex-col gap-4">
          <input type="hidden" name="countSessionId" value={session.id} />
          <input type="hidden" name="productId" value={product.id} />
          <div className="flex flex-col gap-1">
            <span className="text-lg font-medium">{product.name}</span>
            <span className="text-muted-foreground font-mono text-xs">{product.gtin}</span>
          </div>
          <Field name="countedQuantity" label={t('countedLabel', { unit: product.unit })}>
            <Input
              id="countedQuantity"
              name="countedQuantity"
              inputMode="decimal"
              required
              autoFocus
              className="h-14 text-right text-lg tabular-nums"
            />
          </Field>
          <StickyAction>
            <Button type="submit" className="h-12 w-full sm:w-fit">
              {t('saveAndNext')}
            </Button>
          </StickyAction>
        </form>
      ) : (
        // Step one: identify. Field is live on load so a scanner gun or a thumb
        // can go straight in without a tap.
        <form action={lookUp} className="flex flex-col gap-3">
          {/* What just landed. Deliberately not green: colour in this product
              means expiry urgency and nothing else, so the tick and the word
              carry it. Re-scanning overwrites the line, so the hint is true. */}
          {justSaved && (
            <div
              role="status"
              className="bg-muted flex items-start gap-2 rounded-lg px-3 py-2 text-sm"
            >
              <Check aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2.4} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">
                  {t('savedLine', {
                    name: justSaved.productName,
                    quantity: trimQuantity(justSaved.countedQuantity),
                    unit: justSaved.unit,
                  })}
                </span>
                <span className="text-muted-foreground">{t('savedHint')}</span>
              </span>
            </div>
          )}

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
          <DataList>
            {lines.map((l) => (
              <DataRow
                key={l.id}
                title={l.productName}
                value={
                  <>
                    {trimQuantity(l.countedQuantity)} <span className="opacity-70">{l.unit}</span>
                  </>
                }
              />
            ))}
          </DataList>
        </section>
      )}

      {otherCounts.length > 0 && (
        <section className="flex flex-col gap-2 border-t pt-4">
          <h2 className="text-sm font-medium">{t('otherCounts', { count: otherCounts.length })}</h2>
          <p className="text-muted-foreground text-sm">{t('otherCountsHint')}</p>
          {/* Reachable, or a count left open by someone who went home would lock
              its products out of every future count with no way to clear it. */}
          <DataList>
            {otherCounts.map((s) => (
              <DataRow
                key={s.id}
                href={`/${locale}/count?session=${s.id}`}
                title={s.name ?? t('title')}
                subtitle={t('linesCounted', { count: s.lineCount })}
              />
            ))}
          </DataList>
        </section>
      )}

      <Link
        href={`/${locale}/count/review?session=${session.id}`}
        className={buttonVariants({ variant: 'outline', className: 'h-11 w-fit' })}
      >
        {t('review')}
      </Link>
    </main>
  );
}
