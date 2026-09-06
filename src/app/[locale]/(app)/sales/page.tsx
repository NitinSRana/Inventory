import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { Receipt } from 'lucide-react';

import { DataList, DataRow, PageTitle } from '@/components/data-list';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { requireOrg } from '@/server/auth/session';
import { listSales } from '@/server/pos/checkout';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

/**
 * Recent sales, so a mis-rung sale can be found and voided without SQL.
 *
 * Staff-readable: finding a sale is the everyday need. Voiding it is gated
 * separately, one screen in, at manager level.
 */
export default async function SalesPage({ params }: PageProps<'/[locale]/sales'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('sales');
  const format = await getFormatter();
  const { orgId } = await requireOrg(locale);

  const [org] = await withTenant(orgId, (tx) => tx.select().from(organizations));
  const money = (v: string) => format.number(Number(v), { style: 'currency', currency: org.currencyCode });
  const sales = await listSales(orgId);

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 pb-24">
      <PageTitle>{t('title')}</PageTitle>

      {sales.length === 0 ? (
        <EmptyState icon={Receipt} title={t('empty')} body={t('emptyBody')} />
      ) : (
        <>
          {/* Stacked rows on a phone, a table once there is width for one —
              the same split Products already makes. Four facts per sale sit
              800px apart in a two-column row on a desktop; in columns they
              line up and can be read down. */}
          <div className="md:hidden">
            <DataList>
              {sales.map((s) => (
                <DataRow
                  key={s.id}
                  href={`/${locale}/sales/${s.id}`}
                  title={s.saleNumber}
                  subtitle={
                    <>
                      {format.dateTime(new Date(s.occurredAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}{' '}
                      · {t(`tenderTypes.${s.tenderType}`)}
                      {s.status === 'voided' && (
                        <>
                          {' '}
                          <Badge variant="destructive">{t('voided')}</Badge>
                        </>
                      )}
                    </>
                  }
                  value={money(s.total)}
                />
              ))}
            </DataList>
          </div>

          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('saleNumber')}</TableHead>
                  <TableHead>{t('date')}</TableHead>
                  <TableHead>{t('tender')}</TableHead>
                  <TableHead className="text-right">{t('total')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link href={`/${locale}/sales/${s.id}`} className="hover:underline">
                        {s.saleNumber}
                      </Link>
                      {/* Voided is a word and a colour, never colour alone. */}
                      {s.status === 'voided' && (
                        <Badge variant="destructive" className="ml-2">
                          {t('voided')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format.dateTime(new Date(s.occurredAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </TableCell>
                    <TableCell>{t(`tenderTypes.${s.tenderType}`)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(s.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </main>
  );
}
