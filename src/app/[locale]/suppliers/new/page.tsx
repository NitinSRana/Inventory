import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { SupplierForm, supplierInputFrom } from '@/components/supplier-form';
import { requireRole } from '@/server/auth/session';
import { createSupplier } from '@/server/catalog/suppliers';

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
      <h1 className="text-2xl font-semibold">{t('addTitle')}</h1>
      <SupplierForm action={create} error={typeof error === 'string' ? error : undefined} />
    </main>
  );
}
