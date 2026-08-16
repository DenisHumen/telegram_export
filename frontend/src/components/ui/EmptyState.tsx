import type { ReactNode } from 'react';
import { AlertOctagon } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Button } from './Button';

/** Inline illustration — no external assets. */
export function NoAccountsArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 160" className={cn('h-40 w-60', className)} role="img" aria-label="Нет аккаунтов">
      <defs>
        <linearGradient id="ea-g1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3390EC" stopOpacity="0.9" />
          <stop offset="1" stopColor="#5CC8FF" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id="ea-g2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.08" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <ellipse cx="120" cy="139" rx="72" ry="9" fill="#3390EC" opacity="0.12" />
      <rect x="46" y="30" width="148" height="94" rx="16" fill="url(#ea-g2)" stroke="rgba(255,255,255,0.12)" />
      <circle cx="120" cy="66" r="20" fill="url(#ea-g1)" />
      <path d="M120 60a6 6 0 100 12 6 6 0 000-12z" fill="#0B0F14" opacity="0.7" />
      <path d="M106 84c3-7 8-10 14-10s11 3 14 10z" fill="#0B0F14" opacity="0.7" />
      <rect x="82" y="96" width="76" height="7" rx="3.5" fill="rgba(255,255,255,0.12)" />
      <rect x="98" y="108" width="44" height="6" rx="3" fill="rgba(255,255,255,0.07)" />
      <g stroke="rgba(92,200,255,0.5)" strokeWidth="2.5" strokeLinecap="round">
        <path d="M186 40h16M194 32v16" />
      </g>
      <circle cx="52" cy="112" r="3" fill="#3DD68C" opacity="0.6" />
      <circle cx="200" cy="104" r="4" fill="#3390EC" opacity="0.35" />
    </svg>
  );
}

export function NoChatsArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 160" className={cn('h-40 w-60', className)} role="img" aria-label="Нет чатов">
      <defs>
        <linearGradient id="ec-g1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3390EC" stopOpacity="0.85" />
          <stop offset="1" stopColor="#5CC8FF" stopOpacity="0.45" />
        </linearGradient>
      </defs>
      <ellipse cx="120" cy="140" rx="76" ry="9" fill="#3390EC" opacity="0.1" />
      <rect
        x="34"
        y="34"
        width="118"
        height="66"
        rx="16"
        fill="rgba(255,255,255,0.05)"
        stroke="rgba(255,255,255,0.12)"
      />
      <path d="M62 100l-4 18 22-18z" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.12)" />
      <rect x="52" y="54" width="72" height="7" rx="3.5" fill="rgba(255,255,255,0.13)" />
      <rect x="52" y="70" width="48" height="7" rx="3.5" fill="rgba(255,255,255,0.08)" />
      <rect x="112" y="66" width="94" height="58" rx="16" fill="url(#ec-g1)" opacity="0.22" stroke="rgba(92,200,255,0.35)" />
      <path d="M182 124l6 16-20-16z" fill="rgba(92,200,255,0.16)" />
      <rect x="128" y="84" width="62" height="7" rx="3.5" fill="rgba(255,255,255,0.16)" />
      <rect x="128" y="99" width="40" height="7" rx="3.5" fill="rgba(255,255,255,0.1)" />
      <circle cx="30" cy="120" r="4" fill="#3DD68C" opacity="0.5" />
      <circle cx="214" cy="46" r="5" fill="#3390EC" opacity="0.3" />
    </svg>
  );
}

export function EmptyState({
  art,
  title,
  description,
  action,
  className,
}: {
  art?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {art}
      <h3 className="mt-4 text-[16px] font-semibold tracking-tight text-ink">{title}</h3>
      {description ? (
        <p className="mt-1.5 max-w-md text-[13.5px] leading-relaxed text-ink-muted text-balance">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'Не удалось загрузить данные',
  description,
  onRetry,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-2xl border border-danger/25 bg-danger/[0.05] px-6 py-10 text-center',
        className,
      )}
    >
      <AlertOctagon className="h-7 w-7 text-danger" aria-hidden />
      <div>
        <p className="text-[15px] font-medium text-ink">{title}</p>
        {description ? <p className="mt-1 max-w-lg text-[13px] text-ink-muted">{description}</p> : null}
      </div>
      {onRetry ? (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Повторить
        </Button>
      ) : null}
    </div>
  );
}
