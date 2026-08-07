import { defineRouting } from 'next-intl/routing';

// English only at launch. The routing still prefixes every URL with the locale
// so adding German later is a messages file, not a URL migration.
export const routing = defineRouting({
  locales: ['en'],
  defaultLocale: 'en',
});
