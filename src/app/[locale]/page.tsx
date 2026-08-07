import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getSessionContext } from '@/server/auth/session';

export default async function HomePage({ params }: PageProps<'/[locale]'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('home');
  const session = await getSessionContext();

  return (
    <main className="flex flex-1 flex-col justify-center gap-2 p-6">
      <p className="text-sm">
        {session ? t('signedInAs', { email: session.email }) : t('signedOut')}
      </p>
    </main>
  );
}
