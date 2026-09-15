import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { FilePen } from 'lucide-react';

import { BackLink } from '@/components/back-link';
import { PageTitle, SectionHeading } from '@/components/data-list';
import { SupplierForm, supplierInputFrom } from '@/components/supplier-form';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { trimQuantity } from '@/lib/quantity';
import { one } from '@/lib/search-params';
import { requireRole } from '@/server/auth/session';
import { stockStatus } from '@/server/catalog/stock-status';
import { deactivateSupplier, getSupplier, getSupplierProducts, updateSupplier } from '@/server/catalog/suppliers';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

/** ISO weekdays: 1 = Monday .. 7 = Sunday, matching suppliers.delivery_weekdays. */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * Laid out as the supplier-detail frame: a contact card (who, email, phone,
 * lead time, minimum order, delivery schedule), then what they supply with
 * stock and status, and Deactivate. Edit profile (`?edit=1`) opens the form.
 *
 * Products below their minimum still sort first and are counted in a sentence:
 * the reason someone opens a supplier is usually that they are about to phone
 * them. That stays a read — no suggested quantities (CLAUDE.md).
 */
export default async function SupplierPage({ params, searchParams }: PageProps<'/[locale]/suppliers/[id]'>) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const sp = await searchParams;
  const editing = one(sp.edit) === '1';
  const t = await getTranslations('suppliers');
  const tProducts = await getTranslations('products');
  const tBack = await getTranslations('back');
  const format = await getFormatter();
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
      redirect(`/${locale}/suppliers/${id}?edit=1&error=1`);
    }
    redirect(`/${locale}/suppliers/${id}`);
  }

  async function deactivate() {
    'use server';
    const { orgId } = await requireRole(locale, 'manager');
    await deactivateSupplier(orgId, id);
    redirect(`/${locale}/suppliers`);
  }

  if (editing) {
    return (
      <main className="flex flex-1 flex-col gap-6 p-4">
        <BackLink href={`/${locale}/suppliers/${id}`} label={supplier.name} />
        <PageTitle caption={supplier.name}>{t('editTitle')}</PageTitle>
        <SupplierForm action={save} defaults={supplier} error={one(sp.error)} />
      </main>
    );
  }

  const [products, [org]] = await Promise.all([
    getSupplierProducts(orgId, id),
    withTenant(orgId, (tx) => tx.select().from(organizations)),
  ]);
  const money = (v: string | null) =>
    v === null ? '—' : format.number(Number(v), { style: 'currency', currency: org.currencyCode });
  const short = products.filter((p) => p.belowMinimum);
  const days = new Set(supplier.deliveryWeekdays);

  return (
    <main className="flex flex-1 flex-col gap-5 p-4 md:max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <BackLink href={`/${locale}/suppliers`} label={tBack('suppliers')} />
        <Link
          href={`/${locale}/suppliers/${id}?edit=1`}
          className={buttonVariants({ variant: 'ghost', className: 'text-muted-foreground h-11 gap-1.5' })}
        >
          <FilePen aria-hidden className="size-4" />
          {t('editProfile')}
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <PageTitle>{supplier.name}</PageTitle>
        {!supplier.isActive && <Badge variant="secondary">{t('inactive')}</Badge>}
      </div>

      <section className="bg-card flex flex-col gap-4 rounded-xl border p-4">
        <div className="flex flex-col gap-0.5">
          <SectionHeading>{t('mainContact')}</SectionHeading>
          <span className="text-base font-bold">{supplier.contactName ?? '—'}</span>
        </div>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs font-medium tracking-wider uppercase">{t('email')}</dt>
            <dd className="truncate">
              {supplier.email ? (
                <a href={`mailto:${supplier.email}`} className="text-link inline-flex min-h-11 items-center">
                  {supplier.email}
                </a>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs font-medium tracking-wider uppercase">{t('phone')}</dt>
            <dd>
              {supplier.phone ? (
                <a href={`tel:${supplier.phone}`} className="inline-flex min-h-11 items-center font-semibold tabular-nums">
                  {supplier.phone}
                </a>
              ) : (
                '—'
              )}
            </dd>
          </div>
        </dl>
        <dl className="grid grid-cols-2 gap-4 border-t pt-4 text-sm">
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs font-medium tracking-wider uppercase">{t('leadTimeLabel')}</dt>
            <dd className="text-base font-bold">{t('leadTimeShort', { days: supplier.leadTimeDays })}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs font-medium tracking-wider uppercase">{t('minOrderLabel')}</dt>
            <dd className="text-base font-bold tabular-nums">{money(supplier.minOrderValue)}</dd>
          </div>
        </dl>
        <div className="flex flex-col gap-2">
          <SectionHeading>{t('deliverySchedule')}</SectionHeading>
          {/* Filled chips, and the list of day names for a screen reader — the
              fill alone would be the only thing saying which days. */}
          <ul className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((d) => (
              <li
                key={d}
                className={`rounded-md border py-1 text-center text-xs font-semibold ${
                  days.has(d) ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground'
                }`}
              >
                <span aria-hidden>{t(`weekdays.${d}`)}</span>
                <span className="sr-only">
                  {t(`weekdays.${d}`)} {days.has(d) ? '✓' : '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-bold">{t('suppliedProducts', { count: products.length })}</h2>
        {/* A sentence, not a hue on the heading: this is the line that says what
            to ask for on the phone. */}
        {short.length > 0 && (
          <p className="text-muted-foreground text-sm tabular-nums">{t('belowMinimumCount', { count: short.length })}</p>
        )}
        {products.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('noProductsYet')}</p>
        ) : (
          <ul className="bg-card divide-border divide-y overflow-hidden rounded-xl border">
            {products.map((p) => {
              const s = stockStatus(p.quantity, p.minStock);
              return (
                <li key={p.id}>
                  <Link
                    href={`/${locale}/products/${p.id}`}
                    className="grid min-h-14 grid-cols-[1fr_auto] items-center gap-3 px-4 py-3"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-base font-semibold">{p.name}</span>
                      <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
                        {(p.sku ?? p.gtin) && <span className="font-mono">{p.sku ?? p.gtin}</span>}
                        {(p.sku ?? p.gtin) && <span aria-hidden>•</span>}
                        <span>{t('priceLine', { price: money(p.sellPrice) })}</span>
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <span className="text-base font-bold tabular-nums">
                        {trimQuantity(p.quantity)} <span className="text-xs font-normal opacity-70">{p.unit}</span>
                      </span>
                      {s === 'in' ? (
                        <span className="text-muted-foreground text-xs">{tProducts('stockStatuses.in')}</span>
                      ) : (
                        <Badge variant={s === 'out' ? 'destructive' : 'outline'}>
                          {tProducts(`stockStatuses.${s}`)}
                        </Badge>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Deactivate, not delete — products and the ledger still reference it. */}
      {supplier.isActive && (
        <form action={deactivate}>
          <Button type="submit" variant="ghost" className="text-destructive h-11 w-full sm:w-fit">
            {t('deactivate')}
          </Button>
        </form>
      )}
    </main>
  );
}
