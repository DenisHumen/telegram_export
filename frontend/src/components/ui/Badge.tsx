import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import type { Tone } from '../../lib/labels';

/** Tinted, borderless-ish chips — the tint carries the meaning, not a border. */
const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-dim',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/12 text-warning',
  danger: 'bg-danger/12 text-danger',
};

const DOT_TONES: Record<Tone, string> = {
  neutral: 'bg-muted',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  icon,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-[11.5px] font-medium leading-5',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export function StatusPill({
  tone = 'neutral',
  children,
  pulse,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-[11.5px] font-medium leading-5',
        TONES[tone],
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-pill', DOT_TONES[tone], pulse && 'animate-soft-pulse')} />
      {children}
    </span>
  );
}

export function Dot({ tone = 'neutral', pulse, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return <span className={cn('h-2 w-2 rounded-pill', DOT_TONES[tone], pulse && 'animate-soft-pulse', className)} />;
}
