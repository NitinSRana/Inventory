import { getTranslations, setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Plus } from 'lucide-react';

import { BackLink } from '@/components/back-link';
import { PageTitle, SectionHeading } from '@/components/data-list';
import { Field, NativeSelect } from '@/components/form';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { invitationEmail } from '@/server/email/invitation';
import { mailIsConfigured, sendEmail } from '@/server/email/send';
import { requireRole } from '@/server/auth/session';
import { ROLE_RANK, type Role } from '@/server/auth/roles';
import {
  LastOwnerError,
  changeMemberRole,
  inviteMember,
  listMembers,
  listPendingInvitations,
  removeMember,
  revokeInvitation,
  setMemberDisplayName,
} from '@/server/auth/team';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

const ROLES = Object.keys(ROLE_RANK) as Role[];

/**
 * Laid out as the "Team Management" frame: the invitation card first, then
 * active members with their role, then pending invitations.
 *
 * Departures: role badges are neutral, not red/amber/blue — colour here means
 * expiry. The frame's ⋮ menu per member is a native "Edit" disclosure holding
 * the name, role and Remove, so it needs no client JS. The frame's Cancel and
 * Resend have nothing behind them (an invitation is a row; there is no send
 * queue to retry), so they are not drawn. Members show a name, not an email:
 * the app never reads anyone's sign-in address into the shop's own tables.
 */
