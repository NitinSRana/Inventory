import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { LogOut, ShieldCheck } from 'lucide-react';

import { signOut } from '@/app/[locale]/(app)/actions';
import { requirePlatformAdmin } from '@/server/platform/admins';

/**
 * The platform owner's area, deliberately outside the (app) route group.
 *
 * That shell names the shop you are in and navigates a tenant; this person may
 * belong to no shop at all, and what they are looking at is every shop. Sharing
 * the layout would mean teaching it to render without an organization, which is
 * a worse trade than a plain header.
 *
 * Guarded here and again inside every action: a layout is not a permission.
 */
export default async function AdminLayout({
  children,
  params,
}: LayoutProps<'/[locale]/admin'>) {
  const { locale } = await params;
  const session = await requirePlatformAdmin();
  const t = await getTranslations('admin');

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-card flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-4 py-3">
        <span className="flex items-center gap-2 font-bold">
          <ShieldCheck aria-hidden className="size-5" />
          {t('title')}
        </span>
        <nav aria-label={t('title')} className="flex items-center gap-4 text-sm">
          <Link href={`/${locale}/admin`} className="inline-flex min-h-11 items-center font-medium">
            {t('shops')}
          </Link>
          <Link href={`/${locale}/admin/requests`} className="inline-flex min-h-11 items-center font-medium">
            {t('requests')}
          </Link>
        </nav>
        <span className="text-muted-foreground ml-auto flex items-center gap-3 text-sm">
          <span className="max-w-48 truncate">{session.email}</span>
          <form action={signOut.bind(null, locale)}>
            <button type="submit" aria-label={t('signOut')} className="flex size-11 items-center justify-center">
              <LogOut aria-hidden className="size-4" />
            </button>
          </form>
        </span>
      </header>
      {children}
    </div>
  );
}
