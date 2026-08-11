import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { routing } from '@/i18n/routing';

/**
 * Also what a stranger's product id lands on: RLS scopes every lookup, so
 * another tenant's row is indistinguishable from one that never existed — which
 * is exactly the right thing to show.
 */
export default async function AppNotFound() {
  const t = await getTranslations('errors');

  return (
    <main className="flex flex-1 flex-col items-start justify-center gap-4 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{t('notFoundTitle')}</h1>
        <p className="text-muted-foreground text-sm">{t('notFoundBody')}</p>
      </div>
      <Link href={`/${routing.defaultLocale}`} className={buttonVariants({ className: 'h-12' })}>
        {t('home')}
      </Link>
    </main>
  );
}
