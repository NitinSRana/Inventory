import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { ChevronRight, LogOut } from 'lucide-react';

import { requireOrg } from '@/server/auth/session';
import { roleAtLeast, type Role } from '@/server/auth/roles';
import { PageTitle, SectionHeading } from '@/components/data-list';
import { SECTIONS } from '@/components/nav-items';
import { Badge } from '@/components/ui/badge';

import { signOut } from '../actions';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

/**
 * Everything the tab bar does not hold, on a phone.
 *
 * Styled as the redesign's More frame: grouped cards of rows, an icon tile per
 * row, and a role badge where a row needs more than staff. Two departures, both
 * on purpose. The badges and Sign out are neutral rather than amber and red —
 * colour in this product means expiry urgency and nothing else. And the frame's
 * "v2.4.1 · Licensed to Store #104" footer is left out: there is no such
 * version or licence to report.
 */
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
            <ul className="bg-card divide-y overflow-hidden rounded-xl border">
              {visible.map(({ path, key, Icon, needs }) => (
                <li key={path}>
                  <Link href={`/${locale}/${path}`} className="flex min-h-14 items-center gap-3 px-4 py-3">
                    <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-md">
                      <Icon aria-hidden className="size-4" />
                    </span>
                    <span className="flex-1 font-medium">{t(`items.${key}`)}</span>
                    {needs !== 'staff' && <Badge variant="outline">{t(`roles.${needs}`)}</Badge>}
                    <ChevronRight aria-hidden className="text-muted-foreground size-4 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <form action={signOut.bind(null, locale)}>
        <button
          type="submit"
          className="bg-card flex min-h-14 w-full items-center gap-3 rounded-xl border px-4 py-3 text-left"
        >
          <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-md">
            <LogOut aria-hidden className="size-4" />
          </span>
          <span className="flex-1 font-medium">{t('signOut')}</span>
          <ChevronRight aria-hidden className="text-muted-foreground size-4 shrink-0" />
        </button>
      </form>
    </main>
  );
}
