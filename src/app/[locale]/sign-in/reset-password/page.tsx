import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { PageTitle } from '@/components/data-list';
import { Field } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/server';

// Reads the session a reset link created, so it must never be cached.
export const dynamic = 'force-dynamic';

const MIN_PASSWORD = 8;

/**
 * Choosing a new password, from a reset link.
 *
 * The link's own session is what authorises this: /auth/confirm exchanged the
 * recovery token for it and sent the person here. Without that session there
 * is nothing to reset, so the screen goes back to sign-in and says the link has
 * expired rather than showing a form that cannot work.
 *
 * Typed twice, because a mistyped password nobody can see is a lockout that the
 * next attempt will not explain.
 */
export default async function ResetPasswordPage({
  params,
  searchParams,
}: PageProps<'/[locale]/sign-in/reset-password'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { error } = await searchParams;
  const t = await getTranslations('signIn');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/sign-in?error=resetExpired`);

  async function save(formData: FormData) {
    'use server';
    const password = String(formData.get('password') ?? '');
    const confirm = String(formData.get('confirm') ?? '');
    if (password.length < MIN_PASSWORD) redirect(`/${locale}/sign-in/reset-password?error=short`);
    if (password !== confirm) redirect(`/${locale}/sign-in/reset-password?error=mismatch`);

    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) redirect(`/${locale}/sign-in/reset-password?error=failed`);

    // Already signed in by the link, so straight into the shop.
    redirect(`/${locale}`);
  }

  return (
    <main className="flex flex-1 flex-col justify-end p-6 sm:items-center sm:justify-center">
      <div className="flex w-full max-w-sm flex-col gap-8 sm:rounded-xl sm:border sm:p-8">
        <PageTitle caption={t('resetIntro', { min: MIN_PASSWORD })}>{t('resetTitle')}</PageTitle>

        <form action={save} className="flex flex-col gap-4">
          <Field name="password" label={t('newPasswordLabel')}>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD}
              required
              className="h-12"
            />
          </Field>
          <Field name="confirm" label={t('confirmPasswordLabel')}>
            <Input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD}
              required
              className="h-12"
            />
          </Field>

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error === 'short'
                ? t('resetShort', { min: MIN_PASSWORD })
                : error === 'mismatch'
                  ? t('resetMismatch')
                  : t('resetFailed')}
            </p>
          )}

          <Button type="submit" className="h-12 w-full">
            {t('saveNewPassword')}
          </Button>
        </form>
      </div>
    </main>
  );
}
