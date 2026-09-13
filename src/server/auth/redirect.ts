/**
 * Where a sign-in or reset link may send someone once it has signed them in.
 *
 * `next` rides in a link, and a link is something anyone can craft. Resolved
 * naively — `new URL(next, origin)` — an absolute `https://evil.example` wins
 * over the origin, and so does `//evil.example`, the same trick without a
 * scheme. A genuine email from this app with a doctored `next` would then hand
 * a freshly signed-in person straight to someone else's page, which is the
 * shape of a phishing link that passes every "is this really from them?" check.
 *
 * So only a path on this site is accepted, and anything else falls back.
 * Pure, so it can be tested without a request.
 */
export function safeRedirectPath(raw: string | null, origin: string, fallback: string): string {
  // A backslash counts as a slash to browsers, so `/\evil.example` is `//`.
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  try {
    const url = new URL(raw, origin);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}
