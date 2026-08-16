import { Check } from 'lucide-react';
import { cn } from '../../lib/cn';
import { LAYOUTS } from '../../lib/labels';
import type { LayoutStrategy } from '../../api/types';

interface TreeNode {
  prefix: string;
  text: string;
  folder: boolean;
}

/** Turn two-space-indented lines into a real ├─ / └─ / │ tree. */
function buildTree(lines: string[]): TreeNode[] {
  const depths = lines.map((line) => (line.length - line.trimStart().length) / 2);
  const texts = lines.map((line) => line.trim());

  const isLast = lines.map((_, index) => {
    for (let j = index + 1; j < lines.length; j++) {
      if (depths[j] < depths[index]) return true;
      if (depths[j] === depths[index]) return false;
    }
    return true;
  });

  return lines.map((_, index) => {
    const depth = depths[index];
    let prefix = '';
    for (let level = 0; level < depth; level++) {
      let ancestor = -1;
      for (let j = index - 1; j >= 0; j--) {
        if (depths[j] === level) {
          ancestor = j;
          break;
        }
      }
      prefix += ancestor >= 0 && !isLast[ancestor] ? '│  ' : '   ';
    }
    if (depth > 0) prefix += isLast[index] ? '└─ ' : '├─ ';
    return { prefix, text: texts[index], folder: texts[index].endsWith('/') };
  });
}

function TreePreview({ lines, active }: { lines: string[]; active: boolean }) {
  const nodes = buildTree(lines);
  return (
    <pre
      className={cn(
        'mt-3 overflow-hidden whitespace-pre rounded-control border border-border px-2.5 py-2',
        'font-mono text-[10.5px] leading-[1.7]',
        active ? 'text-dim' : 'text-muted',
      )}
    >
      {nodes.map((node, index) => (
        <div key={index} className="truncate">
          <span className="text-muted">{node.prefix}</span>
          <span className={node.folder ? (active ? 'text-accent' : 'text-dim') : undefined}>{node.text}</span>
        </div>
      ))}
    </pre>
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
    <div role="radiogroup" aria-label="Стратегия раскладки файлов" className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
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
              'rounded-card border p-3 text-left transition-colors duration-120',
              active ? 'border-accent/45 bg-accent-soft' : 'border-border hover:border-border-strong',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className={cn('text-[13px] font-medium', active ? 'text-accent' : 'text-text')}>{layout.title}</p>
                <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{layout.description}</p>
              </div>
              {active ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden /> : null}
            </div>
            <TreePreview lines={layout.tree} active={active} />
            <p className="mt-2 font-mono text-[10.5px] text-muted">{layout.value}</p>
          </button>
        );
      })}
    </div>
  );
}
