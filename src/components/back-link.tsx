import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

/**
 * Back to the screen that owns this one.
 *
 * An explicit destination rather than history.back(): people arrive at these
 * screens from a scan, a link or a refresh, and "back" then means somewhere
 * they have never been. Naming the parent is always right.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      // Blue, as the redesign draws it: a link is where you can go.
      className="text-link -ml-2 inline-flex h-11 items-center gap-2 self-start pr-3 pl-2 text-sm font-semibold"
    >
      <ArrowLeft aria-hidden className="size-4" />
      {label}
    </Link>
  );
}
