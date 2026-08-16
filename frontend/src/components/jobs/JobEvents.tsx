import { useEffect, useRef } from 'react';
import { useJobEvents } from '../../hooks/queries';
import { cn } from '../../lib/cn';
import { formatTime } from '../../lib/format';
import { LOG_LEVEL_BORDER, LOG_LEVEL_CLASS } from '../../lib/labels';
import { Skeleton } from '../ui/Skeleton';

/**
 * Monospace event timeline: level-coloured left borders, sticks to the bottom
 * while the user stays there and releases as soon as they scroll up.
 */
export function JobEvents({ jobId, open }: { jobId: number; open: boolean }) {
  const { data: events, isLoading } = useJobEvents(jobId, open);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const count = events?.length ?? 0;

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !stickRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [count, open]);

  if (!open) return null;

  return (
    <div
      ref={scrollRef}
      onScroll={(event) => {
        const node = event.currentTarget;
        stickRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 32;
      }}
      className="scroll-thin max-h-[280px] overflow-y-auto px-5 py-3"
    >
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-3" />
          ))}
        </div>
      ) : count === 0 ? (
        <p className="py-1 text-[12.5px] text-muted">Событий пока нет</p>
      ) : (
        <ol className="space-y-0.5 font-mono text-[11.5px] leading-relaxed">
          {events?.map((event) => (
            <li
              key={event.id}
              className={cn('flex gap-3 border-l-2 py-0.5 pl-2.5', LOG_LEVEL_BORDER[event.level])}
            >
              <span className="tnum shrink-0 text-muted">{formatTime(event.ts)}</span>
              <span className={cn('w-14 shrink-0 uppercase', LOG_LEVEL_CLASS[event.level])}>{event.level}</span>
              <span className="min-w-0 break-words text-dim">{event.message}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
