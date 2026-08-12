import { DataListSkeleton } from '@/components/data-list';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Shared fallback for every signed-in screen.
 *
 * The skeleton is the real list's own geometry — one bordered container, hairline
 * dividers, 56px two-column rows — not a stack of grey blocks. A placeholder
 * that does not match what replaces it causes the layout to jump on arrival,
 * and that jump is what makes a fast app feel slow.
 */
export default function AppLoading() {
  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <Skeleton className="h-8 w-40" />
      <DataListSkeleton />
    </main>
  );
}
