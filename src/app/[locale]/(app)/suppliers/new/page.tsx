import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { BackLink } from '@/components/back-link';
import { SupplierForm, supplierInputFrom } from '@/components/supplier-form';
import { requireRole } from '@/server/auth/session';
import { createSupplier } from '@/server/catalog/suppliers';
import { PageTitle } from '@/components/data-list';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function NewSupplierPage({
  params,
  searchParams,
}: PageProps<'/[locale]/suppliers/new'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { error, next } = await searchParams;
  const t = await getTranslations('suppliers');
  const tBack = await getTranslations('back');
  await requireRole(locale, 'manager');

  async function create(formData: FormData) {
    'use server';
    const { orgId } = await requireRole(locale, 'manager');
    try {
      await createSupplier(orgId, supplierInputFrom(formData));
    } catch {
      redirect(`/${locale}/suppliers/new?error=1`);
    }
    // Honour where the user came from: CSV import sends people here mid-task,
    // and dumping them on the supplier list would lose their place.
    redirect(typeof next === 'string' ? next : `/${locale}/suppliers`);
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-4">
      <BackLink href={`/${locale}/suppliers`} label={tBack('suppliers')} />
      <PageTitle>{t('addTitle')}</PageTitle>
      <SupplierForm action={create} error={typeof error === 'string' ? error : undefined} />
    </main>
  );
}
