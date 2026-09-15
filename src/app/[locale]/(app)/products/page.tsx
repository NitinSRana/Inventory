import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { PackageOpen, Plus, Search, SearchX, SlidersHorizontal } from 'lucide-react';

import { PageTitle } from '@/components/data-list';
import { EmptyState } from '@/components/empty-state';
import { NativeSelect } from '@/components/form';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { trimQuantity } from '@/lib/quantity';
import { LIST_LIMITS, limitFrom, one, pick } from '@/lib/search-params';
import { requireOrg } from '@/server/auth/session';
import { listCategories } from '@/server/catalog/categories';
import { countProducts } from '@/server/catalog/import';
import { listProducts } from '@/server/catalog/products';
import { stockStatus, type StockStatus } from '@/server/catalog/stock-status';
import { listSuppliers } from '@/server/catalog/suppliers';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

/**
 * Laid out as the "Products Catalogue" phone frame and the "Products & Stock
 * Inventory" desktop frame: search, then rows with price and stock on a phone,
 * a table with SKU, category, stock, supplier, last counted and status on a
 * desk.
 *
 * Departures: the desktop frame's row checkboxes and "Bulk Actions" menu have
 * nothing behind them, so Import sits in that slot instead. Status is a word
 * first — the frame's green/amber/red chips spend colour, which this app keeps
 * for expiry; only Out of stock takes the destructive tone, as negative stock
 * does elsewhere. Supplier and the two catalogue-housekeeping filters sit under
 * "More filters" rather than being dropped.
 */
