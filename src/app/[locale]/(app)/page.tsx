import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { Check } from 'lucide-react';

import { ExpiryDashboard } from './dashboard';
import { InventoryOverview } from './overview';
import { buttonVariants } from '@/components/ui/button';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { RequestAccessForm } from '@/components/request-access-form';
import { getSessionState } from '@/server/auth/session';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function HomePage({ params, searchParams }: PageProps<'/[locale]'>) {
  const { locale } = await params;
  const { denied, requested, requestError } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations('home');
  const tApp = await getTranslations('app');
  const tRequest = await getTranslations('requestAccess');
  const session = await getSessionState();

  // Signed out gets no shell — there is no organization to name and nowhere to
  // navigate — so this screen has to stand on its own rather than be two words
  // on white.
  if (session.status === 'signedOut') {
    const points = ['expiry', 'autoStock', 'margin'] as const;
    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 p-6 py-12">
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{tApp('name')}</h1>
          <p className="text-muted-foreground text-base">{tApp('description')}</p>
        </div>

        <ul className="flex flex-col gap-3">
          {points.map((key) => (
            <li key={key} className="flex items-start gap-3 text-sm">
              <Check aria-hidden className="mt-0.5 size-4 shrink-0" />
              {t(`pitch.${key}`)}
            </li>
          ))}
        </ul>

        <section className="flex flex-col gap-4 border-t pt-8">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-bold tracking-tight">{tRequest('title')}</h2>
            <p className="text-muted-foreground text-sm">{tRequest('intro')}</p>
          </div>
          <RequestAccessForm
            locale={locale}
            back={`/${locale}`}
            requested={requested === '1'}
            error={typeof requestError === 'string' ? requestError : undefined}
          />
        </section>

        <div className="flex flex-col gap-3 border-t pt-8">
          <p className="text-muted-foreground text-sm">{t('signInHint')}</p>
          <Link
            href={`/${locale}/sign-in`}
            className={buttonVariants({ variant: 'outline', className: 'h-12 w-full sm:w-fit sm:px-8' })}
          >
            {t('signIn')}
          </Link>
        </div>
      </main>
    );
  }

  if (session.status === 'noOrganization') {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 p-6">
        <h1 className="text-xl font-semibold">{t('noOrganizationTitle')}</h1>
        <p className="text-muted-foreground text-sm">{t('noOrganization')}</p>
        <p className="text-muted-foreground text-sm">{t('signedInAs', { email: session.email })}</p>
      </main>
    );
  }

  // Every read goes through withTenant; RLS scopes it to session.orgId.
  const [org] = await withTenant(session.orgId, (tx) => tx.select().from(organizations));


  return (
    <main className="flex flex-1 flex-col gap-6 p-4">
      {/* On a phone the header already names the store, as the Today frame
          does; the heading stays for screen readers. */}
      <h1 className="text-2xl font-semibold max-md:sr-only">{org.name}</h1>

      {/* Says which role is needed, not just "no". */}
      {denied && (
        <p role="alert" className="text-destructive text-sm">
          {t(`denied.${denied}`)}
        </p>
      )}

      <InventoryOverview
        orgId={session.orgId}
        locale={locale}
        currency={org.currencyCode}
        role={session.role}
      />

      <ExpiryDashboard
        orgId={session.orgId}
        locale={locale}
        currency={org.currencyCode}
        role={session.role}
      />
    </main>
  );
}
