import { getTranslations, setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Boxes } from 'lucide-react';

import { Field } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/server';
import {
  SIGN_IN_PASSWORD_PER_CLIENT,
  SIGN_IN_PASSWORD_PER_EMAIL,
  checkRateLimit,
  hashedBucket,
} from '@/server/auth/rate-limit';

/**
 * One way in: email and password.
 *
 * There was a magic-link tab beside this. It existed because an invited person
 * had no password yet and nothing else could let them in — but both invitation
 * emails now carry a link that signs them in and asks them to choose one, so
 * the tab served nobody and quietly depended on Supabase's own mail, the least
 * reliable part of the system. A forgotten password is handled by Forgot
 * password, which is the same mechanism and is where people look for it.
 *
 * Two things in the frame are not built: "Remember device" (the session already
 * persists until sign-out; a box that changes nothing would be a lie) and
 * "Trusted by 12,000+ stores" (not true of this product).
 */
export default async function SignInPage({ params, searchParams }: PageProps<'/[locale]/sign-in'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { error } = await searchParams;
  const t = await getTranslations('signIn');
  const tApp = await getTranslations('app');

  /**
   * Password sign-in. No mail server in the loop at all — works instantly and
   * offline of any inbox. A forgotten password is reset by email from the
   * Forgot password screen.
   */
  async function signInWithPassword(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    if (!email || !password) redirect(`/${locale}/sign-in?error=1`);

    const h = await headers();
    const client = h.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const checks = await Promise.all([
      checkRateLimit(await hashedBucket('signin-password-email', email), SIGN_IN_PASSWORD_PER_EMAIL),
      checkRateLimit(await hashedBucket('signin-password-client', client), SIGN_IN_PASSWORD_PER_CLIENT),
    ]);
    if (checks.includes('unavailable')) redirect(`/${locale}/sign-in?error=unavailable`);
    if (checks.includes('limited')) redirect(`/${locale}/sign-in?error=throttled`);

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    // One message for "no such account" and "wrong password", same as any
    // password form. Distinguishing them would tell a stranger which addresses
    // are on the platform, which is the same leak the request form refuses.
    if (error) redirect(`/${locale}/sign-in?error=password`);
    redirect(`/${locale}`);
  }

  const errorText =
    error === 'throttled'
      ? t('throttled')
      : error === 'unavailable'
        ? t('unavailable')
        : error === 'password'
          ? t('passwordError')
          : error === 'resetExpired'
            ? t('resetExpired')
            : error
              ? t('error')
              : null;

  return (
    // On a phone: full width, the form in the lower part of the screen where a
    // thumb reaches. On anything wider: a centred column.
    <main className="flex flex-1 flex-col justify-center gap-8 p-6 sm:items-center">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="bg-primary text-primary-foreground flex size-14 items-center justify-center rounded-xl">
            <Boxes aria-hidden className="size-7" />
          </span>
          <p className="text-3xl font-bold tracking-tight">{tApp('name')}</p>
          <p className="text-muted-foreground text-sm">{t('tagline')}</p>
        </div>

        {/* The page's heading for screen readers and tests; the brand above is
            what the eye lands on. */}
        <h1 className="sr-only">{t('title')}</h1>

        <form action={signInWithPassword} className="flex flex-col gap-4">
          <Field name="email" label={t('emailLabel')}>
            <Input id="email" name="email" type="email" autoComplete="email" required className="h-12" />
          </Field>
          <Field name="password" label={t('passwordLabel')}>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="h-12"
            />
          </Field>
          {/* Where the frame puts it, beside the password. 44px tall: a phone
              is where people most often find they have forgotten. */}
          <Link
            href={`/${locale}/sign-in/forgot`}
            className="text-link -mt-2 inline-flex min-h-11 items-center self-end text-sm font-semibold"
          >
            {t('forgotLink')}
          </Link>
          {errorText && (
            <p role="alert" className="text-destructive text-sm">
              {errorText}
            </p>
          )}
          <Button type="submit" className="h-12 w-full">
            {t('submit')}
          </Button>
        </form>

        <section className="bg-card flex flex-col gap-1 rounded-xl border p-4">
          <h2 className="text-sm font-bold">{t('inviteOnlyTitle')}</h2>
          <p className="text-muted-foreground text-sm">{t('inviteOnlyBody')}</p>
          <Link
            href={`/${locale}/request-access`}
            className="text-link inline-flex min-h-11 items-center text-sm font-semibold"
          >
            {t('requestAccessLink')}
          </Link>
        </section>
      </div>
    </main>
  );
}
