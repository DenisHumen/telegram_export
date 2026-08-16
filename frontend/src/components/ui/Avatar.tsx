import { useState } from 'react';
import { cn } from '../../lib/cn';
import { hueFor, initialsOf } from '../../lib/format';
import { useThemeStore } from '../../store/theme';

/**
 * Initials placeholder in a warm, low-saturation band (clay → amber → olive) —
 * deterministic per seed, never neon.
 */
export function Avatar({
  name,
  seed,
  src,
  size = 36,
  square,
  className,
}: {
  name: string | null | undefined;
  seed?: string | number;
  src?: string | null;
  size?: number;
  square?: boolean;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const theme = useThemeStore((state) => state.resolved);
  const initials = initialsOf(name);
  const hue = 16 + (hueFor(seed ?? name ?? '?') % 6) * 12; // 16…76
  const showImage = !!src && !broken;

  const background = showImage
    ? 'transparent'
    : theme === 'light'
      ? `hsl(${hue} 34% 91%)`
      : `hsl(${hue} 16% 30%)`;
  const color = theme === 'light' ? `hsl(${hue} 42% 32%)` : `hsl(${hue} 34% 82%)`;

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden font-medium',
        square ? 'rounded-control' : 'rounded-pill',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, Math.round(size * 0.36)),
        background,
        color: showImage ? undefined : color,
      }}
      aria-hidden
    >
      {showImage ? (
        <img
          src={src ?? undefined}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        initials
      )}
    </span>
  );
}
