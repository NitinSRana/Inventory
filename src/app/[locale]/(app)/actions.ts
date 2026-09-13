'use server';

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

/**
 * Signs the current person out.
 *
 * Shared, because the header that used to carry it is gone in the redesign:
 * a phone reaches it from the More screen and a desktop from the sidebar's
 * footer. Two copies of three lines is how one of them eventually forgets to
 * clear the session.
 */
export async function signOut(locale: string) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(`/${locale}`);
}
