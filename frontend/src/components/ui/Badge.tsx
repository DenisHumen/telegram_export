import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import type { Tone } from '../../lib/labels';

const TONES: Record<Tone, string> = {
  neutral: 'bg-white/[0.06] text-ink-muted border-white/10',
  accent: 'bg-accent/15 text-accent-soft border-accent/25',
  success: 'bg-success/12 text-success border-success/25',
  warning: 'bg-warning/12 text-warning border-warning/25',
  danger: 'bg-danger/12 text-danger border-danger/25',
};

const DOT_TONES: Record<Tone, string> = {
  neutral: 'bg-ink-faint',
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
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-5',
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
        'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium leading-4',
        TONES[tone],
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', DOT_TONES[tone], pulse && 'animate-pulse-dot')} />
      {children}
    </span>
  );
}

export function Dot({ tone = 'neutral', pulse, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return <span className={cn('h-2 w-2 rounded-full', DOT_TONES[tone], pulse && 'animate-pulse-dot', className)} />;
}
