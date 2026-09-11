import { Fragment } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { PackageOpen, SearchX } from 'lucide-react';

import { DataGroupHeader, DataList, DataRow, PageTitle } from '@/components/data-list';
import { EmptyState } from '@/components/empty-state';
import { Field, FieldRow, NativeSelect, StickyAction } from '@/components/form';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LIST_LIMITS, limitFrom, one, pick } from '@/lib/search-params';
import { countProducts } from '@/server/catalog/import';
import { listCategories } from '@/server/catalog/categories';
import { listProducts } from '@/server/catalog/products';
import { listSuppliers } from '@/server/catalog/suppliers';
import { requireOrg } from '@/server/auth/session';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function ProductsPage({ params, searchParams }: PageProps<'/[locale]/products'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const sp = await searchParams;
  const t = await getTranslations('products');
  const { orgId } = await requireOrg(locale);

  const [categories, suppliers] = await Promise.all([
    listCategories(orgId),
    listSuppliers(orgId),
  ]);

  const search = one(sp.q);
  const filters = {
    search,
    // Only accept an id the shop actually owns — an unknown uuid then filters
    // to nothing rather than reaching a where clause on trust.
    categoryId: pick(sp.category, categories.map((c) => c.id)),
    supplierId: pick(sp.supplier, suppliers.map((s) => s.id)),
    needsAttention: one(sp.needs) === '1',
    includeInactive: one(sp.inactive) === '1',
    limit: limitFrom(sp.limit),
  };
  const filtered = Boolean(
    filters.search ||
      filters.categoryId ||
      filters.supplierId ||
      filters.needsAttention ||
      filters.includeInactive,
  );

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

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 pb-24">
      {/* The count is only true of the whole catalogue, so it goes away as soon
          as any filter narrows what is on screen — otherwise it reads as "43 of
          2,051" while showing one category. */}
      <PageTitle
        caption={!filtered && total > 0 ? t('shownOfTotal', { shown: rows.length, total }) : undefined}
      >
        {t('title')}
      </PageTitle>

      {/* GET form so the filters live in the URL, not in component state. */}
      <form role="search" className="flex flex-col gap-3 md:max-w-3xl">
        <Field name="q" label={t('searchLabel')}>
          <Input id="q" name="q" type="search" defaultValue={search ?? ''} className="h-11" />
        </Field>

        <FieldRow>
          <Field name="category" label={t('category')}>
            <NativeSelect id="category" name="category" defaultValue={filters.categoryId ?? ''} className="h-11">
              <option value="">{t('anyCategory')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field name="supplier" label={t('supplier')}>
            <NativeSelect id="supplier" name="supplier" defaultValue={filters.supplierId ?? ''} className="h-11">
              <option value="">{t('anySupplier')}</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </FieldRow>

        <div className="flex flex-col gap-2">
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
        <EmptyState
          icon={search ? SearchX : PackageOpen}
          title={search ? t('noMatches') : t('empty')}
          body={search ? t('noMatchesBody') : t('emptyBody')}
          // An empty catalogue is the onboarding moment: offer the bulk path,
          // not just the one-at-a-time form.
          action={
            !search && (
              <Link
                href={`/${locale}/products/import`}
                className={buttonVariants({ variant: 'outline', className: 'h-11' })}
              >
                {t('import')}
              </Link>
            )
          }
        />
      ) : (
        <>
          {/* Divided rows on a phone, table on desktop — never a table that scrolls sideways.
              Sticky letter headers, since rows already arrive name-sorted: a 1,994-row
              catalogue is only navigable without a visible scrollbar if the reader always
              knows which letter they're in. */}
          <div className="md:hidden">
            <DataList>
              {(() => {
                let lastLetter = '';
                return rows.map((p) => {
                  const letter = /[a-z]/i.test(p.name[0] ?? '') ? p.name[0].toUpperCase() : '#';
                  const isNewGroup = letter !== lastLetter;
                  lastLetter = letter;
                  return (
                    <Fragment key={p.id}>
                      {isNewGroup && <DataGroupHeader>{letter}</DataGroupHeader>}
                      <DataRow
                        href={`/${locale}/products/${p.id}`}
                        title={
                          <>
                            {p.name}
                            {/* Only ever on screen when the inactive filter is
                                on, but an inactive row must never be mistaken
                                for a live one. */}
                            {!p.isActive && (
                              <Badge variant="secondary" className="ml-2">
                                {t('inactive')}
                              </Badge>
                            )}
                          </>
                        }
                        subtitle={<span className="font-mono">{p.gtin ?? t('noBarcode')}</span>}
                        value={p.sellPrice ?? '—'}
                        meta={p.unit}
                      />
                    </Fragment>
                  );
                });
              })()}
            </DataList>
          </div>

          {/* md, not sm: the bottom tab bar hides at md, so switching earlier
              put a desktop table on screen next to the phone nav. */}
          <Table className="hidden md:table">
            <TableHeader>
              <TableRow>
                <TableHead>{t('name')}</TableHead>
                <TableHead>{t('barcode')}</TableHead>
                <TableHead className="text-right">{t('cost')}</TableHead>
                <TableHead className="text-right">{t('price')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    {!p.isActive && (
                      <Badge variant="secondary" className="mr-2">
                        {t('inactive')}
                      </Badge>
                    )}
                    <Link href={`/${locale}/products/${p.id}`} className="hover:underline">
                      {p.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{p.gtin ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.costPrice ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.sellPrice ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Raise the ceiling rather than page — see the sales list. */}
          {rows.length === filters.limit && nextLimit && (
            <Link
              href={withLimit(nextLimit)}
              className={buttonVariants({ variant: 'outline', className: 'h-11 w-fit' })}
            >
              {t('showMore', { count: nextLimit })}
            </Link>
          )}
        </>
      )}

      {/* Primary action in the bottom third, thumb-reachable. Import sits beside
          it rather than competing for the same slot. */}
      {rows.length > 0 && (
        <Link
          href={`/${locale}/products/import`}
          className={buttonVariants({ variant: 'ghost', className: 'h-11 w-fit' })}
        >
          {t('import')}
        </Link>
      )}
      <StickyAction>
        <Link
          href={`/${locale}/products/new`}
          className={buttonVariants({ className: 'h-12 w-full sm:w-fit' })}
        >
          {t('add')}
        </Link>
      </StickyAction>
    </main>
  );
}
