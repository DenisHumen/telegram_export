import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export function Card({
  children,
  className,
  hover,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return <div className={cn('card', hover && 'card-hover', className)}>{children}</div>;
}

/** Header row inside a card — hairline separated, no icon chrome by default. */
export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-border px-5 py-3.5', className)}>
      <div className="min-w-0">
        <h2 className="truncate text-[14px] font-medium text-text">{title}</h2>
        {subtitle ? <p className="mt-0.5 truncate text-[12.5px] text-muted">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/**
 * A flat page section: 13px dim header, optional action, hairline above.
 * Replaces card-in-card nesting.
 */
export function Section({
  title,
  description,
  action,
  children,
  className,
  divided = true,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Draw the hairline above the section. */
  divided?: boolean;
}) {
  return (
    <section className={cn(divided && 'border-t border-border pt-6', className)}>
      {title ? (
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[13px] font-medium text-dim">{title}</h2>
            {description ? <p className="mt-0.5 text-[12.5px] text-muted">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Standalone 13px section header for places that build their own layout. */
export function SectionHeading({
  title,
  action,
  className,
}: {
  title: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-baseline justify-between gap-3', className)}>
      <h2 className="text-[13px] font-medium text-dim">{title}</h2>
      {action}
    </div>
  );
}
