import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { Receipt } from 'lucide-react';

import { DataList, DataRow, PageTitle } from '@/components/data-list';
import { EmptyState } from '@/components/empty-state';
import { Field, FieldRow, NativeSelect } from '@/components/form';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SALE_STATUSES, TENDER_TYPES, organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { LIST_LIMITS, dateParam, limitFrom, one, pick } from '@/lib/search-params';
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
export default async function SalesPage({ params, searchParams }: PageProps<'/[locale]/sales'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('sales');
  const format = await getFormatter();
  const { orgId } = await requireOrg(locale);

  // Filter state lives in the URL: a filtered view is a link, survives a
  // refresh, and the back button behaves. Every value is whitelisted before it
  // reaches a where clause.
  const sp = await searchParams;
  const filters = {
    from: dateParam(sp.from),
    to: dateParam(sp.to),
    tenderType: pick(sp.tender, TENDER_TYPES),
    status: pick(sp.status, SALE_STATUSES),
    search: one(sp.q),
    limit: limitFrom(sp.limit),
  };
  const filtered = Boolean(
    filters.from || filters.to || filters.tenderType || filters.status || filters.search,
  );

  const [org] = await withTenant(orgId, (tx) => tx.select().from(organizations));
  const money = (v: string) => format.number(Number(v), { style: 'currency', currency: org.currencyCode });
  const sales = await listSales(orgId, filters);

  // A "show more" link that keeps every filter and only raises the ceiling.
  const nextLimit = LIST_LIMITS[LIST_LIMITS.indexOf(filters.limit) + 1];
  const withLimit = (limit: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      const single = one(v);
      if (single && k !== 'limit') next.set(k, single);
    }
    next.set('limit', String(limit));
    return `/${locale}/sales?${next}`;
  };

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 pb-24">
      <PageTitle>{t('title')}</PageTitle>

      {/* GET form, so the filters end up in the URL rather than in state. */}
      <form className="flex flex-col gap-3 md:max-w-3xl">
        <FieldRow>
          <Field name="from" label={t('from')}>
            <Input id="from" name="from" type="date" defaultValue={filters.from ?? ''} className="h-11" />
          </Field>
          <Field name="to" label={t('to')}>
            <Input id="to" name="to" type="date" defaultValue={filters.to ?? ''} className="h-11" />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field name="tender" label={t('tender')}>
            <NativeSelect id="tender" name="tender" defaultValue={filters.tenderType ?? ''} className="h-11">
              <option value="">{t('anyTender')}</option>
              {TENDER_TYPES.map((tt) => (
                <option key={tt} value={tt}>
                  {t(`tenderTypes.${tt}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field name="status" label={t('status')}>
            <NativeSelect id="status" name="status" defaultValue={filters.status ?? ''} className="h-11">
              <option value="">{t('anyStatus')}</option>
              {SALE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`statuses.${s}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </FieldRow>
        <Field name="q" label={t('saleNumber')}>
          <Input id="q" name="q" defaultValue={filters.search ?? ''} className="h-11 font-mono" />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" variant="outline" className="h-11 w-fit">
            {t('applyFilters')}
          </Button>
          {filtered && (
            <Link href={`/${locale}/sales`} className={buttonVariants({ variant: 'ghost', className: 'h-11' })}>
              {t('clearFilters')}
            </Link>
          )}
        </div>
      </form>

      {sales.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={filtered ? t('noMatches') : t('empty')}
          body={filtered ? t('noMatchesBody') : t('emptyBody')}
        />
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

          {/* Raise the ceiling rather than page. There is no offset to fall out
              of step with a list that is still being added to at the till, no
              count query, and the back button lands on the rows it left. */}
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground text-sm tabular-nums">
              {t('showing', { count: sales.length })}
            </span>
            {sales.length === filters.limit && nextLimit && (
              <Link
                href={withLimit(nextLimit)}
                className={buttonVariants({ variant: 'outline', className: 'h-11' })}
              >
                {t('showMore', { count: nextLimit })}
              </Link>
            )}
          </div>
        </>
      )}
    </main>
  );
}
