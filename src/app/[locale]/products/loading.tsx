import { Skeleton } from '@/components/ui/skeleton';

/** Matches the real layout so nothing shifts when the data lands. */
export default function Loading() {
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 pb-24">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-11 w-full" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full sm:h-10" />
        ))}
      </div>
    </main>
  );
}