export default async function ProductsPage({ params, searchParams }: PageProps<'/[locale]/products'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const sp = await searchParams;
  const t = await getTranslations('products');
  const format = await getFormatter();
  const { orgId } = await requireOrg(locale);

  const [categories, suppliers, [org]] = await Promise.all([
    listCategories(orgId),
    listSuppliers(orgId),
    withTenant(orgId, (tx) => tx.select().from(organizations)),
  ]);

  const search = one(sp.q);
  const filters = {
    search,
    // Only accept an id the shop actually owns — an unknown uuid then filters
    // to nothing rather than reaching a where clause on trust.
    categoryId: pick(sp.category, categories.map((c) => c.id)),
    supplierId: pick(sp.supplier, suppliers.map((s) => s.id)),
    lowOrOut: one(sp.stock) === 'low',
    needsAttention: one(sp.needs) === '1',
    includeInactive: one(sp.inactive) === '1',
    limit: limitFrom(sp.limit),
  };
  const filtered = Boolean(
    filters.search ||
      filters.categoryId ||
      filters.supplierId ||
      filters.lowOrOut ||
      filters.needsAttention ||
      filters.includeInactive,
  );
  // Open the drawer when one of its own filters is on, so an active filter is
  // never hidden behind a closed summary.
  const moreOpen = Boolean(filters.supplierId || filters.needsAttention || filters.includeInactive);

  const [rows, total] = await Promise.all([listProducts(orgId, filters), countProducts(orgId)]);

  const nextLimit = LIST_LIMITS[LIST_LIMITS.indexOf(filters.limit) + 1];
  const withLimit = (limit: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      const single = one(v);
      if (single && k !== 'limit') next.set(k, single);
    }
    next.set('limit', String(limit));
    return `/${locale}/products?${next}`;
  };

  const date = (v: string | null) =>
    v ? format.dateTime(new Date(v), { day: '2-digit', month: 'short', year: 'numeric' }) : t('neverCounted');

  const status = (s: StockStatus) =>
    s === 'in' ? (
      <span className="text-muted-foreground text-xs">{t('stockStatuses.in')}</span>
    ) : (
      <Badge variant={s === 'out' ? 'destructive' : 'outline'}>{t(`stockStatuses.${s}`)}</Badge>
    );

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 pb-24 md:pb-4">
      <div className="flex items-center justify-between gap-3">
        <PageTitle caption={<span className="hidden md:inline">{t('intro')}</span>}>{t('title')}</PageTitle>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/${locale}/products/import`}
            className={buttonVariants({ variant: 'outline', className: 'h-11 max-md:hidden' })}
          >
            {t('import')}
          </Link>
          <Link href={`/${locale}/products/new`} className={buttonVariants({ className: 'h-11 gap-1.5' })}>
            <Plus aria-hidden className="size-4" />
            <span className="md:hidden">{t('addShort')}</span>
            <span className="hidden md:inline">{t('addTitle')}</span>
          </Link>
        </div>
      </div>

      {/* One bordered panel on a desk — toolbar above, table inside — and
          plain stacked pieces on a phone, as the two frames draw it. */}
      <div className="flex flex-col gap-4 md:bg-card md:gap-0 md:overflow-hidden md:rounded-xl md:border">
        {/* GET form so the filters live in the URL, not in component state. */}
        <form role="search" className="flex flex-col gap-3 md:border-b md:p-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <label htmlFor="q" className="relative flex-1">
              <span className="sr-only">{t('searchLabel')}</span>
              <Search
                aria-hidden
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2"
              />
              <Input
                id="q"
                name="q"
                type="search"
                defaultValue={search ?? ''}
                placeholder={t('searchLabel')}
                className="h-12 pl-10 md:h-11"
              />
            </label>
            <div className="grid grid-cols-2 gap-2 md:flex">
              <label htmlFor="category" className="contents">
                <span className="sr-only">{t('category')}</span>
                <NativeSelect id="category" name="category" defaultValue={filters.categoryId ?? ''} className="h-11">
                  <option value="">{t('anyCategory')}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label htmlFor="stock" className="contents">
                <span className="sr-only">{t('stockFilter')}</span>
                <NativeSelect id="stock" name="stock" defaultValue={filters.lowOrOut ? 'low' : ''} className="h-11">
                  <option value="">{t('anyStock')}</option>
                  <option value="low">{t('lowOrOut')}</option>
                </NativeSelect>
              </label>
            </div>
          </div>

          <details open={moreOpen} className="group">
            <summary className="text-link flex min-h-11 w-fit cursor-pointer items-center gap-2 text-sm font-semibold">
              <SlidersHorizontal aria-hidden className="size-4" />
              {t('moreFilters')}
            </summary>
            <div className="flex flex-col gap-2 pt-2 md:max-w-lg">
              <label htmlFor="supplier" className="flex flex-col gap-2 text-sm font-medium">
                {t('supplier')}
                <NativeSelect id="supplier" name="supplier" defaultValue={filters.supplierId ?? ''} className="h-11">
                  <option value="">{t('anySupplier')}</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              {/* min-h-11 = the 44px target the rest of the app uses. Two lines of
                  text-sm come to 42px on their own, and the whole row is the tap
                  target, so the shortfall is invisible until it is measured. */}
              <label htmlFor="needs" className="flex min-h-11 items-start gap-3 py-1">
                <input
                  id="needs"
                  name="needs"
                  type="checkbox"
                  value="1"
                  defaultChecked={filters.needsAttention}
                  className="border-input accent-primary mt-0.5 size-5 shrink-0 rounded"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{t('needsAttention')}</span>
                  <span className="text-muted-foreground text-sm">{t('needsAttentionHint')}</span>
                </span>
              </label>
              <label htmlFor="inactive" className="flex min-h-11 items-start gap-3 py-1">
                <input
                  id="inactive"
                  name="inactive"
                  type="checkbox"
                  value="1"
                  defaultChecked={filters.includeInactive}
                  className="border-input accent-primary mt-0.5 size-5 shrink-0 rounded"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{t('showInactive')}</span>
                  <span className="text-muted-foreground text-sm">{t('showInactiveHint')}</span>
                </span>
              </label>
            </div>
          </details>

          <div className="flex gap-2">
            <Button type="submit" variant="outline" className="h-11 w-fit">
              {t('applyFilters')}
            </Button>
            {filtered && (
              <Link href={`/${locale}/products`} className={buttonVariants({ variant: 'ghost', className: 'h-11' })}>
                {t('clearFilters')}
              </Link>
            )}
          </div>
        </form>

        {rows.length === 0 ? (
          <div className="md:p-4">
            <EmptyState
              icon={filtered ? SearchX : PackageOpen}
              title={filtered ? t('noMatches') : t('empty')}
              body={filtered ? t('noMatchesBody') : t('emptyBody')}
              // An empty catalogue is the onboarding moment: offer the bulk path,
              // not just the one-at-a-time form.
              action={
                !filtered && (
                  <Link
                    href={`/${locale}/products/import`}
                    className={buttonVariants({ variant: 'outline', className: 'h-11' })}
                  >
                    {t('import')}
                  </Link>
                )
              }
            />
          </div>
        ) : (
          <>
            {/* Cards on a phone, table on desktop — never a table that scrolls
                sideways. md, not sm: the bottom tab bar hides at md. */}
            <ul className="bg-card divide-border divide-y overflow-hidden rounded-xl border md:hidden">
              {rows.map((p) => {
                const s = stockStatus(p.onHand, p.minStock);
                return (
                  <li key={p.id}>
                    <Link
                      href={`/${locale}/products/${p.id}`}
                      className="grid min-h-16 grid-cols-[1fr_auto] items-center gap-3 px-4 py-3"
                    >
                      <span className="flex min-w-0 flex-col items-start gap-1">
                        <span className="w-full truncate text-base font-semibold">{p.name}</span>
                        <span className="text-muted-foreground w-full truncate font-mono text-xs">
                          {p.gtin ?? p.sku ?? t('noBarcode')}
                        </span>
                        <span className="flex flex-wrap gap-1">
                          {p.categoryName && <Badge variant="outline">{p.categoryName}</Badge>}
                          {/* Only on screen when the inactive filter is on, but
                              an inactive row must never pass for a live one. */}
                          {!p.isActive && <Badge variant="secondary">{t('inactive')}</Badge>}
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        <span className="text-base font-bold tabular-nums">
                          {p.sellPrice ? format.number(Number(p.sellPrice), { style: 'currency', currency: org.currencyCode }) : '—'}
                        </span>
                        {/* "0 in stock" beside "Out of stock" says one thing twice. */}
                        {s === 'out' ? (
                          status(s)
                        ) : (
                          <span className="text-muted-foreground text-sm font-medium tabular-nums">
                            {t('inStock', { quantity: trimQuantity(p.onHand) })}
                          </span>
                        )}
                        {s === 'low' && status(s)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>

            <Table className="hidden md:table">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>{t('name')}</TableHead>
                  <TableHead>{t('sku')}</TableHead>
                  <TableHead>{t('category')}</TableHead>
                  <TableHead className="text-right">{t('currentStock')}</TableHead>
                  <TableHead>{t('unit')}</TableHead>
                  <TableHead>{t('supplier')}</TableHead>
                  <TableHead>{t('lastCounted')}</TableHead>
                  <TableHead>{t('status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="max-w-72 truncate">
                      {!p.isActive && (
                        <Badge variant="secondary" className="mr-2">
                          {t('inactive')}
                        </Badge>
                      )}
                      <Link href={`/${locale}/products/${p.id}`} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">{p.sku ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{p.categoryName ?? '—'}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{trimQuantity(p.onHand)}</TableCell>
                    <TableCell className="text-muted-foreground">{p.unit}</TableCell>
                    <TableCell className="text-muted-foreground max-w-48 truncate">{p.supplierName ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">{date(p.lastCountedAt)}</TableCell>
                    <TableCell>{status(stockStatus(p.onHand, p.minStock))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex flex-wrap items-center justify-between gap-3 md:border-t md:px-4 md:py-3">
              <span className="text-muted-foreground text-sm tabular-nums">
                {/* The total is only true of the whole catalogue, so it goes
                    away as soon as any filter narrows what is on screen. */}
                {!filtered && t('showingOf', { shown: rows.length, total })}
              </span>
              {/* Raise the ceiling rather than page — see the sales list. */}
              {rows.length === filters.limit && nextLimit && (
                <Link
                  href={withLimit(nextLimit)}
                  className={buttonVariants({ variant: 'outline', className: 'h-11 w-fit' })}
                >
                  {t('showMore', { count: nextLimit })}
                </Link>
              )}
            </div>
          </>
        )}
      </div>

      <Link
        href={`/${locale}/products/import`}
        className={buttonVariants({ variant: 'ghost', className: 'h-11 w-fit md:hidden' })}
      >
        {t('import')}
      </Link>
    </main>
  );
}
