import { createServerClient } from '@supabase/ssr';
import createIntlMiddleware from 'next-intl/middleware';
import type { NextRequest } from 'next/server';

import { routing } from './i18n/routing';

const handleI18n = createIntlMiddleware(routing);

export default async function proxy(request: NextRequest) {
  // next-intl owns the response so the locale redirect/rewrite survives; the
  // refreshed auth cookies are written onto it below.
  const response = handleI18n(request);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // Rotates an expired token and writes the new cookies onto `response`. Without
  // this call every Server Component sees a stale session.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // Everything except Next internals and files with an extension.
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
