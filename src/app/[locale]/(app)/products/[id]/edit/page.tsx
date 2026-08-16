import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';

import { ProductForm, productInputFrom } from '@/components/product-form';
import { BackLink } from '@/components/back-link';
import { Button } from '@/components/ui/button';
import { requireRole } from '@/server/auth/session';
import { listCategories } from '@/server/catalog/categories';
import { InvalidBarcodeError, deactivateProduct, getProduct, updateProduct } from '@/server/catalog/products';
import { listSuppliers } from '@/server/catalog/suppliers';
import { PageTitle } from '@/components/data-list';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function EditProductPage({
  params,
  searchParams,
}: PageProps<'/[locale]/products/[id]/edit'>) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const { error } = await searchParams;
  const t = await getTranslations('products');
  const tBack = await getTranslations('back');
  const { orgId } = await requireRole(locale, 'manager');

  // RLS scopes this, so another tenant's id is indistinguishable from a missing one.
  const product = await getProduct(orgId, id);
  if (!product) notFound();

  const [suppliers, categories] = await Promise.all([listSuppliers(orgId), listCategories(orgId)]);

  async function save(formData: FormData) {
    'use server';
    const { orgId } = await requireRole(locale, 'manager');
    try {
      await updateProduct(orgId, id, productInputFrom(formData));
    } catch (e) {
      const error =
        e instanceof InvalidBarcodeError
          ? e.field === 'caseGtin'
            ? 'caseBarcode'
            : 'barcode'
          : 'unknown';
      redirect(`/${locale}/products/${id}/edit?error=${error}`);
    }
    redirect(`/${locale}/products/${id}`);
  }

  async function deactivate() {
    'use server';
    const { orgId } = await requireRole(locale, 'manager');
    await deactivateProduct(orgId, id);
    redirect(`/${locale}/products`);
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-24">
      <BackLink href={`/${locale}/products/${id}`} label={tBack('product')} />
      <PageTitle>{product.name}</PageTitle>

      <ProductForm
        action={save}
        suppliers={suppliers}
        categories={categories}
        defaults={product}
        error={typeof error === 'string' ? error : undefined}
      />

      {/* Deactivate, not delete — the ledger still references this product. */}
      <form action={deactivate}>
        <Button type="submit" variant="outline" className="h-11">
          {t('deactivate')}
        </Button>
      </form>
    </main>
  );
}
