'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

/** Says what to do next. Never renders the raw exception. */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('products');

  return (
    <main className="flex flex-1 flex-col items-start justify-center gap-4 p-6">
      <p role="alert" className="text-sm">
        {t('loadFailed')}
      </p>
      <Button onClick={reset} className="h-11">
        {t('retry')}
      </Button>
    </main>
  );
}
