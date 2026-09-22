import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';

import { PageTitle } from '@/components/data-list';
import { RequestAccessForm } from '@/components/request-access-form';
import { one } from '@/lib/search-params';

/**
 * The request form on its own page, for the link on the sign-in screen and any
 * link the platform owner sends. The landing page carries the same form.
 */
export default async function RequestAccessPage({
  params,
  searchParams,
}: PageProps<'/[locale]/request-access'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const sp = await searchParams;
  const t = await getTranslations('requestAccess');

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 p-6">
      <PageTitle caption={t('intro')}>{t('title')}</PageTitle>

      <RequestAccessForm
        locale={locale}
        back={`/${locale}/request-access`}
        requested={one(sp.requested) === '1'}
        error={one(sp.requestError)}
      />

      <Link
        href={`/${locale}/sign-in`}
        className="text-link inline-flex min-h-11 items-center text-sm font-semibold"
      >
        {t('haveAccount')}
      </Link>
    </main>
  );
}