export default async function TeamPage({ params, searchParams }: PageProps<'/[locale]/settings/team'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { error, invited } = await searchParams;
  const mailConfigured = mailIsConfigured();
  const t = await getTranslations('team');
  const tBack = await getTranslations('back');
  // Changing who can do what is an owner decision.
  const { orgId, userId } = await requireRole(locale, 'owner');

  const [members, invitations] = await Promise.all([listMembers(orgId), listPendingInvitations(orgId)]);

  async function invite(formData: FormData) {
    'use server';
    const { orgId, userId, email: inviterEmail } = await requireRole(locale, 'owner');
    const address = String(formData.get('email') ?? '');
    try {
      await inviteMember(orgId, {
        email: address,
        role: String(formData.get('role') ?? 'staff') as Role,
        invitedBy: userId,
      });
    } catch {
      redirect(`/${locale}/settings/team?error=invalidEmail`);
    }

    // The row is what grants access; the email is how the person finds out.
    // So a mail failure must not undo the invitation — but it must be said
    // out loud, or the owner waits for someone who was never told.
    const [org] = await withTenant(orgId, (tx) => tx.select().from(organizations));
    const h = await headers();
    const origin =
      h.get('origin') ?? process.env.NEXT_PUBLIC_SITE_URL ?? `http://${h.get('host') ?? 'localhost:3000'}`;

    const result = await sendEmail({
      to: address.trim().toLowerCase(),
      ...invitationEmail({
        organizationName: org.name,
        signInUrl: `${origin}/${locale}/sign-in`,
        invitedByEmail: inviterEmail,
      }),
    });

    redirect(`/${locale}/settings/team?invited=${result.status}`);
  }

  async function revoke(formData: FormData) {
    'use server';
    const { orgId } = await requireRole(locale, 'owner');
    await revokeInvitation(orgId, String(formData.get('invitationId')));
    redirect(`/${locale}/settings/team`);
  }

  /**
   * One Save per member, covering both things about them that are editable.
   * The name goes first because it can never fail — a rejected role change must
   * not silently discard a name the owner just typed.
   */
  async function saveMember(formData: FormData) {
    'use server';
    const { orgId } = await requireRole(locale, 'owner');
    const memberId = String(formData.get('memberId'));
    await setMemberDisplayName(orgId, memberId, String(formData.get('displayName') ?? ''));
    try {
      await changeMemberRole(orgId, memberId, String(formData.get('role')) as Role);
    } catch (e) {
      redirect(`/${locale}/settings/team?error=${e instanceof LastOwnerError ? 'lastOwner' : 'unknown'}`);
    }
    redirect(`/${locale}/settings/team`);
  }

  async function remove(formData: FormData) {
    'use server';
    const { orgId } = await requireRole(locale, 'owner');
    try {
      await removeMember(orgId, String(formData.get('memberId')));
    } catch (e) {
      redirect(`/${locale}/settings/team?error=${e instanceof LastOwnerError ? 'lastOwner' : 'unknown'}`);
    }
    redirect(`/${locale}/settings/team`);
  }

  return (
    <main className="flex flex-1 flex-col gap-5 p-4 md:max-w-2xl">
      <BackLink href={`/${locale}/more`} label={tBack('more')} />
      <div className="flex items-center justify-between gap-3">
        <PageTitle caption={t('intro')}>{t('title')}</PageTitle>
        <a href="#invite" className={buttonVariants({ className: 'h-11 shrink-0 gap-1.5' })}>
          <Plus aria-hidden className="size-4" />
          {t('inviteShort')}
        </a>
      </div>

      {/* Three different things can have happened, and telling the owner the
          wrong one costs a new member their first day. */}
      {invited === 'sent' && (
        <p role="status" className="bg-card rounded-lg border p-3 text-sm">
          {t('invitedSent')}
        </p>
      )}
      {invited === 'notConfigured' && (
        <p role="status" className="bg-card flex flex-col gap-1 rounded-lg border p-3 text-sm">
          <span>{t('invitedNoMail')}</span>
          <span className="text-muted-foreground">{t('invitedNoMailHint')}</span>
        </p>
      )}
      {invited === 'failed' && (
        <p role="alert" className="bg-card flex flex-col gap-1 rounded-lg border p-3 text-sm">
          <span className="text-destructive">{t('invitedMailFailed')}</span>
          <span className="text-muted-foreground">{t('invitedNoMailHint')}</span>
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {t(`errors.${error}`)}
        </p>
      )}

      <form id="invite" action={invite} className="bg-card flex scroll-mt-20 flex-col gap-4 rounded-xl border p-4">
        <h2 className="text-base font-bold">{t('inviteTitle')}</h2>
        {/* Said before they type, not after: an owner who knows no mail goes out
            will tell the person themselves rather than waiting on an inbox. */}
        {!mailConfigured && <p className="text-muted-foreground text-sm">{t('noMailProvider')}</p>}
        <Field name="email" label={t('emailLabel')} required>
          <Input id="email" name="email" type="email" autoComplete="off" required className="h-12" />
        </Field>
        <Field name="role" label={t('roleLabel')} hint={t('roleHint')}>
          <NativeSelect id="role" name="role" defaultValue="staff" className="w-full">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Button type="submit" className="h-12 w-full sm:w-fit sm:px-8">
          {t('invite')}
        </Button>
      </form>

      <section className="flex flex-col gap-2">
        <SectionHeading>{t('membersTitle', { count: members.length })}</SectionHeading>
        <ul className="bg-card divide-border divide-y overflow-hidden rounded-xl border">
          {members.map((m) => {
            const me = m.userId === userId;
            return (
              <li key={m.id} className="flex flex-col px-4 py-3">
                <div className="flex min-h-11 items-center justify-between gap-3">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-base font-semibold">
                      {/* The user id stands in until someone types a name: it is
                          what tells two people apart before anyone has. */}
                      {m.displayName ?? <span className="font-mono text-sm">{m.userId.slice(0, 8)}</span>}
                    </span>
                    {me && <span className="text-muted-foreground text-xs italic">{t('youSuffix')}</span>}
                  </span>
                  <Badge variant="outline" className="shrink-0 uppercase">
                    {t(`roles.${m.role}`)}
                  </Badge>
                </div>
                <details className="group">
                  <summary className="text-link inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold">
                    {t('edit')}
                  </summary>
                  <div className="flex flex-col gap-3 pb-1">
                    <form action={saveMember} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="memberId" value={m.id} />
                      <label htmlFor={`name-${m.id}`} className="flex flex-col gap-1 text-sm font-medium">
                        {t('nameLabel')}
                        <Input
                          id={`name-${m.id}`}
                          name="displayName"
                          defaultValue={m.displayName ?? ''}
                          placeholder={t('namePlaceholder')}
                          className="h-11 w-44"
                        />
                      </label>
                      <label htmlFor={`role-${m.id}`} className="flex flex-col gap-1 text-sm font-medium">
                        {t('roleLabel')}
                        <NativeSelect id={`role-${m.id}`} name="role" defaultValue={m.role} className="h-11">
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {t(`roles.${r}`)}
                            </option>
                          ))}
                        </NativeSelect>
                      </label>
                      <Button type="submit" variant="outline" className="h-11">
                        {t('save')}
                      </Button>
                    </form>
                    <form action={remove}>
                      <input type="hidden" name="memberId" value={m.id} />
                      <Button type="submit" variant="ghost" className="text-destructive h-11 px-0">
                        {t('remove')}
                      </Button>
                    </form>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
        <p className="text-muted-foreground text-xs">{t('membersHint')}</p>
      </section>

      {invitations.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionHeading>{t('pendingTitle', { count: invitations.length })}</SectionHeading>
          <ul className="bg-card divide-border divide-y overflow-hidden rounded-xl border">
            {invitations.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold">{i.email}</span>
                  <span className="text-muted-foreground text-xs">
                    {t('pending')} • {t(`roles.${i.role}`)}
                  </span>
                </div>
                <form action={revoke}>
                  <input type="hidden" name="invitationId" value={i.id} />
                  <Button type="submit" variant="outline" className="text-destructive h-11">
                    {t('revoke')}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
