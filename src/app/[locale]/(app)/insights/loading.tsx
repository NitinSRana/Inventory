import { DataListSkeleton } from '@/components/data-list';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Mirrors the real page's four cards — margin, takings with a chart, top
 * products, dead stock — rather than the generic list fallback, which has
 * nothing in common with a charts-and-figures screen.
 */
export default function InsightsLoading() {
  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-24">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-48" />
      </div>

      <div className="flex gap-2">
        <Skeleton className="h-11 w-20" />
        <Skeleton className="h-11 w-20" />
        <Skeleton className="h-11 w-20" />
      </div>

      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-4 w-40" />
      </section>

      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-24 w-full" />
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-32 w-full" />
        </section>
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <Skeleton className="h-3 w-20" />
          <DataListSkeleton rows={4} />
        </section>
      </div>
    </main>
  );
}
