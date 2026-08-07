import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';
import { routing } from '@/i18n/routing';

/**
 * Where the magic link lands. Exchanges the token for a session cookie.
 *
 * Two shapes arrive here depending on the email template: `code` from the PKCE
 * flow (@supabase/ssr's default), or `token_hash` + `type` if the template has
 * been switched to {{ .TokenHash }}. Both are handled — which one you get is a
 * dashboard setting, not something the app should care about.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const next = searchParams.get('next') ?? `/${routing.defaultLocale}`;
  const supabase = await createClient();

  const code = searchParams.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
    return NextResponse.redirect(
      new URL(`/${routing.defaultLocale}/sign-in?error=${encodeURIComponent(error.message)}`, origin),
    );
  }

  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, origin));
    return NextResponse.redirect(
      new URL(`/${routing.defaultLocale}/sign-in?error=${encodeURIComponent(error.message)}`, origin),
    );
  }

  return NextResponse.redirect(
    new URL(`/${routing.defaultLocale}/sign-in?error=no-token`, origin),
  );
}
