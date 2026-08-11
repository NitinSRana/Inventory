'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Boxes, ClipboardList, Home, PackagePlus, Trash2 } from 'lucide-react';

/**
 * The daily loop, always one tap away.
 *
 * Four destinations, not nine: receiving, counting and writing off are what a
 * shop does every day, and the dashboard is where it starts. Everything else —
 * catalogue, suppliers, orders, reports, settings — lives behind More, because
 * a launcher with nine equal buttons makes the frequent things as hard to reach
 * as the rare ones.
 *
 * Client component only because it needs the current path to mark what is
 * active; it renders no data.
 */
const TABS = [
  { path: '', key: 'home', Icon: Home },
  { path: '/receive', key: 'receive', Icon: PackagePlus },
  { path: '/count', key: 'count', Icon: ClipboardList },
  { path: '/waste', key: 'waste', Icon: Trash2 },
  { path: '/more', key: 'more', Icon: Boxes },
] as const;

export function AppNav({ locale }: { locale: string }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const base = `/${locale}`;

  return (
    <nav
      aria-label={t('primary')}
      // Fixed to the bottom on a phone so it sits under the thumb, static on
      // desktop where reach is not the constraint.
      className="bg-background fixed inset-x-0 bottom-0 z-40 border-t sm:static sm:border-t-0 sm:border-b"
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
                className={`flex h-14 flex-col items-center justify-center gap-0.5 text-xs sm:h-12 sm:flex-row sm:gap-2 sm:text-sm ${
                  active ? 'text-foreground font-medium' : 'text-muted-foreground'
                }`}
              >
                <Icon aria-hidden className="size-5" />
                {t(key)}
                {/* Active state is not colour alone: an underline carries it too. */}
                {active && <span aria-hidden className="bg-foreground h-0.5 w-6 rounded-full sm:hidden" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
