import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { ChevronRight, Clock, Plus, Search, SearchX, Truck } from 'lucide-react';

import { PageTitle } from '@/components/data-list';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { one } from '@/lib/search-params';
import { requireOrg } from '@/server/auth/session';
import { listSuppliers } from '@/server/catalog/suppliers';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

/**
 * Laid out as the "Suppliers" phone frame and the "Supplier Directory" desktop
 * frame: search, then cards with contact and lead time on a phone, a table with
 * contact, email, phone, products supplied, last delivery and status on a desk.
 *
 * Last delivery is read off the ledger's receipts (listSuppliers), not typed
 * in. Deactivated suppliers are listed with an Inactive badge, as the desktop
 * frame shows them, rather than disappearing.
 */
export default async function SuppliersPage({ params, searchParams }: PageProps<'/[locale]/suppliers'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('suppliers');
  const format = await getFormatter();
  const { orgId } = await requireOrg(locale);
  const all = await listSuppliers(orgId, { includeInactive: true });

  // Dozens of suppliers, not thousands: filter what is already loaded.
  const search = one((await searchParams).q)?.trim() ?? '';
  const needle = search.toLocaleLowerCase();
  const suppliers = needle
    ? all.filter((s) =>
        [s.name, s.contactName, s.email, s.phone].some((v) => v?.toLocaleLowerCase().includes(needle)),
      )
    : all;

  const date = (v: Date | null) =>
    v ? format.dateTime(v, { day: '2-digit', month: 'short', year: 'numeric' }) : t('never');
  const status = (active: boolean) =>
    active ? (
      <span className="text-muted-foreground text-xs">{t('active')}</span>
    ) : (
      <Badge variant="secondary">{t('inactive')}</Badge>
    );

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <PageTitle caption={<span className="hidden md:inline">{t('intro')}</span>}>{t('title')}</PageTitle>
        <Link href={`/${locale}/suppliers/new`} className={buttonVariants({ className: 'h-11 gap-1.5' })}>
          <Plus aria-hidden className="size-4" />
          <span className="md:hidden">{t('addShort')}</span>
          <span className="hidden md:inline">{t('add')}</span>
        </Link>
      </div>

      {all.length === 0 ? (
        <EmptyState icon={Truck} title={t('empty')} body={t('emptyBody')} />
      ) : (
        <div className="flex flex-col gap-4 md:bg-card md:gap-0 md:overflow-hidden md:rounded-xl md:border">
          {/* GET form so the search lives in the URL. Enter submits it. */}
          <form role="search" className="md:border-b md:p-3">
            <label htmlFor="q" className="relative block">
              <span className="sr-only">{t('search')}</span>
              <Search
                aria-hidden
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2"
              />
              <Input
                id="q"
                name="q"
                type="search"
                defaultValue={search}
                placeholder={t('search')}
                className="h-12 pl-10 md:h-11"
              />
            </label>
          </form>

          {suppliers.length === 0 ? (
            <div className="md:p-4">
              <EmptyState icon={SearchX} title={t('noMatches')} />
            </div>
          ) : (
            <>
              <ul className="bg-card divide-border divide-y overflow-hidden rounded-xl border md:hidden">
                {suppliers.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/${locale}/suppliers/${s.id}`}
                      className="grid min-h-18 grid-cols-[1fr_auto] items-center gap-3 px-4 py-3"
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-base font-semibold">{s.name}</span>
                          {!s.isActive && <Badge variant="secondary">{t('inactive')}</Badge>}
                        </span>
                        {s.contactName && (
                          <span className="text-muted-foreground truncate text-sm">
                            {t('contactLine', { name: s.contactName })}
                          </span>
                        )}
                        <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
                          <Clock aria-hidden className="size-3.5" />
                          {t('leadTimeLine', { days: s.leadTimeDays })}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <Badge variant="outline">{t('itemsBadge', { count: s.productCount })}</Badge>
                        <ChevronRight aria-hidden className="text-muted-foreground size-4" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>

              <Table className="hidden md:table">
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>{t('name')}</TableHead>
                    <TableHead>{t('contact')}</TableHead>
                    <TableHead>{t('email')}</TableHead>
                    <TableHead>{t('phone')}</TableHead>
                    <TableHead className="text-right">{t('productCount')}</TableHead>
                    <TableHead>{t('lastDelivery')}</TableHead>
                    <TableHead>{t('status')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suppliers.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Link href={`/${locale}/suppliers/${s.id}`} className="font-medium hover:underline">
                          {s.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{s.contactName ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{s.email ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">{s.phone ?? '—'}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{s.productCount}</TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">{date(s.lastDeliveryAt)}</TableCell>
                      <TableCell>{status(s.isActive)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </div>
      )}
    </main>
  );
}
