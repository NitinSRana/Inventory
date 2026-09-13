'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';

import { PRIMARY, SECTIONS } from '@/components/nav-items';
import { roleAtLeast } from '@/server/auth/roles';

/**
 * Desktop navigation.
 *
 * The browser is where most hours in this product are spent — checkout runs
 * there all day — so the width is worth using. A bottom tab bar on a 1920px
 * monitor reads as a phone app in a browser window and hides most destinations
 * behind More for no reason.
 *
 * Laid out as the redesign's desktop frames draw it: the shop at the top, the
 * destinations, and the signed-in person at the bottom. The frames list only
 * three destinations; every one the app has stays here, because a sidebar that
 * cannot reach Reports is not a simplification.
 *
 * Hidden below `md`, where the bottom tab bar takes over. Both are rendered;
 * choosing between them in JavaScript would mean measuring the viewport on the
 * client, and this stays a CSS decision.
 */
export function AppSidebar({
  locale,
  role,
  orgName,
  email,
  initials,
  signOut,
}: {
  locale: string;
  role: string;
  orgName: string;
  email: string;
  initials: string;
  signOut: () => Promise<void>;
}) {
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
        ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
        : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground font-medium'
    }`;

  return (
    <aside className="bg-sidebar border-sidebar-border hidden shrink-0 border-r md:block md:w-56 lg:w-60">
      <div className="sticky top-0 flex h-dvh flex-col gap-6 overflow-y-auto p-4">
        <Link href={base} className="flex items-center gap-3 px-1">
          <span
            aria-hidden
            className="bg-sidebar-primary text-sidebar-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-bold"
          >
            {orgName.charAt(0).toUpperCase()}
          </span>
          <span className="text-sidebar-foreground truncate text-sm font-semibold">{orgName}</span>
        </Link>

        <nav aria-label={t('primary')} className="flex flex-col gap-6">
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

        {/* Who is signed in, and the way out — the header used to hold both. */}
        <div className="border-sidebar-border mt-auto flex items-center gap-3 border-t pt-4">
          <span
            aria-hidden
            className="bg-sidebar-accent text-sidebar-accent-foreground flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
          >
            {initials}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-sidebar-foreground truncate text-sm font-semibold">{email}</span>
            <span className="text-sidebar-foreground/60 truncate text-xs">{tMore(`roles.${role}`)}</span>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              aria-label={t('signOut')}
              className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex size-8 items-center justify-center rounded-md"
            >
              <LogOut aria-hidden className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
