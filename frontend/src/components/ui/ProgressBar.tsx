import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { percent } from '../../lib/format';

type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral';

const FILL: Record<Tone, string> = {
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-muted',
};

/**
 * 6px track by default. While `running`, the fill carries a slow travelling
 * highlight; `prefers-reduced-motion` removes it (see index.css).
 */
export function ProgressBar({
  value,
  total,
  running,
  tone = 'accent',
  label,
  right,
  size = 'md',
  className,
}: {
  value: number;
  total: number;
  running?: boolean;
  tone?: Tone;
  label?: ReactNode;
  right?: ReactNode;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const pct = percent(value, total);

  return (
    <div className={className}>
      {label || right ? (
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[12.5px]">
          <span className="truncate text-dim">{label}</span>
          <span className="tnum shrink-0 font-mono text-[12px] text-muted">{right}</span>
        </div>
      ) : null}
      <div
        className={cn(
          'relative w-full overflow-hidden rounded-pill bg-surface-2',
          size === 'sm' ? 'h-1' : 'h-1.5',
        )}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn('relative h-full overflow-hidden rounded-pill', FILL[tone])}
          style={{ width: `${pct}%`, transition: 'width 400ms ease-out' }}
        >
          {running && pct > 0 ? <span className="progress-sheen" aria-hidden /> : null}
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
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border-strong)" strokeWidth={3} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={ratio > 0.25 ? 'var(--accent)' : 'var(--warning)'}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
      <span className="tnum absolute inset-0 flex items-center justify-center font-mono text-[11px] text-dim">
        {children}
      </span>
    </div>
  );
}
