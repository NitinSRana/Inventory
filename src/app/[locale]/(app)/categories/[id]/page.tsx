import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';

import { BackLink } from '@/components/back-link';
import { CategoryForm, categoryInputFrom } from '@/components/category-form';
import { PageTitle } from '@/components/data-list';
import { Button } from '@/components/ui/button';
import { requireRole } from '@/server/auth/session';
import {
  countProductsInCategory,
  deleteCategory,
  getCategory,
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
  const { orgId } = await requireRole(locale, 'manager');

  // RLS scopes this, so another tenant's id is indistinguishable from a missing one.
  const category = await getCategory(orgId, id);
  if (!category) notFound();
  const productCount = await countProductsInCategory(orgId, id);

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
