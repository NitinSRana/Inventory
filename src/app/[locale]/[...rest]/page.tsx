import { notFound } from 'next/navigation';

/**
 * Catches any URL under a locale that matches no real route.
 *
 * Without it Next never enters the locale layout for an unmatched path, so a
 * mistyped `/en/prodcuts` fell through to the framework's bare default page —
 * unstyled, unlocalised, and with no way back. Routing it through notFound()
 * hands it to `[locale]/not-found.tsx` instead.
 */
export default function CatchAll() {
  notFound();
}
