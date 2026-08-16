import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Skeleton } from './Skeleton';

export function StatTile({
  icon,
  label,
  value,
  hint,
  loading,
  tone = 'accent',
  className,
}: {
  icon?: ReactNode;
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  loading?: boolean;
  tone?: 'accent' | 'success' | 'warning' | 'danger' | 'neutral';
  className?: string;
}) {
  const toneClass =
    tone === 'success'
      ? 'text-success bg-success/10 border-success/20'
      : tone === 'warning'
        ? 'text-warning bg-warning/10 border-warning/20'
        : tone === 'danger'
          ? 'text-danger bg-danger/10 border-danger/20'
          : tone === 'neutral'
            ? 'text-ink-muted bg-white/[0.05] border-line'
            : 'text-accent-soft bg-accent/10 border-accent/20';

  return (
    <div className={cn('card card-hover p-4', className)}>
      <div className="flex items-center gap-2.5">
        {icon ? (
          <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg border', toneClass)}>{icon}</span>
        ) : null}
        <span className="text-[12px] font-medium uppercase tracking-wide text-ink-faint">{label}</span>
      </div>
      <div className="mt-3">
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <p className="font-mono text-[24px] font-semibold leading-none tracking-tight text-ink">{value}</p>
        )}
        {hint ? <p className="mt-1.5 text-[12px] text-ink-faint">{hint}</p> : null}
      </div>
    </div>
  );
}
