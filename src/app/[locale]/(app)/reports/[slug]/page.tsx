import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FileX2 } from 'lucide-react';

import { BackLink } from '@/components/back-link';
import { PageTitle } from '@/components/data-list';
import { EmptyState } from '@/components/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { trimQuantity } from '@/lib/quantity';
import { requireOrg } from '@/server/auth/session';
import { REPORT_SLUGS, buildReport, type ReportSlug } from '@/server/reports';
import { formatCell } from '@/server/reports/display';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

const PERIODS = [7, 30, 90] as const;
/** Only these two are time-bounded; stock and low-stock are point-in-time. */
const TIME_BOUNDED: ReportSlug[] = ['waste', 'expiry', 'sales'];

export default async function ReportPage({ params, searchParams }: PageProps<'/[locale]/reports/[slug]'>) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  if (!REPORT_SLUGS.includes(slug as ReportSlug)) notFound();
  const reportSlug = slug as ReportSlug;

  const { days } = await searchParams;
  const period = PERIODS.includes(Number(days) as (typeof PERIODS)[number]) ? Number(days) : 30;

  const t = await getTranslations('reports');
  const tBack = await getTranslations('back');
  const format = await getFormatter();
  const { orgId } = await requireOrg(locale);
  const report = await buildReport(orgId, reportSlug, period);
  const [org] = await withTenant(orgId, (tx) => tx.select().from(organizations));

  // Rows arrive raw so the CSV stays re-importable; the screen formats at the
  // last moment. The rules live in display.ts, where they are testable without
  // a request or a locale.
  const cell = (column: (typeof report.columns)[number], raw: string | undefined) =>
    formatCell(column, raw, {
      money: (v) => format.number(v, { style: 'currency', currency: org.currencyCode }),
      quantity: trimQuantity,
    });

  const showPeriod = TIME_BOUNDED.includes(reportSlug);
  const exportHref =
    `/${locale}/reports/${reportSlug}/export` + (showPeriod ? `?days=${period}` : '');

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <BackLink href={`/${locale}/reports`} label={tBack('reports')} />
      <PageTitle caption={<span className="tabular-nums">{t('rowCount', { count: report.rows.length })}</span>}>
        {t(`names.${reportSlug}`)}
      </PageTitle>

      {showPeriod && (
        <nav aria-label={t('periodLabel')} className="flex gap-2">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`/${locale}/reports/${reportSlug}?days=${p}`}
              aria-current={p === period ? 'page' : undefined}
              className={buttonVariants({
                variant: p === period ? 'default' : 'outline',
                className: 'h-11',
              })}
            >
              {t('lastDays', { days: p })}
            </Link>
          ))}
        </nav>
      )}

      {report.rows.length === 0 ? (
        <EmptyState icon={FileX2} title={t('empty')} body={t('emptyBody')} />
      ) : (
        <>
          {/* Stacked on a phone, table on desktop — never a sideways-scrolling
              table. One bordered container with dividers rather than a card per
              row: cards spend roughly 24px of gutter and shadow each and buy
              nothing, which is the same call every other list in the app makes. */}
          <div className="overflow-hidden rounded-lg border sm:hidden">
            <ul className="divide-border divide-y">
              {report.rows.map((row, i) => (
                <li key={i} className="flex flex-col gap-1 px-4 py-3">
                  <span className="font-medium">{row[report.columns[0].key]}</span>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm">
                    {report.columns.slice(1).map((c) => (
                      <div key={c.key} className="contents">
                        <dt className="text-muted-foreground">{t(`columns.${c.label}`)}</dt>
                        <dd className={c.numeric ? 'text-right tabular-nums' : ''}>
                          {cell(c, row[c.key])}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          </div>

          <div className="hidden overflow-x-auto sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  {report.columns.map((c) => (
                    <TableHead key={c.key} className={c.numeric ? 'text-right' : ''}>
                      {t(`columns.${c.label}`)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map((row, i) => (
                  <TableRow key={i}>
                    {report.columns.map((c) => (
                      <TableCell
                        key={c.key}
                        className={c.numeric ? 'text-right tabular-nums' : ''}
                      >
                        {cell(c, row[c.key])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <div className="flex flex-wrap gap-2">
        {report.rows.length > 0 && (
          <a
            href={exportHref}
            download
            className={buttonVariants({ variant: 'outline', className: 'h-11' })}
          >
            {t('exportCsv')}
          </a>
        )}
        <Link
          href={`/${locale}/reports`}
          className={buttonVariants({ variant: 'ghost', className: 'h-11' })}
        >
          {t('allReports')}
        </Link>
      </div>
    </main>
  );
}
