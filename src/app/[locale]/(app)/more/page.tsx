import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { requireOrg } from '@/server/auth/session';
import { roleAtLeast, type Role } from '@/server/auth/roles';
import { PageTitle, SectionHeading } from '@/components/data-list';
import { SECTIONS } from '@/components/nav-items';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';


export default async function MorePage({ params }: PageProps<'/[locale]/more'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('more');
  const session = await requireOrg(locale);

  return (
    <main className="flex flex-1 flex-col gap-6 p-4">
      <PageTitle>{t('title')}</PageTitle>

      {SECTIONS.map((section) => {
        // Hide what this person cannot use. The server action behind each screen
        // checks the role again — hiding is presentation, not enforcement.
        const visible = section.items.filter((i) => roleAtLeast(session.role, i.needs as Role));
        if (visible.length === 0) return null;

        return (
          <section key={section.key} className="flex flex-col gap-2">
            <SectionHeading>{t(`sections.${section.key}`)}</SectionHeading>
            <ul className="divide-y rounded-lg border">
              {visible.map(({ path, key, Icon }) => (
                <li key={path}>
                  <Link
                    href={`/${locale}/${path}`}
                    className="flex min-h-14 items-center gap-3 px-4 py-3"
                  >
                    <Icon aria-hidden className="text-muted-foreground size-5 shrink-0" />
                    <span className="flex-1">{t(`items.${key}`)}</span>
                    <ChevronRight aria-hidden className="text-muted-foreground size-4 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
