import { DataListSkeleton } from '@/components/data-list';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Mirrors the real page: title, search field, then the list — not the generic
 * group-level fallback, which has no search bar and jumps when the real one
 * arrives.
 */
export default function ProductsLoading() {
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 pb-24">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-11 w-full" />
      <DataListSkeleton />
    </main>
  );
}
