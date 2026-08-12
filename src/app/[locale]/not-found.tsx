import AppNotFound from './(app)/not-found';

/**
 * A mistyped URL under a valid locale — `/en/prodcuts` — matches no route at
 * all, so it never reaches the (app) group and would otherwise get Next's bare
 * default page: unstyled, unlocalised, and with no way back.
 *
 * Same screen either way; the group's copy is the one that renders when a page
 * inside the shell calls notFound() for a row that does not exist.
 */
export default function LocaleNotFound() {
  return <AppNotFound />;
}
