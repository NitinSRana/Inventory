import { getTranslations, setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/server';

export default async function SignInPage({ params, searchParams }: PageProps<'/[locale]/sign-in'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { sent, error } = await searchParams;
  const t = await getTranslations('signIn');

  async function sendLink(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim();
    if (!email) redirect(`/${locale}/sign-in?error=1`);

    const origin = (await headers()).get('origin') ?? '';
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${origin}/auth/confirm?next=/${locale}` },
    });

    redirect(`/${locale}/sign-in?${error ? 'error=1' : 'sent=1'}`);
  }

  return (
    // Primary action sits in the bottom third: this is used one-handed on a phone.
    <main className="flex flex-1 flex-col justify-end gap-8 p-6 sm:justify-center">
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
              {t('error')}
            </p>
          )}

          <Button type="submit" className="h-11 w-full">
            {t('submit')}
          </Button>
        </form>
      )}
    </main>
  );
}
