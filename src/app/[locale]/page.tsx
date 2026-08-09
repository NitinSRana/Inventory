import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';

import { ExpiryDashboard } from './dashboard';
import { Button, buttonVariants } from '@/components/ui/button';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { createClient } from '@/lib/supabase/server';
import { getSessionState } from '@/server/auth/session';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function HomePage({ params }: PageProps<'/[locale]'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('home');
  const session = await getSessionState();

  if (session.status === 'signedOut') {
    return (
      <main className="flex flex-1 flex-col justify-center gap-4 p-6">
        <p className="text-sm">{t('signedOut')}</p>
        <Link href={`/${locale}/sign-in`} className={buttonVariants({ className: 'h-11' })}>
          {t('signIn')}
        </Link>
      </main>
    );
  }

  if (session.status === 'noOrganization') {
    return (
      <main className="flex flex-1 flex-col justify-center gap-4 p-6">
        <p className="text-sm">{t('noOrganization')}</p>
        <p className="text-muted-foreground text-sm">{t('signedInAs', { email: session.email })}</p>
      </main>
    );
  }

  // Every read goes through withTenant; RLS scopes it to session.orgId.
  const [org] = await withTenant(session.orgId, (tx) => tx.select().from(organizations));

  async function signOut() {
    'use server';
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect(`/${locale}`);
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold">{org.name}</h1>

      <ExpiryDashboard orgId={session.orgId} locale={locale} currency={org.currencyCode} />

      <div className="text-muted-foreground mt-auto flex flex-col gap-2 pt-6 text-sm">
        <span>{t('signedInAs', { email: session.email })}</span>
        <form action={signOut}>
          <Button type="submit" variant="outline" className="h-11">
            {t('signOut')}
          </Button>
        </form>
      </div>
    </main>
  );
}
