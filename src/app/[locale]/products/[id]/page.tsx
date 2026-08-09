import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';

import { ProductForm, productInputFrom } from '@/components/product-form';
import { Button } from '@/components/ui/button';
import { requireOrg } from '@/server/auth/session';
import { InvalidBarcodeError, deactivateProduct, getProduct, updateProduct } from '@/server/catalog/products';
import { listSuppliers } from '@/server/catalog/suppliers';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function EditProductPage({
  params,
  searchParams,
}: PageProps<'/[locale]/products/[id]'>) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const { error } = await searchParams;
  const t = await getTranslations('products');
  const { orgId } = await requireOrg(locale);

  // RLS scopes this, so another tenant's id is indistinguishable from a missing one.
  const product = await getProduct(orgId, id);
  if (!product) notFound();

  const suppliers = await listSuppliers(orgId);

  async function save(formData: FormData) {
    'use server';
    const { orgId } = await requireOrg(locale);
    try {
      await updateProduct(orgId, id, productInputFrom(formData));
    } catch (e) {
      redirect(
        `/${locale}/products/${id}?error=${e instanceof InvalidBarcodeError ? 'barcode' : 'unknown'}`,
      );
    }
    redirect(`/${locale}/products`);
  }

  async function deactivate() {
    'use server';
    const { orgId } = await requireOrg(locale);
    await deactivateProduct(orgId, id);
    redirect(`/${locale}/products`);
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-24">
      <h1 className="text-2xl font-semibold">{product.name}</h1>

      <ProductForm
        action={save}
        suppliers={suppliers}
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
