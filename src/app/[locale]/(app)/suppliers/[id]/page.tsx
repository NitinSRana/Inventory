import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';

import { SupplierForm, supplierInputFrom } from '@/components/supplier-form';
import { BackLink } from '@/components/back-link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { trimQuantity } from '@/lib/quantity';
import { requireRole } from '@/server/auth/session';
import {
  deactivateSupplier,
  getSupplier,
  getSupplierProducts,
  updateSupplier,
} from '@/server/catalog/suppliers';
import { DataList, DataRow, PageTitle, SectionHeading } from '@/components/data-list';

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
  const format = await getFormatter();
  const { orgId } = await requireRole(locale, 'manager');

  // RLS scopes this, so another tenant's id is indistinguishable from a missing one.
  const supplier = await getSupplier(orgId, id);
  if (!supplier) notFound();
  const [products, [org]] = await Promise.all([
    getSupplierProducts(orgId, id),
    withTenant(orgId, (tx) => tx.select().from(organizations)),
  ]);
  const money = (v: string | null) =>
    v === null ? '—' : format.number(Number(v), { style: 'currency', currency: org.currencyCode });
  const short = products.filter((p) => p.belowMinimum);

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

      {products.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeading>{t('productsFromSupplier')}</SectionHeading>
          {/* A sentence, not a hue on the heading: the reason to open a
              supplier is usually that you are about to phone them, and this is
              the line that says what to ask for. */}
          {short.length > 0 && (
            <p className="text-muted-foreground text-sm tabular-nums">
              {t('belowMinimumCount', { count: short.length })}
            </p>
          )}
          <DataList>
            {products.map((p) => (
              <DataRow
                key={p.id}
                href={`/${locale}/products/${p.id}`}
                title={p.name}
                subtitle={
                  p.belowMinimum ? (
                    // Labelled as well as coloured — this app's whole signal is
                    // red/green and a good share of staff cannot tell them apart.
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge variant="destructive">{t('belowMinimum')}</Badge>
                      {p.categoryName}
                    </span>
                  ) : (
                    (p.categoryName ?? undefined)
                  )
                }
                value={money(p.sellPrice)}
                meta={
                  <>
                    {trimQuantity(p.quantity)} <span className="opacity-70">{p.unit}</span>
                  </>
                }
              />
            ))}
          </DataList>
        </section>
      )}

      {/* Deactivate, not delete — products and purchase orders still reference it. */}
      <form action={deactivate}>
        <Button type="submit" variant="outline" className="h-11">
          {t('deactivate')}
        </Button>
      </form>
    </main>
  );
}
