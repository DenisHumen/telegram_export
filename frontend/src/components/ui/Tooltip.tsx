import { useCallback, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';

type Side = 'top' | 'bottom';

interface Position {
  left: number;
  top: number;
  side: Side;
}

/**
 * Hover/focus tooltip for icon-only controls, rendered in a portal with fixed
 * coordinates so an `overflow-hidden` ancestor can never clip it.
 *
 * The trigger is wrapped in an inline-flex span that carries the pointer and
 * focus handlers — the wrapped control keeps its own aria-label, so the bubble
 * is purely visual reinforcement.
 */
export function Tooltip({
  label,
  children,
  delay = 260,
  side = 'top',
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  delay?: number;
  side?: Side;
  className?: string;
}) {
  const [position, setPosition] = useState<Position | null>(null);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const show = useCallback(
    (immediate: boolean) => {
      clearTimer();
      const open = () => {
        const node = anchorRef.current;
        if (!node) return;
        const rect = node.getBoundingClientRect();
        const resolved: Side = side === 'top' && rect.top > 48 ? 'top' : 'bottom';
        setPosition({
          left: Math.round(rect.left + rect.width / 2),
          top: Math.round(resolved === 'top' ? rect.top - 8 : rect.bottom + 8),
          side: resolved,
        });
      };
      if (immediate) open();
      else timerRef.current = window.setTimeout(open, delay);
    },
    [delay, side],
  );

  const hide = useCallback(() => {
    clearTimer();
    setPosition(null);
  }, []);

  if (!label) return <>{children}</>;

  return (
    <>
      <span
        ref={anchorRef}
        className={cn('inline-flex', className)}
        onMouseEnter={() => show(false)}
        onMouseLeave={hide}
        onFocus={() => show(true)}
        onBlur={hide}
        onClick={hide}
      >
        {children}
      </span>
      {position
        ? createPortal(
            <span
              role="tooltip"
              style={{
                position: 'fixed',
                left: position.left,
                top: position.top,
                transform: `translate(-50%, ${position.side === 'top' ? '-100%' : '0'})`,
              }}
              className="pointer-events-none z-[70] block max-w-[260px] animate-fade-in rounded-control
                         border border-border-strong bg-surface-2 px-2.5 py-1.5 text-center
                         text-[12px] leading-snug text-text"
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
