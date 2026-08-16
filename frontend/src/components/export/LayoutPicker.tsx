import { Check, Folder, FolderTree } from 'lucide-react';
import { cn } from '../../lib/cn';
import { LAYOUTS } from '../../lib/labels';
import type { LayoutStrategy } from '../../api/types';

function TreePreview({ lines }: { lines: string[] }) {
  return (
    <div className="mt-3 rounded-lg border border-line bg-base/70 p-2.5 font-mono text-[11px] leading-[1.6] text-ink-faint">
      {lines.map((line, index) => {
        const depth = (line.length - line.trimStart().length) / 2;
        const text = line.trim();
        const isFolder = text.endsWith('/');
        return (
          <div key={index} className="flex items-center gap-1.5 truncate" style={{ paddingLeft: depth * 10 }}>
            {isFolder ? (
              <Folder className="h-3 w-3 shrink-0 text-accent/70" aria-hidden />
            ) : (
              <span className="h-3 w-3 shrink-0" />
            )}
            <span className={cn('truncate', isFolder ? 'text-ink-muted' : 'text-ink-faint/70')}>{text}</span>
          </div>
        );
      })}
    </div>
  );
}

export function LayoutPicker({
  value,
  onChange,
}: {
  value: LayoutStrategy;
  onChange: (next: LayoutStrategy) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Стратегия раскладки файлов"
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      {LAYOUTS.map((layout) => {
        const active = layout.value === value;
        return (
          <button
            key={layout.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(layout.value)}
            className={cn(
              'group relative rounded-xl border p-3.5 text-left transition-all duration-150',
              active
                ? 'border-accent/45 bg-accent/[0.08] shadow-glow'
                : 'border-line bg-surface2/40 hover:-translate-y-0.5 hover:border-line2 hover:bg-surface2/70',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[13.5px] font-medium text-ink">
                  <FolderTree className={cn('h-4 w-4', active ? 'text-accent-soft' : 'text-ink-faint')} aria-hidden />
                  {layout.title}
                </p>
                <p className="mt-1 text-[11.5px] leading-snug text-ink-faint">{layout.description}</p>
              </div>
              {active ? (
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-grad">
                  <Check className="h-3 w-3 text-white" aria-hidden />
                </span>
              ) : null}
            </div>
            <TreePreview lines={layout.tree} />
            <p className="mt-2 font-mono text-[10.5px] text-ink-faint/70">{layout.value}</p>
          </button>
        );
      })}
    </div>
  );
}
