import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { BackLink } from '@/components/back-link';
import { PageTitle } from '@/components/data-list';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
} from '@/server/auth/team';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

const ROLES = Object.keys(ROLE_RANK) as Role[];

export default async function TeamPage({ params, searchParams }: PageProps<'/[locale]/settings/team'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { error, invited } = await searchParams;
  const t = await getTranslations('team');
  const tBack = await getTranslations('back');
  // Changing who can do what is an owner decision.
  const { orgId, userId } = await requireRole(locale, 'owner');

  const [members, invitations] = await Promise.all([
    listMembers(orgId),
    listPendingInvitations(orgId),
  ]);

  async function invite(formData: FormData) {
    'use server';
    const { orgId, userId } = await requireRole(locale, 'owner');
    try {
      await inviteMember(orgId, {
        email: String(formData.get('email') ?? ''),
        role: String(formData.get('role') ?? 'staff') as Role,
        invitedBy: userId,
      });
    } catch {
      redirect(`/${locale}/settings/team?error=invalidEmail`);
    }
    redirect(`/${locale}/settings/team?invited=1`);
  }

  async function revoke(formData: FormData) {
    'use server';
    const { orgId } = await requireRole(locale, 'owner');
    await revokeInvitation(orgId, String(formData.get('invitationId')));
    redirect(`/${locale}/settings/team`);
  }

  async function setRole(formData: FormData) {
    'use server';
    const { orgId } = await requireRole(locale, 'owner');
    try {
      await changeMemberRole(orgId, String(formData.get('memberId')), String(formData.get('role')) as Role);
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

  const selectClass = 'border-input h-11 rounded-lg border bg-transparent px-3 text-sm';

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-28">
      <BackLink href={`/${locale}/more`} label={tBack('more')} />
      <PageTitle caption={t('intro')}>{t('title')}</PageTitle>

      {invited && (
        <p role="status" className="text-sm">
          {t('invitedNote')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {t(`errors.${error}`)}
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">{t('membersTitle', { count: members.length })}</h2>
        <ul className="flex flex-col gap-2">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
              <span className="font-mono text-xs">
                {m.userId === userId ? t('you') : m.userId.slice(0, 8)}
              </span>
              <div className="flex items-center gap-2">
                <form action={setRole} className="flex items-center gap-2">
                  <input type="hidden" name="memberId" value={m.id} />
                  <label htmlFor={`role-${m.id}`} className="sr-only">
                    {t('roleLabel')}
                  </label>
                  <select id={`role-${m.id}`} name="role" defaultValue={m.role} className={selectClass}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {t(`roles.${r}`)}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" variant="outline" className="h-11">
                    {t('save')}
                  </Button>
                </form>
                <form action={remove}>
                  <input type="hidden" name="memberId" value={m.id} />
                  <Button type="submit" variant="outline" className="h-11">
                    {t('remove')}
                  </Button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {invitations.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">{t('pendingTitle', { count: invitations.length })}</h2>
          <ul className="flex flex-col gap-2">
            {invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm">{i.email}</span>
                  <span className="text-muted-foreground text-xs">{t(`roles.${i.role}`)}</span>
                </div>
                <form action={revoke}>
                  <input type="hidden" name="invitationId" value={i.id} />
                  <Button type="submit" variant="outline" className="h-11">
                    {t('revoke')}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form action={invite} className="flex flex-col gap-4 border-t pt-6">
        <h2 className="text-lg font-medium">{t('inviteTitle')}</h2>
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">{t('emailLabel')}</Label>
          <Input id="email" name="email" type="email" autoComplete="off" required className="h-12" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="role">{t('roleLabel')}</Label>
          <select id="role" name="role" defaultValue="staff" className={selectClass}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-xs">{t('roleHint')}</p>
        </div>
        <Button type="submit" className="fixed inset-x-4 bottom-20 sm:bottom-6 h-12 sm:static sm:w-fit">
          {t('invite')}
        </Button>
      </form>
    </main>
  );
}
