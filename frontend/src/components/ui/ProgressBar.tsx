import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { percent } from '../../lib/format';

export function ProgressBar({
  value,
  total,
  running,
  tone = 'accent',
  label,
  right,
  className,
}: {
  value: number;
  total: number;
  running?: boolean;
  tone?: 'accent' | 'success' | 'warning' | 'danger';
  label?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  const pct = percent(value, total);
  const fill =
    tone === 'success'
      ? 'bg-success'
      : tone === 'warning'
        ? 'bg-warning'
        : tone === 'danger'
          ? 'bg-danger'
          : 'bg-accent-grad';

  return (
    <div className={className}>
      {label || right ? (
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[12px]">
          <span className="truncate text-ink-muted">{label}</span>
          <span className="shrink-0 font-mono text-ink-faint">{right}</span>
        </div>
      ) : null}
      <div
        className="relative h-2 w-full overflow-hidden rounded-full bg-white/[0.06]"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn('relative h-full rounded-full transition-[width] duration-500 ease-out', fill)}
          style={{ width: `${pct}%` }}
        >
          {running && pct > 0 ? (
            <span className="absolute inset-y-0 left-0 w-1/3 animate-sheen bg-gradient-to-r from-transparent via-white/40 to-transparent" />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function CountdownRing({
  remaining,
  total,
  children,
  size = 44,
}: {
  remaining: number;
  total: number;
  children?: ReactNode;
  size?: number;
}) {
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth={3} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={ratio > 0.25 ? '#3390EC' : '#F5A524'}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-[11px] text-ink-muted">
        {children}
      </span>
    </div>
  );
}
