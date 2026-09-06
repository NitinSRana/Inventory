import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { Truck } from 'lucide-react';

import { DataList, DataRow, PageTitle } from '@/components/data-list';
import { EmptyState } from '@/components/empty-state';
import { StickyAction } from '@/components/form';
import { buttonVariants } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireOrg } from '@/server/auth/session';
import { listSuppliers } from '@/server/catalog/suppliers';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function SuppliersPage({ params }: PageProps<'/[locale]/suppliers'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('suppliers');
  const { orgId } = await requireOrg(locale);
  const suppliers = await listSuppliers(orgId);

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 pb-24">
      <PageTitle>{t('title')}</PageTitle>

      {suppliers.length === 0 ? (
        <EmptyState icon={Truck} title={t('empty')} body={t('emptyBody')} />
      ) : (
        <>
          <div className="md:hidden">
            <DataList>
              {suppliers.map((s) => (
                <DataRow
                  key={s.id}
                  href={`/${locale}/suppliers/${s.id}`}
                  title={s.name}
                  subtitle={s.email ?? undefined}
                  meta={
                    <>
                      {t('productCountShort', { count: s.productCount })} ·{' '}
                      {t('leadTimeShort', { days: s.leadTimeDays })}
                    </>
                  }
                />
              ))}
            </DataList>
          </div>

          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('name')}</TableHead>
                  <TableHead>{t('email')}</TableHead>
                  <TableHead className="text-right">{t('productCount')}</TableHead>
                  <TableHead className="text-right">{t('leadTime')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link href={`/${locale}/suppliers/${s.id}`} className="hover:underline">
                        {s.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{s.email ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.productCount}</TableCell>
                    {/* Bare number, unit named once in the header — the column
                        then aligns and reads down, which "3 days" per row does
                        not. */}
                    <TableCell className="text-right tabular-nums">{s.leadTimeDays}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Primary action in the bottom third, thumb-reachable. */}
      <StickyAction>
        <Link
          href={`/${locale}/suppliers/new`}
          className={buttonVariants({ className: 'h-12 w-full sm:w-fit' })}
        >
          {t('add')}
        </Link>
      </StickyAction>
    </main>
  );
}
