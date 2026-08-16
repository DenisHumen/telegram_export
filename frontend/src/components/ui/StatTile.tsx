import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Skeleton } from './Skeleton';

/**
 * Hero metric. Uppercase micro-label, tabular figures, hairline card — no
 * coloured icon chips competing for attention.
 */
export function StatTile({
  icon,
  label,
  value,
  hint,
  loading,
  accent,
  className,
}: {
  icon?: ReactNode;
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  loading?: boolean;
  /** At most one tile per view should set this. */
  accent?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('card px-5 py-4', className)}>
      <div className="flex items-center gap-2 text-muted">
        {icon ? <span className="shrink-0">{icon}</span> : null}
        <span className="micro-label truncate">{label}</span>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-6 w-24" />
      ) : (
        <p
          className={cn(
            'tnum mt-2.5 text-[22px] font-semibold leading-none tracking-[-0.01em]',
            accent ? 'text-accent' : 'text-text',
          )}
        >
          {value}
        </p>
      )}
      {hint ? <p className="mt-1.5 text-[12px] text-muted">{hint}</p> : null}
    </div>
  );
}
