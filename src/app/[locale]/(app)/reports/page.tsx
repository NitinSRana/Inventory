import { getTranslations, setRequestLocale } from 'next-intl/server';

import { DataList, DataRow, PageTitle } from '@/components/data-list';
import { requireOrg } from '@/server/auth/session';
import { REPORT_SLUGS } from '@/server/reports';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function ReportsPage({ params }: PageProps<'/[locale]/reports'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('reports');
  await requireOrg(locale);

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <PageTitle>{t('title')}</PageTitle>
      {/* Each row states what the report answers, not just its name — a list of
          bare nouns makes you open every one to find out. */}
      <DataList>
        {REPORT_SLUGS.map((slug) => (
          <DataRow
            key={slug}
            href={`/${locale}/reports/${slug}`}
            title={t(`names.${slug}`)}
            subtitle={t(`blurbs.${slug}`)}
            wrap
          />
        ))}
      </DataList>
    </main>
  );
}
