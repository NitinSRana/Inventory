import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';

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
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <ul className="flex flex-col gap-2">
        {REPORT_SLUGS.map((slug) => (
          <li key={slug}>
            {/* Each row states what the report answers, not just its name — a
                list of four nouns makes you open all four to find out. */}
            <Link
              href={`/${locale}/reports/${slug}`}
              className="flex min-h-12 flex-col justify-center gap-0.5 rounded-lg border p-3"
            >
              <span className="font-medium">{t(`names.${slug}`)}</span>
              <span className="text-muted-foreground text-sm">{t(`blurbs.${slug}`)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
