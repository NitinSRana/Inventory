import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { SearchX } from 'lucide-react';

import { EmptyState } from '@/components/empty-state';
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
    <main className="flex flex-1 flex-col justify-center p-4">
      <EmptyState
        icon={SearchX}
        title={t('notFoundTitle')}
        body={t('notFoundBody')}
        action={
          <Link href={`/${routing.defaultLocale}`} className={buttonVariants({ className: 'h-12' })}>
            {t('home')}
          </Link>
        }
      />
    </main>
  );
}
