import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AlertTriangle, Trash2 } from 'lucide-react';

import { PageTitle, SectionHeading } from '@/components/data-list';
import { Field } from '@/components/form';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { requireRole } from '@/server/auth/session';
import { VoidReasonRequiredError, getSale, voidNeedsReason, voidSale } from '@/server/pos/checkout';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

/**
 * Confirms a void before it happens — this reverses real stock movements, so it
 * gets a review screen rather than a one-click button. Manager-gated: checked
 * here again, not only by the link that hides on the previous screen.
 *
 * Laid out as the "Void Transaction" frame: a summary of the sale, a warning
 * that says what happens and that it is final, then Void or Keep. The frame's
 * "Manager credentials approved" line is not built — the manager check is the
 * signed-in role, and a line claiming an approval step that never happened
 * would be false. Destructive red is right here: it is the one irreversible
 * action in the app.
 */
export default async function VoidSalePage({ params, searchParams }: PageProps<'/[locale]/sales/[id]/void'>) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const { error } = await searchParams;
  const t = await getTranslations('sales');
  const format = await getFormatter();
  const { orgId } = await requireRole(locale, 'manager');

  const receipt = await getSale(orgId, id);
  if (!receipt) notFound();
  // Already voided: nothing left to confirm, so send them back rather than
  // showing a form that will just fail.
  if (receipt.sale.status === 'voided') redirect(`/${locale}/sales/${id}`);

  // Reaching back into a closed day moves money that has already been counted,
  // and now also declared on the VAT report. Today's mis-ring is till work.
  const [needsReason, [org]] = await Promise.all([
    voidNeedsReason(orgId, id),
    withTenant(orgId, (tx) => tx.select().from(organizations)),
  ]);
  const { sale, lines } = receipt;

  async function confirm(formData: FormData) {
    'use server';
    const { orgId, userId } = await requireRole(locale, 'manager');
    try {
      await voidSale(orgId, id, {
        actorId: userId,
        reason: String(formData.get('reason') ?? ''),
      });
    } catch (e) {
      if (!(e instanceof VoidReasonRequiredError)) throw e;
      redirect(`/${locale}/sales/${id}/void?error=reasonRequired`);
    }
    redirect(`/${locale}/sales/${id}`);
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:max-w-xl">
      <PageTitle caption={sale.saleNumber}>{t('voidScreenTitle')}</PageTitle>

      <section className="bg-card flex flex-col gap-3 rounded-xl border p-4">
        <SectionHeading>{t('summaryTitle')}</SectionHeading>
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="font-semibold">{t('saleNumber')}</dt>
            <dd className="font-mono font-bold">{sale.saleNumber}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t('date')}</dt>
            <dd>
              {format.dateTime(new Date(sale.occurredAt ?? sale.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t('totalGross')}</dt>
            <dd className="font-bold tabular-nums">
              {format.number(Number(sale.total), { style: 'currency', currency: org.currencyCode })}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t('summaryLines')}</dt>
            <dd>{t('linesCount', { count: lines.length })}</dd>
          </div>
        </dl>
      </section>

      <div role="note" className="bg-destructive-subtle text-destructive flex items-start gap-3 rounded-xl border p-4">
        <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0" />
        <div className="flex flex-col gap-1">
          <span className="text-sm font-bold">{t('voidWarningTitle')}</span>
          <span className="text-sm">{t('voidWarning')}</span>
        </div>
      </div>

      <form action={confirm} className="flex flex-col gap-3">
        {needsReason && (
          <Field
            name="reason"
            label={t('voidReasonLabel')}
            hint={t('voidReasonHint')}
            required
            error={error === 'reasonRequired' ? t('voidReasonRequired') : undefined}
          >
            <Input id="reason" name="reason" required className="h-12" />
          </Field>
        )}
        {/* Solid, not the usual tint: the frame draws the one irreversible
            action in the app as the loudest thing on the screen. */}
        <Button
          type="submit"
          variant="destructive"
          className="bg-destructive hover:bg-destructive/90 h-12 w-full gap-2 text-white sm:w-fit sm:px-8"
        >
          <Trash2 aria-hidden className="size-4" />
          {t('confirmVoid')}
        </Button>
        <Link
          href={`/${locale}/sales/${id}`}
          className={buttonVariants({ variant: 'outline', className: 'h-12 w-full sm:w-fit sm:px-8' })}
        >
          {t('keepSale')}
        </Link>
      </form>
    </main>
  );
}
