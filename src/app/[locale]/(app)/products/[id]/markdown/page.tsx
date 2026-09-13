import Decimal from 'decimal.js';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';

import { BackLink } from '@/components/back-link';
import { PageTitle } from '@/components/data-list';
import { Field, StickyAction } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { trimQuantity } from '@/lib/quantity';
import { one, pick } from '@/lib/search-params';
import { requireRole } from '@/server/auth/session';
import { getProduct } from '@/server/catalog/products';
import { getProductBatches } from '@/server/stock/levels';
import {
  MarkdownRefusedError,
  clearBatchMarkdown,
  setBatchMarkdown,
  type MarkdownRefusal,
} from '@/server/stock/markdowns';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

const REFUSALS = [
  'invalidPrice',
  'notFound',
  'noShelfPrice',
  'notBelowShelf',
  'expiredUseBy',
] as const satisfies readonly MarkdownRefusal[];

/**
 * Marking one batch down.
 *
 * The Figma redesign shows what markdowns produce — "Mitigated losses" on the
 * dashboard, a reduced tag at the till — but no frame shows how one is set, so
 * this screen is built in the same style rather than copied from a frame.
 *
 * Manager-only, like voiding: a price cut is money leaving the shop. One batch
 * at a time, because the point is the near-expiry stock, not the fresh units
 * sitting behind it on the same shelf.
 */
export default async function MarkdownPage({
  params,
  searchParams,
}: PageProps<'/[locale]/products/[id]/markdown'>) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const sp = await searchParams;
  const error = pick(sp.error, REFUSALS);
  const t = await getTranslations('markdown');
  const tBack = await getTranslations('back');
  const tProducts = await getTranslations('products');
  const format = await getFormatter();
  const { orgId } = await requireRole(locale, 'manager');

  // RLS scopes both lookups, so another shop's product or batch is a 404.
  const product = await getProduct(orgId, id);
  if (!product) notFound();
  const batchId = one(sp.batch);
  const batch = batchId ? (await getProductBatches(orgId, id)).find((b) => b.batchId === batchId) : undefined;
  if (!batch) notFound();

  const batchKey = batch.batchId;
  const [org] = await withTenant(orgId, (tx) => tx.select().from(organizations));
  const money = (v: string) => format.number(Number(v), { style: 'currency', currency: org.currencyCode });

  async function save(formData: FormData) {
    'use server';
    const { orgId, userId } = await requireRole(locale, 'manager');
    try {
      await setBatchMarkdown(orgId, {
        batchId: batchKey,
        price: String(formData.get('price') ?? ''),
        actorId: userId,
      });
    } catch (e) {
      if (!(e instanceof MarkdownRefusedError)) throw e;
      redirect(`/${locale}/products/${id}/markdown?batch=${batchKey}&error=${e.reason}`);
    }
    redirect(`/${locale}/products/${id}`);
  }

  async function clear() {
    'use server';
    const { orgId } = await requireRole(locale, 'manager');
    await clearBatchMarkdown(orgId, batchKey);
    redirect(`/${locale}/products/${id}`);
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-28">
      <BackLink href={`/${locale}/products/${id}`} label={tBack('product')} />
      <PageTitle caption={t('intro')}>{t('title')}</PageTitle>

      <section className="bg-card flex flex-col gap-1 rounded-xl border p-4">
        <p className="font-semibold">{product.name}</p>
        <p className="text-muted-foreground text-sm">
          {batch.lotNumber ?? '—'} ·{' '}
          {batch.expiryDate
            ? format.dateTime(new Date(batch.expiryDate), { dateStyle: 'medium' })
            : tProducts('noExpiry')}
        </p>
        <p className="text-muted-foreground text-sm tabular-nums">
          {t('inBatch', { quantity: trimQuantity(batch.quantity ?? '0'), unit: product.unit })}
        </p>
        <p className="text-sm tabular-nums">
          {t('shelfPrice', { price: product.sellPrice ? money(product.sellPrice) : '—' })}
        </p>
      </section>

      <form action={save} className="flex flex-col gap-4">
        <Field
          name="price"
          label={t('priceLabel')}
          hint={t('priceHint')}
          error={error ? t(`errors.${error}`) : undefined}
        >
          <Input
            id="price"
            name="price"
            inputMode="decimal"
            required
            defaultValue={batch.markdownPrice ? new Decimal(batch.markdownPrice).toString() : ''}
            className="h-12 text-right tabular-nums"
          />
        </Field>
        <StickyAction>
          <Button type="submit" className="h-12 w-full sm:w-fit">
            {t('save')}
          </Button>
        </StickyAction>
      </form>

      {batch.markdownPrice && (
        <form action={clear}>
          <Button type="submit" variant="outline" className="h-11">
            {t('clear')}
          </Button>
        </form>
      )}
    </main>
  );
}
