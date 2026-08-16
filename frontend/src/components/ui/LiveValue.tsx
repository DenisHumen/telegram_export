import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';

/**
 * A frequently-updating number (bytes, speed, counters). Flashes accent for
 * ~400ms whenever the rendered text changes, and always uses tabular figures
 * so the row does not jitter.
 */
export function LiveValue({ value, className }: { value: string; className?: string }) {
  const [flash, setFlash] = useState(false);
  const previous = useRef(value);

  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), 420);
    return () => window.clearTimeout(timer);
  }, [value]);

  return <span className={cn('tnum', flash && 'value-flash', className)}>{value}</span>;
}
