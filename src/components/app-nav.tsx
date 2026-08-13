'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { TABS } from '@/components/nav-items';

/**
 * The daily loop on a phone, always one thumb away.
 *
 * Phone only: below `md` this is the whole navigation, and above it the
 * sidebar replaces it. A worker in an aisle gets five big targets at the bottom
 * of the screen; an owner at a desk gets every destination listed down the side.
 *
 * Client component only because it needs the current path to mark what is
 * active; it renders no data. The destinations themselves live in
 * `nav-items.ts`, shared with the sidebar and the More screen.
 */
export function AppNav({ locale }: { locale: string }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const base = `/${locale}`;

  return (
    <nav
      aria-label={t('primary')}
      // Fixed to the bottom so it sits under the thumb, and gone entirely once
      // there is a sidebar to do the job better.
      className="bg-background fixed inset-x-0 bottom-0 z-40 border-t md:hidden"
    >
      <ul className="mx-auto flex max-w-3xl">
        {TABS.map(({ path, key, Icon }) => {
          const href = `${base}${path}`;
          // More owns everything outside the daily loop, so a screen reached
          // through it still shows where you are. Without this, /products
          // highlights nothing and the tab bar looks broken.
          const ownedByMore = !TABS.some(
            (tab) => tab.path !== '' && tab.path !== '/more' && pathname.startsWith(`${base}${tab.path}`),
          );
          const active =
            path === ''
              ? pathname === base
              : path === '/more'
                ? pathname !== base && ownedByMore
                : pathname.startsWith(href);
          return (
            <li key={key} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                // 56px tall: comfortably past the 44px minimum with gloves, and
                // the label stays visible rather than relying on the icon alone.
                className={`flex h-14 flex-col items-center justify-center gap-0.5 text-xs ${
                  active ? 'text-foreground font-medium' : 'text-muted-foreground'
                }`}
              >
                <Icon aria-hidden className="size-5" />
                {t(key)}
                {/* Active state is not colour alone: an underline carries it too. */}
                {active && <span aria-hidden className="bg-foreground h-0.5 w-6 rounded-full" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
