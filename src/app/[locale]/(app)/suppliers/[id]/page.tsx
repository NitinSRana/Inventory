import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';

import { SupplierForm, supplierInputFrom } from '@/components/supplier-form';
import { BackLink } from '@/components/back-link';
import { Button } from '@/components/ui/button';
import { requireRole } from '@/server/auth/session';
import { deactivateSupplier, getSupplier, updateSupplier } from '@/server/catalog/suppliers';
import { PageTitle } from '@/components/data-list';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function EditSupplierPage({
  params,
  searchParams,
}: PageProps<'/[locale]/suppliers/[id]'>) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const { error } = await searchParams;
  const t = await getTranslations('suppliers');
  const tBack = await getTranslations('back');
  const { orgId } = await requireRole(locale, 'manager');

  // RLS scopes this, so another tenant's id is indistinguishable from a missing one.
  const supplier = await getSupplier(orgId, id);
  if (!supplier) notFound();

  async function save(formData: FormData) {
    'use server';
    const { orgId } = await requireRole(locale, 'manager');
    try {
      await updateSupplier(orgId, id, supplierInputFrom(formData));
    } catch {
      redirect(`/${locale}/suppliers/${id}?error=1`);
    }
    redirect(`/${locale}/suppliers`);
  }

  async function deactivate() {
    'use server';
    const { orgId } = await requireRole(locale, 'manager');
    await deactivateSupplier(orgId, id);
    redirect(`/${locale}/suppliers`);
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-4">
      <BackLink href={`/${locale}/suppliers`} label={tBack('suppliers')} />
      <PageTitle>{supplier.name}</PageTitle>

      <SupplierForm
        action={save}
        defaults={supplier}
        error={typeof error === 'string' ? error : undefined}
      />

      {/* Deactivate, not delete — products and purchase orders still reference it. */}
      <form action={deactivate}>
        <Button type="submit" variant="outline" className="h-11">
          {t('deactivate')}
        </Button>
      </form>
    </main>
  );
}
