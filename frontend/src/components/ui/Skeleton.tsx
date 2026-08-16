import { cn } from '../../lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4 w-full', className)} />;
}

export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('divide-y divide-border rounded-card border border-border', className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-3.5">
          <Skeleton className="h-8 w-8 shrink-0 rounded-pill" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-2.5 w-1/5" />
          </div>
          <Skeleton className="h-2.5 w-16" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-3', className)}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="card p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-control" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-2.5 w-1/3" />
            </div>
          </div>
          <div className="mt-5 space-y-2.5">
            <Skeleton className="h-2.5" />
            <Skeleton className="h-2.5 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
