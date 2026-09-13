import { getTranslations, setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PageTitle } from '@/components/data-list';
import { Field } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/server';
import {
  PASSWORD_RESET_PER_CLIENT,
  PASSWORD_RESET_PER_EMAIL,
  checkRateLimit,
  hashedBucket,
} from '@/server/auth/rate-limit';

/**
 * Asking for a password-reset email.
 *
 * The sign-in frame in the Figma redesign has "Forgot Password?"; no frame draws
 * what it opens, so this follows the sign-in screen's own layout.
 *
 * It says the same thing whether or not the address has an account. Anything
 * else turns this form into a way to find out who works at a shop — the same
 * reasoning as the magic-link form, and checked by e2e/access.spec.ts.
 */
export default async function ForgotPasswordPage({
  params,
  searchParams,
}: PageProps<'/[locale]/sign-in/forgot'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { sent, error } = await searchParams;
  const t = await getTranslations('signIn');

  async function send(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim();
    if (!email) redirect(`/${locale}/sign-in/forgot?error=1`);

    const h = await headers();
    const origin =
      h.get('origin') ??
      process.env.NEXT_PUBLIC_SITE_URL ??
      `http://${h.get('host') ?? 'localhost:3000'}`;

    // Its own buckets, not the sign-in ones: a reset email is a mail send like
    // the magic link, and someone locked out of signing in must still be able
    // to ask for one.
    const client = h.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const checks = await Promise.all([
      checkRateLimit(await hashedBucket('reset-email', email), PASSWORD_RESET_PER_EMAIL),
      checkRateLimit(await hashedBucket('reset-client', client), PASSWORD_RESET_PER_CLIENT),
    ]);
    if (checks.includes('unavailable')) redirect(`/${locale}/sign-in/forgot?error=unavailable`);
    if (checks.includes('limited')) redirect(`/${locale}/sign-in/forgot?error=throttled`);

    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(`/${locale}/sign-in/reset-password`)}`,
    });
    // Logged for whoever runs the shop's account, never shown: a failure that
    // only happens for real accounts would tell a stranger which ones exist.
    if (error) console.error('Password reset request failed:', error.message);

    redirect(`/${locale}/sign-in/forgot?sent=1`);
  }

  return (
    <main className="flex flex-1 flex-col justify-end p-6 sm:items-center sm:justify-center">
      <div className="flex w-full max-w-sm flex-col gap-8 sm:rounded-xl sm:border sm:p-8">
        <PageTitle caption={t('forgotIntro')}>{t('forgotTitle')}</PageTitle>

        {sent ? (
          <div className="flex flex-col gap-2">
            <p role="status" className="text-sm">
              {t('resetSent')}
            </p>
            <p className="text-muted-foreground text-sm">{t('sentHint')}</p>
          </div>
        ) : (
          <form action={send} className="flex flex-col gap-4">
            <Field name="email" label={t('emailLabel')}>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="h-12"
              />
            </Field>

            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error === 'throttled'
                  ? t('throttled')
                  : error === 'unavailable'
                    ? t('unavailable')
                    : t('error')}
              </p>
            )}

            <Button type="submit" className="h-12 w-full">
              {t('resetSubmit')}
            </Button>
          </form>
        )}

        <Link
          href={`/${locale}/sign-in`}
          className="text-link inline-flex min-h-11 items-center text-sm font-semibold"
        >
          {t('backToSignIn')}
        </Link>
      </div>
    </main>
  );
}
