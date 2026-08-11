import { Check, Circle } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';

/**
 * What a shop sees before it has any data.
 *
 * "Nothing expiring in the next 14 days" is true on day one and completely
 * useless: the product cannot show what is about to expire until someone has
 * loaded a catalogue and received stock. CLAUDE.md names onboarding as the top
 * churn risk, so this states the three steps and links straight to the first
 * one still outstanding.
 */
export async function FirstRun({
  locale,
  hasProducts,
  hasStock,
}: {
  locale: string;
  hasProducts: boolean;
  hasStock: boolean;
}) {
  const t = await getTranslations('firstRun');

  const steps = [
    { key: 'catalogue', done: hasProducts, href: `/${locale}/products/import` },
    { key: 'receive', done: hasStock, href: `/${locale}/receive` },
    { key: 'count', done: false, href: `/${locale}/count` },
  ];
  const next = steps.find((s) => !s.done)!;

  return (
    <section className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium">{t('title')}</h2>
        <p className="text-muted-foreground text-sm">{t('intro')}</p>
      </div>

      <ol className="flex flex-col gap-3">
        {steps.map((step) => (
          <li key={step.key} className="flex items-start gap-3">
            {/* Done-ness carried by an icon and by the text, not by colour. */}
            {step.done ? (
              <Check aria-label={t('done')} className="mt-0.5 size-4 shrink-0" />
            ) : (
              <Circle aria-hidden className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            )}
            <div className="flex flex-col gap-0.5">
              <span className={step.done ? 'text-muted-foreground text-sm line-through' : 'text-sm font-medium'}>
                {t(`steps.${step.key}.title`)}
              </span>
              {!step.done && (
                <span className="text-muted-foreground text-sm">{t(`steps.${step.key}.body`)}</span>
              )}
            </div>
          </li>
        ))}
      </ol>

      <Link href={next.href} className={buttonVariants({ className: 'h-12 w-fit' })}>
        {t(`steps.${next.key}.action`)}
      </Link>
    </section>
  );
}
