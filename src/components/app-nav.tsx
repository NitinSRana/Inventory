'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { TABS } from '@/components/nav-items';

/**
 * The phone's tab bar, always one thumb away.
 *
 * Phone only: below `md` this is the whole navigation, and above it the
 * sidebar replaces it. A worker in an aisle gets four big targets at the bottom
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
      className="bg-card fixed inset-x-0 bottom-0 z-40 border-t md:hidden"
    >
      <ul className="mx-auto flex max-w-3xl">
        {TABS.map(({ path, key, Icon }) => {
          const href = `${base}${path}`;
          // More owns everything outside the tab bar, so a screen reached
          // through it still shows where you are. Without this, /suppliers
          // highlights nothing and the tab bar looks broken.
          // Scan is the exception: it is opened from the header, not from More,
          // so while it is open no tab claims it.
          const ownedByMore =
            !pathname.startsWith(`${base}/scan`) &&
            !TABS.some(
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
                // 64px tall, as drawn: well past the 44px minimum with gloves,
                // and the label stays visible rather than relying on the icon.
                className={`flex h-16 flex-col items-center justify-center gap-1 text-xs ${
                  active ? 'text-link font-semibold' : 'text-muted-foreground font-medium'
                }`}
              >
                <Icon aria-hidden className="size-5" />
                {t(key)}
                {/* Active state is not colour alone: an underline carries it too. */}
                <span
                  aria-hidden
                  className={`h-0.5 w-6 rounded-full ${active ? 'bg-link' : 'bg-transparent'}`}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
