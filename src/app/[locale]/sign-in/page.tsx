import { getTranslations, setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { PageTitle } from '@/components/data-list';
import { Field } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/server';
import {
  SIGN_IN_PASSWORD_PER_CLIENT,
  SIGN_IN_PASSWORD_PER_EMAIL,
  SIGN_IN_PER_CLIENT,
  SIGN_IN_PER_EMAIL,
  checkRateLimit,
  hashedBucket,
} from '@/server/auth/rate-limit';
import { signInOutcome } from '@/server/auth/sign-in';

export default async function SignInPage({ params, searchParams }: PageProps<'/[locale]/sign-in'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { sent, error } = await searchParams;
  const t = await getTranslations('signIn');

  /** The magic-link path. Still the only way a newly-invited member gets in
   * the first time — claiming an invitation happens on first sign-in, and a
   * password can't be set on an account until it exists. */
  async function sendLink(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim();
    if (!email) redirect(`/${locale}/sign-in?error=1`);

    const h = await headers();
    const origin =
      h.get('origin') ??
      process.env.NEXT_PUBLIC_SITE_URL ??
      `http://${h.get('host') ?? 'localhost:3000'}`;

    const client = h.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const [emailOk, clientOk] = await Promise.all([
      checkRateLimit(await hashedBucket('signin-email', email), SIGN_IN_PER_EMAIL),
      checkRateLimit(await hashedBucket('signin-client', client), SIGN_IN_PER_CLIENT),
    ]);
    if (!emailOk || !clientOk) redirect(`/${locale}/sign-in?error=throttled`);

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${origin}/auth/confirm?next=/${locale}` },
    });

    redirect(`/${locale}/sign-in?${signInOutcome(error)}`);
  }

  /**
   * Password sign-in. No mail server in the loop at all — set once (in the
   * Supabase dashboard, since there is no self-serve password-set flow yet),
   * works instantly and offline of any inbox from then on.
   */
  async function signInWithPassword(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    if (!email || !password) redirect(`/${locale}/sign-in?error=1`);

    const h = await headers();
    const client = h.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const [emailOk, clientOk] = await Promise.all([
      checkRateLimit(await hashedBucket('signin-password-email', email), SIGN_IN_PASSWORD_PER_EMAIL),
      checkRateLimit(await hashedBucket('signin-password-client', client), SIGN_IN_PASSWORD_PER_CLIENT),
    ]);
    if (!emailOk || !clientOk) redirect(`/${locale}/sign-in?error=throttled`);

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    // One message for "no such account" and "wrong password", same as any
    // password form — distinguishing them is exactly the enumeration leak
    // isUnknownAddress exists to close on the magic-link side.
    if (error) redirect(`/${locale}/sign-in?error=password`);
    redirect(`/${locale}`);
  }

  return (
    // On a phone: full width, action in the bottom third, one-handed.
    // On anything wider: a centred column, because a form field stretched across
    // 1900px is unreadable and looks broken.
    <main className="flex flex-1 flex-col justify-end p-6 sm:items-center sm:justify-center">
      <div className="flex w-full max-w-sm flex-col gap-8 sm:rounded-xl sm:border sm:p-8">
        <PageTitle caption={t('subtitle')}>{t('title')}</PageTitle>

        {sent ? (
          // Deliberately non-committal about whether that address is a member.
          // The hint underneath explains the silence, so someone who mistyped is
          // not left waiting on mail that will never come.
          <div className="flex flex-col gap-2">
            <p role="status" className="text-sm">
              {t('sent')}
            </p>
            <p className="text-muted-foreground text-sm">{t('sentHint')}</p>
          </div>
        ) : (
          <form className="flex flex-col gap-4">
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

            <Field name="password" label={t('passwordLabel')} hint={t('passwordHint')}>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                className="h-12"
              />
            </Field>

            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error === 'throttled'
                  ? t('throttled')
                  : error === 'password'
                    ? t('passwordError')
                    : t('error')}
              </p>
            )}

            <div className="flex flex-col gap-3">
              <Button type="submit" formAction={signInWithPassword} className="h-12 w-full">
                {t('submit')}
              </Button>
              <Button
                type="submit"
                formAction={sendLink}
                variant="outline"
                className="h-12 w-full"
              >
                {t('sendLink')}
              </Button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
