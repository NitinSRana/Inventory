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
  SIGN_IN_PER_CLIENT,
  SIGN_IN_PER_EMAIL,
  checkRateLimit,
  hashedBucket,
} from '@/server/auth/rate-limit';
import { signInOutcome } from '@/server/auth/sign-in';

/**
 * Laid out as the sign-in frame: the app's mark and name, Password | Magic link
 * tabs, the form for the chosen one, and a note that accounts come by
 * invitation.
 *
 * The tabs are links (`?mode=link`), so each mode is a URL and needs no client
 * JS. Two things in the frame are not built: "Remember device" (the session
 * already persists until sign-out; a box that changes nothing would be a lie)
 * and "Trusted by 12,000+ stores" (not true of this product).
 */
export default async function SignInPage({ params, searchParams }: PageProps<'/[locale]/sign-in'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { sent, error, mode } = await searchParams;
  const byLink = mode === 'link';
  const t = await getTranslations('signIn');
  const tApp = await getTranslations('app');

  /** The magic-link path. Still the only way a newly-invited member gets in
   * the first time — claiming an invitation happens on first sign-in, and a
   * password can't be set on an account until it exists. */
  async function sendLink(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim();
    if (!email) redirect(`/${locale}/sign-in?mode=link&error=1`);

    const h = await headers();
    const origin =
      h.get('origin') ??
      process.env.NEXT_PUBLIC_SITE_URL ??
      `http://${h.get('host') ?? 'localhost:3000'}`;

    const client = h.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const checks = await Promise.all([
      checkRateLimit(await hashedBucket('signin-email', email), SIGN_IN_PER_EMAIL),
      checkRateLimit(await hashedBucket('signin-client', client), SIGN_IN_PER_CLIENT),
    ]);
    // Both refuse, but a check that could not run is our fault and does not
    // clear by waiting — telling someone to wait is a dead end there.
    if (checks.includes('unavailable')) redirect(`/${locale}/sign-in?mode=link&error=unavailable`);
    if (checks.includes('limited')) redirect(`/${locale}/sign-in?mode=link&error=throttled`);

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${origin}/auth/confirm?next=/${locale}` },
    });

    redirect(`/${locale}/sign-in?mode=link&${signInOutcome(error)}`);
  }

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
    // password form — distinguishing them is exactly the enumeration leak
    // isUnknownAddress exists to close on the magic-link side.
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

  const tab = (active: boolean) =>
    `flex min-h-11 items-center justify-center rounded-md px-3 text-sm ${
      active ? 'bg-card text-foreground font-semibold shadow-sm' : 'text-muted-foreground'
    }`;

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

        <nav aria-label={t('modesLabel')} className="bg-muted grid grid-cols-2 gap-1 rounded-lg border p-1">
          <Link href={`/${locale}/sign-in`} aria-current={byLink ? undefined : 'page'} className={tab(!byLink)}>
            {t('modePassword')}
          </Link>
          <Link href={`/${locale}/sign-in?mode=link`} aria-current={byLink ? 'page' : undefined} className={tab(byLink)}>
            {t('modeLink')}
          </Link>
        </nav>

        {sent ? (
          // Deliberately non-committal about whether that address is a member.
          // The hint underneath explains the silence, so someone who mistyped is
          // not left waiting on mail that will never come.
          <div className="bg-card flex flex-col gap-2 rounded-xl border p-4">
            <p role="status" className="text-sm">
              {t('sent')}
            </p>
            <p className="text-muted-foreground text-sm">{t('sentHint')}</p>
          </div>
        ) : byLink ? (
          <form action={sendLink} className="flex flex-col gap-4">
            <Field name="email" label={t('emailLabel')} hint={t('linkHint')}>
              <Input id="email" name="email" type="email" autoComplete="email" required className="h-12" />
            </Field>
            {errorText && (
              <p role="alert" className="text-destructive text-sm">
                {errorText}
              </p>
            )}
            <Button type="submit" className="h-12 w-full">
              {t('sendLink')}
            </Button>
          </form>
        ) : (
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
        )}

        <section className="bg-card flex flex-col gap-1 rounded-xl border p-4">
          <h2 className="text-sm font-bold">{t('inviteOnlyTitle')}</h2>
          <p className="text-muted-foreground text-sm">{t('inviteOnlyBody')}</p>
        </section>
      </div>
    </main>
  );
}
