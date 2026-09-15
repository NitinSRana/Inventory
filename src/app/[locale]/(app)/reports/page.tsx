import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { Download } from 'lucide-react';

import { PageTitle, SectionHeading } from '@/components/data-list';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { requireOrg } from '@/server/auth/session';
import { REPORT_COLUMNS, REPORT_SLUGS, type ReportSlug } from '@/server/reports';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

/** Only these are time-bounded; stock and low stock are point-in-time. Matches the report page. */
const TIME_BOUNDED: ReportSlug[] = ['expiry', 'sales', 'vat', 'corrections'];
const DEFAULT_DAYS = 30;

/**
 * Laid out as the "Store Reports" frame: one card per report, numbered, with
 * what it answers, the columns its CSV carries, and Export.
 *
 * All six reports, not the frame's four — VAT and corrections are what a shop
 * files a return and audits the ledger with. The frame's "re-importable" notes
 * are left out: a promise about another tool is not this screen's to make.
 * The report name opens the report itself, where the period can be changed.
 */
export default async function ReportsPage({ params }: PageProps<'/[locale]/reports'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('reports');
  await requireOrg(locale);

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:max-w-3xl">
      <PageTitle caption={t('intro')}>{t('title')}</PageTitle>

      <ol className="flex flex-col gap-3">
        {REPORT_SLUGS.map((slug, i) => {
          const timed = TIME_BOUNDED.includes(slug);
          const exportHref = `/${locale}/reports/${slug}/export${timed ? `?days=${DEFAULT_DAYS}` : ''}`;
          return (
            <li key={slug} className="bg-card flex flex-col gap-3 rounded-xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Link
                    href={`/${locale}/reports/${slug}`}
                    className="inline-flex min-h-11 items-center text-lg font-bold hover:underline"
                  >
                    {i + 1}. {t(`names.${slug}`)}
                  </Link>
                  <p className="text-muted-foreground -mt-2 text-sm">{t(`blurbs.${slug}`)}</p>
                </div>
                <Badge variant="outline" className="mt-3 shrink-0">
                  {timed ? t('lastDays', { days: DEFAULT_DAYS }) : t('pointInTime')}
                </Badge>
              </div>

              <div className="flex flex-col gap-2">
                <SectionHeading>{t('exportColumns')}</SectionHeading>
                <ul className="flex flex-wrap gap-1.5">
                  {REPORT_COLUMNS[slug].map((c) => (
                    <li key={c.key} className="bg-muted rounded-md px-2 py-1 text-xs">
                      {t(`columns.${c.label}`)}
                    </li>
                  ))}
                </ul>
              </div>

              <a
                href={exportHref}
                download
                // The field border, not the card's: an outline button on a white
                // card vanishes at the card border's contrast.
                className={buttonVariants({ variant: 'outline', className: 'border-input h-11 w-full gap-2 sm:w-fit sm:px-6' })}
              >
                <Download aria-hidden className="size-4" />
                {t('exportCsv')}
              </a>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
