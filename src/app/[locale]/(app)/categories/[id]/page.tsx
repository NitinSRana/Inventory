import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';

import { BackLink } from '@/components/back-link';
import { CategoryForm, categoryInputFrom } from '@/components/category-form';
import { DataList, DataRow, PageTitle, SectionHeading } from '@/components/data-list';
import { Button } from '@/components/ui/button';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { trimQuantity } from '@/lib/quantity';
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

export default async function EditCategoryPage({
  params,
  searchParams,
}: PageProps<'/[locale]/categories/[id]'>) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const { error } = await searchParams;
  const t = await getTranslations('categories');
  const tBack = await getTranslations('back');
  const format = await getFormatter();
  const { orgId } = await requireRole(locale, 'manager');

  // RLS scopes this, so another tenant's id is indistinguishable from a missing one.
  const category = await getCategory(orgId, id);
  if (!category) notFound();
  const [productCount, summary, [org]] = await Promise.all([
    countProductsInCategory(orgId, id),
    getCategorySummary(orgId, id),
    withTenant(orgId, (tx) => tx.select().from(organizations)),
  ]);
  const money = (v: string | null) =>
    v === null ? '—' : format.number(Number(v), { style: 'currency', currency: org.currencyCode });

  async function save(formData: FormData) {
    'use server';
    const { orgId } = await requireRole(locale, 'manager');
    try {
      await updateCategory(orgId, id, categoryInputFrom(formData));
    } catch {
      redirect(`/${locale}/categories/${id}?error=1`);
    }
    redirect(`/${locale}/categories`);
  }

  async function remove() {
    'use server';
    const { orgId } = await requireRole(locale, 'manager');
    await deleteCategory(orgId, id);
    redirect(`/${locale}/categories`);
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-4">
      <BackLink href={`/${locale}/categories`} label={tBack('categories')} />
      <PageTitle>{category.name}</PageTitle>

      <CategoryForm
        action={save}
        defaults={category}
        error={typeof error === 'string' ? error : undefined}
      />

      {summary.productCount > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeading>{t('productsInCategory')}</SectionHeading>
          <div className="flex flex-wrap gap-6">
            <div className="flex flex-col gap-0.5">
              <p className="text-muted-foreground text-xs">{t('productCount')}</p>
              <p className="text-xl font-semibold tabular-nums">{summary.productCount}</p>
            </div>
            <div className="flex flex-col gap-0.5">
              <p className="text-muted-foreground text-xs">{t('totalStock')}</p>
              <p className="text-xl font-semibold tabular-nums">{trimQuantity(summary.totalStock)}</p>
            </div>
            {summary.avgMarginPercent !== null && (
              <div className="flex flex-col gap-0.5">
                <p className="text-muted-foreground text-xs">{t('avgMargin')}</p>
                <p className="text-xl font-semibold tabular-nums">{summary.avgMarginPercent}%</p>
              </div>
            )}
          </div>
          <DataList>
            {summary.products.map((p) => (
              <DataRow
                key={p.id}
                href={`/${locale}/products/${p.id}`}
                title={p.name}
                subtitle={
                  <>
                    {trimQuantity(p.quantity)} <span className="opacity-70">{p.unit}</span>
                  </>
                }
                value={money(p.sellPrice)}
              />
            ))}
          </DataList>
        </section>
      )}

      {/* Hard delete, not deactivate: nothing in the ledger references a
          category, and products.category_id is on delete set null — a deleted
          category just leaves its products uncategorised. */}
      <form action={remove} className="flex flex-col gap-2">
        {productCount > 0 && (
          <p className="text-muted-foreground text-sm">
            {t('deleteWarning', { count: productCount })}
          </p>
        )}
        <Button type="submit" variant="outline" className="h-11 w-fit">
          {t('delete')}
        </Button>
      </form>
    </main>
  );
}
