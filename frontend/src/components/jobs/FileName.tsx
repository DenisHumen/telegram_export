import { cn } from '../../lib/cn';
import { splitExtension } from '../../lib/jobs';

/**
 * Middle-truncating file name: the head shrinks with an ellipsis while the
 * tail (last few characters + the extension) always stays readable.
 *
 * Implemented with two flex boxes rather than a `direction: rtl` trick —
 * RTL reorders the boxes and renders ".mp4name" instead of "name.mp4".
 */
export function FileName({
  name,
  className,
  tailLength = 6,
}: {
  name: string;
  className?: string;
  /** How many characters before the extension to keep pinned on the right. */
  tailLength?: number;
}) {
  const [stem, ext] = splitExtension(name);
  const keepTail = stem.length > tailLength + 6;
  const head = keepTail ? stem.slice(0, stem.length - tailLength) : stem;
  const tail = keepTail ? stem.slice(stem.length - tailLength) : '';

  return (
    <span className={cn('flex min-w-0 items-baseline', className)} title={name}>
      <span className="truncate">{head}</span>
      <span className="shrink-0 whitespace-pre">{tail}</span>
      {ext ? <span className="shrink-0 whitespace-pre text-text">{ext}</span> : null}
    </span>
  );
}
