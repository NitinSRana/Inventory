import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { BackLink } from '@/components/back-link';
import { CategoryForm, categoryInputFrom } from '@/components/category-form';
import { PageTitle, SectionHeading, StatTile } from '@/components/data-list';
import { Button, buttonVariants } from '@/components/ui/button';
import { COUNT_FREQUENCIES } from '@/db/schema';
import { trimQuantity } from '@/lib/quantity';
import { one, pick } from '@/lib/search-params';
import { requireRole } from '@/server/auth/session';
import {
  countProductsInCategory,
  deleteCategory,
  getCategory,
  getCategorySummary,
  updateCategory,
} from '@/server/catalog/categories';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

/**
 * Laid out as the category-detail frame: icon, name and description, the count
 * frequency as a segmented control, figure tiles, then the products in it.
 *
 * The frequency segments save on tap, as the frame implies — each is its own
 * one-field form, so it works without client JS and a tap is one request.
 * Name, icon and description sit behind Edit (`?edit=1`), with Delete, so the
 * everyday view is not a form.
 *
 * Average margin stays in the foreground colour; the frame tints it green, and
 * colour here means expiry.
 */
export default async function CategoryPage({ params, searchParams }: PageProps<'/[locale]/categories/[id]'>) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const sp = await searchParams;
  const editing = one(sp.edit) === '1';
  const t = await getTranslations('categories');
  const tBack = await getTranslations('back');
  const { orgId } = await requireRole(locale, 'manager');

  // RLS scopes this, so another tenant's id is indistinguishable from a missing one.
  const category = await getCategory(orgId, id);
  if (!category) notFound();

  async function save(formData: FormData) {
    'use server';
    const { orgId } = await requireRole(locale, 'manager');
    try {
      await updateCategory(orgId, id, categoryInputFrom(formData));
    } catch {
      redirect(`/${locale}/categories/${id}?edit=1&error=1`);
    }
    redirect(`/${locale}/categories/${id}`);
  }

  async function setFrequency(formData: FormData) {
    'use server';
    const { orgId } = await requireRole(locale, 'manager');
    // Only a value the schema allows reaches the update.
    const frequency = pick(String(formData.get('frequency') ?? ''), COUNT_FREQUENCIES);
    const current = await getCategory(orgId, id);
    if (current && frequency) {
      await updateCategory(orgId, id, {
        name: current.name,
        description: current.description,
        icon: current.icon,
        defaultCountFrequency: frequency,
      });
    }
    redirect(`/${locale}/categories/${id}`);
  }

  async function remove() {
    'use server';
    const { orgId } = await requireRole(locale, 'manager');
    await deleteCategory(orgId, id);
    redirect(`/${locale}/categories`);
  }

  if (editing) {
    const productCount = await countProductsInCategory(orgId, id);
    return (
      <main className="flex flex-1 flex-col gap-6 p-4">
        <BackLink href={`/${locale}/categories/${id}`} label={category.name} />
        <PageTitle caption={category.name}>{t('editTitle')}</PageTitle>

        <CategoryForm action={save} defaults={category} error={one(sp.error)} />

        {/* Hard delete, not deactivate: nothing in the ledger references a
            category, and products.category_id is on delete set null — a deleted
            category just leaves its products uncategorised. */}
        <form action={remove} className="flex flex-col gap-2 md:max-w-lg">
          {productCount > 0 && (
            <p className="text-muted-foreground text-sm">{t('deleteWarning', { count: productCount })}</p>
          )}
          <Button type="submit" variant="ghost" className="text-destructive h-11 w-full sm:w-fit">
            {t('delete')}
          </Button>
        </form>
      </main>
    );
  }

  const summary = await getCategorySummary(orgId, id);

  return (
    <main className="flex flex-1 flex-col gap-5 p-4 md:max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <BackLink href={`/${locale}/categories`} label={tBack('categories')} />
        <Link
          href={`/${locale}/categories/${id}?edit=1`}
          className={buttonVariants({ variant: 'outline', className: 'h-11' })}
        >
          {t('edit')}
        </Link>
      </div>

      <PageTitle caption={category.description ?? undefined}>
        {category.icon ? `${category.icon} ${category.name}` : category.name}
      </PageTitle>

      <section className="bg-card flex flex-col gap-2 rounded-xl border p-3">
        <SectionHeading>{t('frequencyLabel')}</SectionHeading>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          {COUNT_FREQUENCIES.map((f) => {
            const active = f === category.defaultCountFrequency;
            return (
              <form key={f} action={setFrequency}>
                <input type="hidden" name="frequency" value={f} />
                <button
                  type="submit"
                  aria-pressed={active}
                  className={`min-h-11 w-full rounded-md px-2 text-sm ${
                    active ? 'bg-primary text-primary-foreground font-semibold' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {t(`frequencies.${f}`)}
                </button>
              </form>
            );
          })}
        </div>
        <p className="text-muted-foreground text-xs">{t('countFrequencyHint')}</p>
      </section>

      <div className={`grid gap-2 ${summary.avgMarginPercent !== null ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <StatTile label={t('productCount')}>
          {summary.productCount}{' '}
          <span className="text-muted-foreground text-xs font-semibold">
            {t('itemsUnit', { count: summary.productCount })}
          </span>
        </StatTile>
        <StatTile label={t('totalStock')}>{trimQuantity(summary.totalStock)}</StatTile>
        {summary.avgMarginPercent !== null && (
          <StatTile label={t('avgMargin')}>{summary.avgMarginPercent}%</StatTile>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <SectionHeading>{t('productsInCategory')}</SectionHeading>
        {summary.products.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('noProducts')}</p>
        ) : (
          <ul className="bg-card divide-border divide-y overflow-hidden rounded-xl border">
            {summary.products.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/${locale}/products/${p.id}`}
                  className="grid min-h-14 grid-cols-[1fr_auto] items-center gap-3 px-4 py-3"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-base font-semibold">{p.name}</span>
                    {p.gtin && <span className="text-muted-foreground truncate font-mono text-xs">{p.gtin}</span>}
                  </span>
                  <span className="text-muted-foreground text-sm font-medium tabular-nums">
                    {t('inStock', { quantity: `${trimQuantity(p.quantity)} ${p.unit}` })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
