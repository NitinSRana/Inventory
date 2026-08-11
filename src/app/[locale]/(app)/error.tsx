'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

/**
 * One boundary for every signed-in screen. Says what to do next and never
 * renders the exception — a stack trace tells a shopkeeper nothing and may
 * leak internals.
 */
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('errors');

  return (
    <main className="flex flex-1 flex-col items-start justify-center gap-4 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('body')}</p>
      </div>
      <Button onClick={reset} className="h-12">
        {t('retry')}
      </Button>
    </main>
  );
}
