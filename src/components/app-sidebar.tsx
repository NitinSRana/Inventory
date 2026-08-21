'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

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
    // A pointer, not a gloved thumb: this surface is never used in the aisle,
    // so it can run at mouse-comfortable height rather than the 44px touch
    // minimum that rule exists for.
    `flex min-h-8 items-center gap-3 rounded-md px-3 text-sm ${
      active
        ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
        : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
    }`;

  return (
    <aside className="bg-sidebar hidden shrink-0 border-r md:block md:w-56 lg:w-64">
      <nav
        aria-label={t('primary')}
        className="sticky top-0 flex flex-col gap-6 p-3"
      >
        <ul className="flex flex-col gap-1">
          {PRIMARY.map(({ path, key, Icon }) => {
            const href = `${base}${path}`;
            const active = path === '' ? pathname === base : pathname.startsWith(href);
            return (
              <li key={key}>
                <Link href={href} aria-current={active ? 'page' : undefined} className={linkClass(active)}>
                  <Icon aria-hidden className="size-4 shrink-0" />
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
              {/* Not SectionHeading: its default colour is tuned for a light
                  card, not this dark rail — a plain heading avoids fighting
                  that default rather than trying to out-specificity it. */}
              <h2 className="text-sidebar-foreground/50 px-3 text-xs font-medium tracking-wider uppercase">
                {tMore(`sections.${section.key}`)}
              </h2>
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
                        <Icon aria-hidden className="size-4 shrink-0" />
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
