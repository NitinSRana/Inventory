import { readFileSync } from 'node:fs';

export const STORAGE_STATE = 'e2e/.auth/owner.json';

/**
 * The signed-in user's id, read out of the saved Playwright session.
 *
 * The tests need it to resolve which organization to assert against, and this
 * is the test reading its own cookie — not a way around anything. Supabase
 * splits a session cookie that exceeds the 4KB limit across `.0`, `.1`, so the
 * chunks are reassembled in order before decoding.
 */
export function signedInUserId(path = STORAGE_STATE): string {
  const state = JSON.parse(readFileSync(path, 'utf8')) as {
    cookies: { name: string; value: string }[];
  };

  const chunks = state.cookies
    .filter((c) => /-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (chunks.length === 0) throw new Error(`No Supabase session cookie in ${path}`);

  const raw = decodeURIComponent(chunks.map((c) => c.value).join('')).replace(/^base64-/, '');
  const { access_token } = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  const claims = JSON.parse(Buffer.from(access_token.split('.')[1], 'base64url').toString('utf8'));

  if (!claims.sub) throw new Error('Session token carries no subject');
  return claims.sub as string;
}
