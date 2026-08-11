import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { BackLink } from '@/components/back-link';
import { ProductForm, productInputFrom } from '@/components/product-form';
import { requireRole } from '@/server/auth/session';
import { InvalidBarcodeError, createProduct } from '@/server/catalog/products';
import { listSuppliers } from '@/server/catalog/suppliers';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function NewProductPage({
  params,
  searchParams,
}: PageProps<'/[locale]/products/new'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { error } = await searchParams;
  const t = await getTranslations('products');
  const tBack = await getTranslations('back');
  const { orgId } = await requireRole(locale, 'manager');
  const suppliers = await listSuppliers(orgId);

  async function create(formData: FormData) {
    'use server';
    const { orgId } = await requireRole(locale, 'manager');
    try {
      await createProduct(orgId, productInputFrom(formData));
    } catch (e) {
      redirect(
        `/${locale}/products/new?error=${e instanceof InvalidBarcodeError ? 'barcode' : 'unknown'}`,
      );
    }
    redirect(`/${locale}/products`);
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-24">
      <BackLink href={`/${locale}/products`} label={tBack('products')} />
      <h1 className="text-2xl font-semibold">{t('addTitle')}</h1>
      <ProductForm
        action={create}
        suppliers={suppliers}
        error={typeof error === 'string' ? error : undefined}
      />
    </main>
  );
}
