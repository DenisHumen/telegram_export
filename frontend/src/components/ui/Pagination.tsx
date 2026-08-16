import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';
import { formatNumber } from '../../lib/format';
import { IconButton } from './Button';

export function Pagination({
  page,
  pages,
  total,
  onPage,
  unitLabel = 'записей',
  className,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (page: number) => void;
  unitLabel?: string;
  className?: string;
}) {
  const safePages = Math.max(1, pages);
  const windowSize = 5;
  const start = Math.max(1, Math.min(page - Math.floor(windowSize / 2), safePages - windowSize + 1));
  const items = Array.from({ length: Math.min(windowSize, safePages) }, (_, index) => start + index);

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 px-1 py-3', className)}>
      <p className="text-[12.5px] text-ink-faint">
        Всего: <span className="font-mono text-ink-muted">{formatNumber(total)}</span> {unitLabel} · страница{' '}
        <span className="font-mono text-ink-muted">{page}</span> из{' '}
        <span className="font-mono text-ink-muted">{safePages}</span>
      </p>
      <div className="flex items-center gap-1.5">
        <IconButton label="Предыдущая страница" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </IconButton>
        {items.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onPage(item)}
            aria-current={item === page ? 'page' : undefined}
            className={cn(
              'h-8 min-w-8 rounded-lg px-2 font-mono text-[12.5px] transition-colors duration-150',
              item === page
                ? 'bg-accent/20 text-accent-soft border border-accent/30'
                : 'border border-line text-ink-muted hover:border-line2 hover:text-ink',
            )}
          >
            {item}
          </button>
        ))}
        <IconButton
          label="Следующая страница"
          size="sm"
          disabled={page >= safePages}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}
