'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';

/**
 * One boundary for every signed-in screen. Says what to do next and never
 * renders the exception — a stack trace tells a shopkeeper nothing and may
 * leak internals.
 */
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('errors');

  return (
    <main className="flex flex-1 flex-col justify-center p-4">
      <EmptyState
        icon={TriangleAlert}
        title={t('title')}
        body={t('body')}
        action={
          <Button onClick={reset} className="h-12">
            {t('retry')}
          </Button>
        }
      />
    </main>
  );
}
