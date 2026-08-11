import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import {
  BarChart3,
  ChevronRight,
  Package,
  Percent,
  ShoppingCart,
  Truck,
  Users,
} from 'lucide-react';

import { requireOrg } from '@/server/auth/session';
import { roleAtLeast, type Role } from '@/server/auth/roles';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

/** Everything outside the daily loop, grouped by what it is for. */
const SECTIONS = [
  {
    key: 'catalogue',
    items: [
      { path: 'products', key: 'products', Icon: Package, needs: 'staff' },
      { path: 'suppliers', key: 'suppliers', Icon: Truck, needs: 'staff' },
    ],
  },
  {
    key: 'buying',
    items: [
      { path: 'reorder', key: 'reorder', Icon: ShoppingCart, needs: 'manager' },
      { path: 'orders', key: 'orders', Icon: ShoppingCart, needs: 'staff' },
    ],
  },
  {
    key: 'insight',
    items: [{ path: 'reports', key: 'reports', Icon: BarChart3, needs: 'staff' }],
  },
  {
    key: 'settings',
    items: [
      { path: 'settings/team', key: 'team', Icon: Users, needs: 'owner' },
      { path: 'settings/vat', key: 'vat', Icon: Percent, needs: 'owner' },
    ],
  },
] as const;

export default async function MorePage({ params }: PageProps<'/[locale]/more'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('more');
  const session = await requireOrg(locale);

  return (
    <main className="flex flex-1 flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>

      {SECTIONS.map((section) => {
        // Hide what this person cannot use. The server action behind each screen
        // checks the role again — hiding is presentation, not enforcement.
        const visible = section.items.filter((i) => roleAtLeast(session.role, i.needs as Role));
        if (visible.length === 0) return null;

        return (
          <section key={section.key} className="flex flex-col gap-2">
            <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {t(`sections.${section.key}`)}
            </h2>
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
