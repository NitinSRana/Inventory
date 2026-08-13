'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { SectionHeading } from '@/components/data-list';
import { PRIMARY, SECTIONS } from '@/components/nav-items';
import { roleAtLeast } from '@/server/auth/roles';

/**
 * Desktop navigation.
 *
 * The browser is where most hours in this product are spent — checkout runs
 * there all day — so the width is worth using. A bottom tab bar on a 1920px
 * monitor reads as a phone app in a browser window and hides eleven of the
 * fifteen destinations behind More for no reason.
 *
 * Hidden below `md`, where the bottom tab bar takes over. Both are rendered;
 * choosing between them in JavaScript would mean measuring the viewport on the
 * client, and this stays a CSS decision.
 */
export function AppSidebar({ locale, role }: { locale: string; role: string }) {
  const t = useTranslations('nav');
  const tMore = useTranslations('more');
  const pathname = usePathname();
  const base = `/${locale}`;

  const linkClass = (active: boolean) =>
    // min-h-11 keeps a comfortable target on a touch laptop without the 56px a
    // gloved thumb needs; this surface is never used in the aisle.
    `flex min-h-11 items-center gap-3 rounded-md px-3 text-sm ${
      active ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:bg-muted/60'
    }`;

  return (
    <aside className="hidden shrink-0 border-r md:block md:w-56 lg:w-64">
      <nav aria-label={t('primary')} className="sticky top-0 flex flex-col gap-6 p-3">
        <ul className="flex flex-col gap-1">
          {PRIMARY.map(({ path, key, Icon }) => {
            const href = `${base}${path}`;
            const active = path === '' ? pathname === base : pathname.startsWith(href);
            return (
              <li key={key}>
                <Link href={href} aria-current={active ? 'page' : undefined} className={linkClass(active)}>
                  <Icon aria-hidden className="size-5 shrink-0" />
                  {t(key)}
                </Link>
              </li>
            );
          })}
        </ul>

        {SECTIONS.map((section) => {
          // Hide what this person cannot use. The server action behind each
          // screen checks the role again — hiding is presentation, not
          // enforcement.
          const visible = section.items.filter((i) => roleAtLeast(role, i.needs));
          if (visible.length === 0) return null;

          return (
            <div key={section.key} className="flex flex-col gap-1">
              <SectionHeading className="px-3">{tMore(`sections.${section.key}`)}</SectionHeading>
              <ul className="flex flex-col gap-1">
                {visible.map(({ path, key, Icon }) => {
                  const href = `${base}/${path}`;
                  const active = pathname.startsWith(href);
                  return (
                    <li key={path}>
                      <Link
                        href={href}
                        aria-current={active ? 'page' : undefined}
                        className={linkClass(active)}
                      >
                        <Icon aria-hidden className="size-5 shrink-0" />
                        {tMore(`items.${key}`)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
