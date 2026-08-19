import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { BackLink } from '@/components/back-link';
import { ProductForm, productInputFrom } from '@/components/product-form';
import { requireRole } from '@/server/auth/session';
import { listCategories } from '@/server/catalog/categories';
import { InvalidBarcodeError, createProduct } from '@/server/catalog/products';
import { listSuppliers } from '@/server/catalog/suppliers';
import { getVatRates } from '@/server/settings/vat';
import { PageTitle } from '@/components/data-list';

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
  const [suppliers, categories, vatBands] = await Promise.all([
    listSuppliers(orgId),
    listCategories(orgId),
    getVatRates(orgId),
  ]);

  async function create(formData: FormData) {
    'use server';
    const { orgId } = await requireRole(locale, 'manager');
    try {
      await createProduct(orgId, productInputFrom(formData));
    } catch (e) {
      const error =
        e instanceof InvalidBarcodeError
          ? e.field === 'caseGtin'
            ? 'caseBarcode'
            : 'barcode'
          : 'unknown';
      redirect(`/${locale}/products/new?error=${error}`);
    }
    redirect(`/${locale}/products`);
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-24">
      <BackLink href={`/${locale}/products`} label={tBack('products')} />
      <PageTitle>{t('addTitle')}</PageTitle>
      <ProductForm
        action={create}
        suppliers={suppliers}
        categories={categories}
        vatBands={vatBands}
        error={typeof error === 'string' ? error : undefined}
      />
    </main>
  );
}
