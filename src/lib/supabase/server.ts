import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/** Supabase client for Server Components, server actions and route handlers. */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Components cannot set cookies. The middleware refreshes the
            // session on every request, so there is nothing to recover here.
          }
        },
      },
    },
  );
}
