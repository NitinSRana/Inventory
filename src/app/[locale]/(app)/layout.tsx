import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { Barcode } from 'lucide-react';

import { AppNav } from '@/components/app-nav';
import { AppSidebar } from '@/components/app-sidebar';
import { buttonVariants } from '@/components/ui/button';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getSessionState } from '@/server/auth/session';

import { signOut } from './actions';

/**
 * The shell every signed-in screen sits inside.
 *
 * Sign-in deliberately lives outside this group: it has no organization to name
 * and nowhere to navigate to.
 */
export default async function AppLayout({ children, params }: LayoutProps<'/[locale]'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('nav');
  const session = await getSessionState();

  // Signed out or not yet a member: no shell, because there is nothing to shell.
  // The home page renders both of those states itself.
  if (session.status !== 'ready') return <>{children}</>;

  const [org] = await withTenant(session.orgId, (tx) => tx.select().from(organizations));

  // Initials from the email, which the session always has. "a.b@x.com" -> "AB";
  // a bare local part still gets one.
  const initials =
    session.email
      .split(/[@.+_-]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join('') || '?';

  return (
    // Sidebar beside the content on a desktop browser, stacked with a bottom
    // tab bar on a phone. Only one of the two navs is ever visible.
    <div className="flex min-h-full md:items-stretch">
      <AppSidebar
        locale={locale}
        role={session.role}
        orgName={org.name}
        email={session.email}
        initials={initials}
        signOut={signOut.bind(null, locale)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone only. The desktop frames carry the shop in the sidebar instead,
            so a header there would say the same thing twice. Scan is the way
            into receiving and counting now that the tab bar no longer holds
            them: an aisle task starts with a product in hand. */}
        <header className="bg-card sticky top-0 z-40 border-b md:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-2">
            <Link href={`/${locale}`} className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-bold"
              >
                {org.name.charAt(0).toUpperCase()}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-bold">{org.name}</span>
                {org.address && (
                  <span className="text-muted-foreground truncate text-xs">{org.address}</span>
                )}
              </span>
            </Link>
            {/* 44px, not the 28px the frame draws: this is the most-used control
                in the aisle, and the touch minimum is an accessibility rule. */}
            <Link
              href={`/${locale}/scan`}
              className={buttonVariants({ className: 'h-11 shrink-0 gap-2' })}
            >
              <Barcode aria-hidden className="size-4" />
              {t('scan')}
            </Link>
          </div>
        </header>

        {/* The page fills the monitor; the *controls* inside it are what get
            capped (Field/FieldRow/BarcodeField cap at md:max-w-lg, EmptyState
            likewise). Still capped at all, because a table stretched across an
            ultrawide is no more readable than one crushed into 320px.
            pb-20 clears the fixed bottom bar on mobile; there is none above md. */}
        <div className="mx-auto w-full max-w-7xl flex-1 pb-20 md:pb-0">{children}</div>
      </div>

      <AppNav locale={locale} />
    </div>
  );
}
