import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { Banknote, CreditCard, Filter, Receipt, Search } from 'lucide-react';

import { PageTitle } from '@/components/data-list';
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
 *
 * Laid out as the "Sales Registry" frame: search by sale number, the rest of
 * the filters behind Filter, then one card per sale with its time, how it was
 * paid, total and status. Completed is plain text — only Voided takes a tint,
 * so the one that needs a second look is the one that stands out.
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
  const drawerFiltered = Boolean(filters.from || filters.to || filters.tenderType || filters.status);
  const filtered = drawerFiltered || Boolean(filters.search);

  const [org] = await withTenant(orgId, (tx) => tx.select().from(organizations));
  const money = (v: string) => format.number(Number(v), { style: 'currency', currency: org.currencyCode });
  const sales = await listSales(orgId, filters);
  const when = (s: (typeof sales)[number]) =>
    format.dateTime(new Date(s.occurredAt), { dateStyle: 'medium', timeStyle: 'short' });

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

  const tender = (type: (typeof TENDER_TYPES)[number]) => {
    const Icon = type === 'cash' ? Banknote : CreditCard;
    return (
      <span className="inline-flex items-center gap-1">
        <Icon aria-hidden className="size-4" />
        {t(`tenderTypes.${type}`)}
      </span>
    );
  };

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <PageTitle>{t('title')}</PageTitle>

      {/* GET form, so the filters end up in the URL rather than in state. */}
      <form role="search" className="flex flex-col gap-3 md:max-w-3xl">
        <div className="flex items-start gap-2">
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
              defaultValue={filters.search ?? ''}
              placeholder={t('searchLabel')}
              className="h-12 pl-10"
            />
          </label>
        </div>

        {/* Open by itself when one of its filters is on, so an active filter is
            never hidden behind a closed summary. */}
        <details open={drawerFiltered} className="group">
          <summary className={buttonVariants({ variant: 'outline', className: 'h-11 w-fit cursor-pointer gap-2' })}>
            <Filter aria-hidden className="size-4" />
            {t('filter')}
          </summary>
          <div className="flex flex-col gap-3 pt-3">
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
            <Button type="submit" variant="outline" className="h-11 w-fit">
              {t('applyFilters')}
            </Button>
          </div>
        </details>

        {filtered && (
          <Link href={`/${locale}/sales`} className={buttonVariants({ variant: 'ghost', className: 'h-11 w-fit' })}>
            {t('clearFilters')}
          </Link>
        )}
      </form>

      {sales.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={filtered ? t('noMatches') : t('empty')}
          body={filtered ? t('noMatchesBody') : t('emptyBody')}
        />
      ) : (
        <>
          {/* Cards on a phone, a table once there is width for one — the same
              split Products makes. */}
          <ul className="bg-card divide-border divide-y overflow-hidden rounded-xl border md:hidden">
            {sales.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/${locale}/sales/${s.id}`}
                  className="grid min-h-16 grid-cols-[1fr_auto] items-center gap-3 px-4 py-3"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-mono text-base font-bold">{s.saleNumber}</span>
                    <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-sm">
                      <span>{when(s)}</span>
                      <span aria-hidden>•</span>
                      {tender(s.tenderType)}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <span className="text-base font-bold tabular-nums">{money(s.total)}</span>
                    {/* Voided is a word and a tint, never colour alone. */}
                    {s.status === 'voided' ? (
                      <Badge variant="destructive">{t('voided')}</Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">{t('statuses.completed')}</span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <div className="bg-card hidden overflow-hidden rounded-xl border md:block">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>{t('saleNumber')}</TableHead>
                  <TableHead>{t('date')}</TableHead>
                  <TableHead>{t('tender')}</TableHead>
                  <TableHead>{t('status')}</TableHead>
                  <TableHead className="text-right">{t('total')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link href={`/${locale}/sales/${s.id}`} className="font-mono font-medium hover:underline">
                        {s.saleNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{when(s)}</TableCell>
                    <TableCell>{tender(s.tenderType)}</TableCell>
                    <TableCell>
                      {s.status === 'voided' ? (
                        <Badge variant="destructive">{t('voided')}</Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">{t('statuses.completed')}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{money(s.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Raise the ceiling rather than page. There is no offset to fall out
              of step with a list that is still being added to at the till, no
              count query, and the back button lands on the rows it left. */}
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground text-sm tabular-nums">{t('showing', { count: sales.length })}</span>
            {sales.length === filters.limit && nextLimit && (
              <Link href={withLimit(nextLimit)} className={buttonVariants({ variant: 'outline', className: 'h-11' })}>
                {t('showMore', { count: nextLimit })}
              </Link>
            )}
          </div>
        </>
      )}
    </main>
  );
}
