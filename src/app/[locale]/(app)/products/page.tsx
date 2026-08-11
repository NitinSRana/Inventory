import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
  const rows = await listProducts(orgId, { search });

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 pb-24">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>

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
        <div className="flex flex-col items-start gap-3 py-12">
          <p className="text-muted-foreground text-sm">{search ? t('noMatches') : t('empty')}</p>
          {/* An empty catalogue is the onboarding moment: offer the bulk path,
              not just the one-at-a-time form. */}
          {!search && (
            <Link
              href={`/${locale}/products/import`}
              className={buttonVariants({ variant: 'outline', className: 'h-11' })}
            >
              {t('import')}
            </Link>
          )}
        </div>
      ) : (
        <>
          {/* Stacked cards on a phone, table on desktop — never a table that scrolls sideways. */}
          <ul className="flex flex-col gap-2 sm:hidden">
            {rows.map((p) => (
              <li key={p.id} className="rounded-lg border p-3">
                <Link href={`/${locale}/products/${p.id}`} className="flex flex-col gap-1">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground font-mono text-xs">
                    {p.gtin ?? t('noBarcode')}
                  </span>
                  <span className="text-sm tabular-nums">
                    {p.sellPrice ?? '—'} <span className="opacity-70">{p.unit}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>

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
      <Link
        href={`/${locale}/products/new`}
        className={buttonVariants({ className: 'fixed inset-x-4 bottom-20 sm:bottom-6 h-12 sm:static sm:w-fit' })}
      >
        {t('add')}
      </Link>
    </main>
  );
}
