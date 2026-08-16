import { useState } from 'react';
import { cn } from '../../lib/cn';
import { hueFor, initialsOf } from '../../lib/format';

export function Avatar({
  name,
  seed,
  src,
  size = 40,
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
  const initials = initialsOf(name);
  const hue = hueFor(seed ?? name ?? '?');
  const showImage = !!src && !broken;

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden border border-white/10 font-semibold text-white/90',
        square ? 'rounded-xl' : 'rounded-full',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, Math.round(size * 0.36)),
        background: showImage
          ? 'transparent'
          : `linear-gradient(140deg, hsl(${hue} 62% 42%), hsl(${(hue + 42) % 360} 68% 30%))`,
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
