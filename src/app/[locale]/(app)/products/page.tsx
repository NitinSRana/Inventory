import { Fragment } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { PackageOpen, SearchX } from 'lucide-react';

import { DataGroupHeader, DataList, DataRow, PageTitle } from '@/components/data-list';
import { EmptyState } from '@/components/empty-state';
import { StickyAction } from '@/components/form';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { countProducts } from '@/server/catalog/import';
import { listProducts } from '@/server/catalog/products';
import { requireOrg } from '@/server/auth/session';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function ProductsPage({ params, searchParams }: PageProps<'/[locale]/products'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { q } = await searchParams;
  const search = typeof q === 'string' ? q : undefined;

  const t = await getTranslations('products');
  const { orgId } = await requireOrg(locale);
  const [rows, total] = await Promise.all([
    listProducts(orgId, { search }),
    countProducts(orgId),
  ]);

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 pb-24">
      <PageTitle caption={!search && total > 0 ? t('shownOfTotal', { shown: rows.length, total }) : undefined}>
        {t('title')}
      </PageTitle>

      {/* GET form so the search term lives in the URL, not in component state. */}
      <form role="search" className="flex flex-col gap-2">
        <label htmlFor="q" className="sr-only">
          {t('searchLabel')}
        </label>
        <Input
          id="q"
          name="q"
          type="search"
          defaultValue={search ?? ''}
          placeholder={t('searchLabel')}
          className="h-11"
        />
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
          <div className="sm:hidden">
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
                        title={p.name}
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

          <Table className="hidden sm:table">
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
