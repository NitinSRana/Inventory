import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Inbox } from 'lucide-react';

import { PageTitle, SectionHeading } from '@/components/data-list';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { one } from '@/lib/search-params';
import { requirePlatformAdmin } from '@/server/platform/admins';
import { approveRequest, declineRequest, listRequests } from '@/server/platform/signup-requests';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

/**
 * The queue: who has asked for a shop, and what happened to them.
 *
 * Approving creates the shop, the owner invitation and the login, then emails
 * the applicant. None of that is rolled back by a failed email — the invitation
 * is what grants access — so the outcome of both the login and the mail is
 * reported rather than assumed, the same way the Team screen reports an
 * invitation it could not send.
 */
export default async function AdminRequestsPage({ params, searchParams }: PageProps<'/[locale]/admin/requests'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePlatformAdmin();

  const sp = await searchParams;
  const t = await getTranslations('admin');
  const format = await getFormatter();
  const requests = await listRequests();
  const pending = requests.filter((r) => r.status === 'pending');
  const decided = requests.filter((r) => r.status !== 'pending');

  async function approve(formData: FormData) {
    'use server';
    // Checked again here: a guard on the page is not a guard on the action.
    const session = await requirePlatformAdmin();
    const h = await headers();
    const origin =
      h.get('origin') ?? process.env.NEXT_PUBLIC_SITE_URL ?? `http://${h.get('host') ?? 'localhost:3000'}`;

    const result = await approveRequest(
      String(formData.get('id')),
      session.userId,
      `${origin}/${locale}/sign-in?mode=link`,
    );
    redirect(
      `/${locale}/admin/requests?${
        result.outcome === 'approved' ? `approved=${result.login}-${result.mail}` : 'approved=gone'
      }`,
    );
  }

  async function decline(formData: FormData) {
    'use server';
    const session = await requirePlatformAdmin();
    const result = await declineRequest(String(formData.get('id')), session.userId);
    redirect(`/${locale}/admin/requests?declined=${result.declined ? 'yes' : 'gone'}`);
  }

  const approved = one(sp.approved);
  const declined = one(sp.declined);
  const when = (d: Date) => format.dateTime(new Date(d), { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:max-w-3xl">
      <PageTitle caption={t('requestsIntro')}>{t('requests')}</PageTitle>

      {/* Says what actually happened to the two things that can fail
          independently of the approval itself. */}
      {approved && (
        <p role="status" className="bg-card rounded-lg border p-3 text-sm">
          {approved === 'gone'
            ? t('approvedGone')
            : approved.startsWith('created-sent') || approved.startsWith('exists-sent')
              ? t('approvedSent')
              : t('approvedPartly', { detail: approved })}
        </p>
      )}
      {declined && (
        <p role="status" className="bg-card rounded-lg border p-3 text-sm">
          {declined === 'yes' ? t('declinedDone') : t('approvedGone')}
        </p>
      )}

      <section className="flex flex-col gap-2">
        <SectionHeading>{t('pendingHeading', { count: pending.length })}</SectionHeading>
        {pending.length === 0 ? (
          <EmptyState icon={Inbox} title={t('noPending')} body={t('noPendingBody')} />
        ) : (
          <ul className="bg-card divide-border divide-y overflow-hidden rounded-xl border">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-base font-semibold">{r.shopName}</span>
                  <span className="text-muted-foreground truncate text-sm">
                    {r.contactName} · {r.email} · {r.countryCode}
                  </span>
                  <span className="text-muted-foreground text-xs tabular-nums">{when(r.createdAt)}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <form action={approve}>
                    <input type="hidden" name="id" value={r.id} />
                    <Button type="submit" className="h-11">
                      {t('approve')}
                    </Button>
                  </form>
                  <form action={decline}>
                    <input type="hidden" name="id" value={r.id} />
                    <Button type="submit" variant="outline" className="text-destructive h-11">
                      {t('decline')}
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {decided.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionHeading>{t('decidedHeading')}</SectionHeading>
          <ul className="bg-card divide-border divide-y overflow-hidden rounded-xl border">
            {decided.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold">{r.shopName}</span>
                  <span className="text-muted-foreground truncate text-xs">{r.email}</span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {r.decidedAt && (
                    <span className="text-muted-foreground text-xs tabular-nums">{when(r.decidedAt)}</span>
                  )}
                  <Badge variant={r.status === 'approved' ? 'outline' : 'secondary'}>
                    {t(`statuses.${r.status}`)}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
