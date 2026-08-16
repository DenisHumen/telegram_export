import type { ReactNode } from 'react';
import { AlertOctagon } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Button } from './Button';

/* --------------------------------------------------------------- artwork */
/* Line art only: hairline strokes in the neutral border colour, with a single
   clay accent detail. No fills, no gradients, no glow. */

const STROKE = 'var(--border-strong)';
const ACCENT = 'var(--accent)';

function Frame({ children, label }: { children: ReactNode; label: string }) {
  return (
    <svg viewBox="0 0 240 140" className="h-[132px] w-[228px]" role="img" aria-label={label} fill="none">
      {children}
    </svg>
  );
}

export function NoAccountsArt() {
  return (
    <Frame label="Нет аккаунтов">
      <g stroke={STROKE} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="58" y="24" width="124" height="92" rx="14" />
        <circle cx="120" cy="60" r="14" />
        <path d="M98 92c4-12 11-18 22-18s18 6 22 18" />
        <path d="M58 44h124" strokeDasharray="3 6" />
      </g>
      <g stroke={ACCENT} strokeWidth="1.8" strokeLinecap="round">
        <path d="M186 32h18M195 23v18" />
      </g>
      <path d="M36 108h32" stroke={STROKE} strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 7" />
      <path d="M172 108h32" stroke={STROKE} strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 7" />
    </Frame>
  );
}

export function NoChatsArt() {
  return (
    <Frame label="Нет чатов">
      <g stroke={STROKE} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M40 28h104a10 10 0 0110 10v40a10 10 0 01-10 10H74l-18 16V88h-16a10 10 0 01-10-10V38a10 10 0 0110-10z" />
        <path d="M60 50h64M60 66h40" />
      </g>
      <g stroke={ACCENT} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M128 62h64a10 10 0 0110 10v30a10 10 0 01-10 10h-12v14l-16-14h-36a10 10 0 01-10-10V72a10 10 0 0110-10z" />
        <path d="M146 82h44M146 96h26" opacity="0.55" />
      </g>
    </Frame>
  );
}

export function NoJobsArt() {
  return (
    <Frame label="Нет задач экспорта">
      <g stroke={STROKE} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M58 62h124v46a8 8 0 01-8 8H66a8 8 0 01-8-8z" />
        <path d="M50 40h140v22H50z" />
        <path d="M104 82h32" />
      </g>
      <g stroke={ACCENT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M120 8v24M110 24l10 10 10-10" />
      </g>
    </Frame>
  );
}

export function NoFilesArt() {
  return (
    <Frame label="Нет файлов">
      <g stroke={STROKE} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M76 22h52l24 24v72a6 6 0 01-6 6H76a6 6 0 01-6-6V28a6 6 0 016-6z" />
        <path d="M128 22v24h24" />
        <path d="M88 74h48M88 90h32" />
      </g>
      <circle cx="160" cy="102" r="14" stroke={ACCENT} strokeWidth="1.8" />
      <path d="M171 113l10 10" stroke={ACCENT} strokeWidth="1.8" strokeLinecap="round" />
    </Frame>
  );
}

/* ------------------------------------------------------------- component */

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
      <h3 className={cn('text-[15px] font-medium text-text', art && 'mt-5')}>{title}</h3>
      {description ? (
        <p className="mt-1.5 max-w-md text-balance text-[13px] leading-relaxed text-muted">{description}</p>
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
        'flex flex-col items-center justify-center gap-3 rounded-card border border-danger/25 px-6 py-10 text-center',
        className,
      )}
    >
      <AlertOctagon className="h-6 w-6 text-danger" aria-hidden />
      <div>
        <p className="text-[14px] font-medium text-text">{title}</p>
        {description ? <p className="mt-1 max-w-lg text-[12.5px] text-dim">{description}</p> : null}
      </div>
      {onRetry ? (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Повторить
        </Button>
      ) : null}
    </div>
  );
}
