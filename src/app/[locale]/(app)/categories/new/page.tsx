import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { BackLink } from '@/components/back-link';
import { CategoryForm, categoryInputFrom } from '@/components/category-form';
import { PageTitle } from '@/components/data-list';
import { requireRole } from '@/server/auth/session';
import { createCategory } from '@/server/catalog/categories';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function NewCategoryPage({
  params,
  searchParams,
}: PageProps<'/[locale]/categories/new'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { error } = await searchParams;
  const t = await getTranslations('categories');
  const tBack = await getTranslations('back');
  await requireRole(locale, 'manager');

  async function create(formData: FormData) {
    'use server';
    const { orgId } = await requireRole(locale, 'manager');
    try {
      await createCategory(orgId, categoryInputFrom(formData));
    } catch {
      redirect(`/${locale}/categories/new?error=1`);
    }
    redirect(`/${locale}/categories`);
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-4">
      <BackLink href={`/${locale}/categories`} label={tBack('categories')} />
      <PageTitle>{t('addTitle')}</PageTitle>
      <CategoryForm action={create} error={typeof error === 'string' ? error : undefined} />
    </main>
  );
}
