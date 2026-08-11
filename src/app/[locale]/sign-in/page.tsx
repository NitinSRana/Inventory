import { getTranslations, setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/server';
import {
  SIGN_IN_PER_CLIENT,
  SIGN_IN_PER_EMAIL,
  checkRateLimit,
  hashedBucket,
} from '@/server/auth/rate-limit';

export default async function SignInPage({ params, searchParams }: PageProps<'/[locale]/sign-in'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { sent, error } = await searchParams;
  const t = await getTranslations('signIn');

  async function sendLink(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim();
    if (!email) redirect(`/${locale}/sign-in?error=1`);

    // `origin` is absent on some proxied requests; the env var is the fallback.
    const h = await headers();
    const origin =
      h.get('origin') ??
      process.env.NEXT_PUBLIC_SITE_URL ??
      `http://${h.get('host') ?? 'localhost:3000'}`;

    // Throttled before a single mail is sent. Two buckets: the address, so
    // nobody can flood a stranger's inbox, and the client, so nobody can walk a
    // list of addresses a few attempts each.
    const client = h.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const [emailOk, clientOk] = await Promise.all([
      checkRateLimit(await hashedBucket('signin-email', email), SIGN_IN_PER_EMAIL),
      checkRateLimit(await hashedBucket('signin-client', client), SIGN_IN_PER_CLIENT),
    ]);
    if (!emailOk || !clientOk) {
      // Same response whether the address exists or not — a throttle that says
      // "too many attempts for this account" confirms the account.
      redirect(`/${locale}/sign-in?error=throttled`);
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${origin}/auth/confirm?next=/${locale}` },
    });

    redirect(`/${locale}/sign-in?${error ? 'error=1' : 'sent=1'}`);
  }

  return (
    // On a phone: full width, action in the bottom third, one-handed.
    // On anything wider: a centred column, because a form field stretched across
    // 1900px is unreadable and looks broken.
    <main className="flex flex-1 flex-col justify-end p-6 sm:items-center sm:justify-center">
      <div className="flex w-full max-w-sm flex-col gap-8 sm:rounded-xl sm:border sm:p-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </div>

      {sent ? (
        <p role="status" className="text-sm">
          {t('sent')}
        </p>
      ) : (
        <form action={sendLink} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">{t('emailLabel')}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="h-11"
            />
          </div>

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error === 'throttled' ? t('throttled') : t('error')}
              {/* Supabase's own message, shown only for genuine failures — a
                  throttle must not leak whether the address exists. */}
              {error !== '1' && error !== 'throttled' && (
                <span className="block font-mono text-xs">{error}</span>
              )}
            </p>
          )}

          <Button type="submit" className="h-12 w-full">
            {t('submit')}
          </Button>
        </form>
      )}
      </div>
    </main>
  );
}
