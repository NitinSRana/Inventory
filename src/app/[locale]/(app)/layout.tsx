import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AppNav } from '@/components/app-nav';
import { Button } from '@/components/ui/button';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { createClient } from '@/lib/supabase/server';
import { getSessionState } from '@/server/auth/session';

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

  async function signOut() {
    'use server';
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect(`/${locale}`);
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="bg-background sticky top-0 z-40 border-b sm:border-b-0">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4">
          <Link href={`/${locale}`} className="truncate font-medium">
            {org.name}
          </Link>
          <form action={signOut}>
            <Button type="submit" variant="ghost" className="text-muted-foreground h-11 text-sm">
              {t('signOut')}
            </Button>
          </form>
        </div>
      </header>

      <AppNav locale={locale} />

      {/* pb-20 clears the fixed bottom bar on mobile so nothing hides behind it. */}
      <div className="mx-auto w-full max-w-3xl flex-1 pb-20 sm:pb-0">{children}</div>
    </div>
  );
}
