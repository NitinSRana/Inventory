import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';
import { routing } from '@/i18n/routing';
import { safeRedirectPath } from '@/server/auth/redirect';

/**
 * Where the magic link and the password-reset link land. Exchanges the token
 * for a session cookie, then sends the person on to `next`.
 *
 * Two shapes arrive here depending on the email template: `code` from the PKCE
 * flow (@supabase/ssr's default), or `token_hash` + `type` if the template has
 * been switched to {{ .TokenHash }}. Both are handled — which one you get is a
 * dashboard setting, not something the app should care about. A reset link is
 * `type=recovery` on the second shape and arrives exactly like a sign-in.
 *
 * `next` is only ever a path on this site: see safeRedirectPath for the open
 * redirect it used to be.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const next = safeRedirectPath(searchParams.get('next'), origin, `/${routing.defaultLocale}`);
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
