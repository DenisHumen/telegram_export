import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from '../../lib/cn';

/**
 * Five separate digit boxes: auto-advance, paste support, backspace navigation,
 * arrow keys — fully usable from the keyboard.
 */
export function CodeInput({
  value,
  onChange,
  length = 5,
  disabled,
  autoFocus,
  invalid,
  onComplete,
}: {
  value: string;
  onChange: (next: string) => void;
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
  onComplete?: (code: string) => void;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(length, ' ').slice(0, length).split('');

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  const setAt = (index: number, char: string) => {
    const chars = value.padEnd(length, ' ').slice(0, length).split('');
    chars[index] = char;
    const next = chars.join('').replace(/\s/g, '').slice(0, length);
    onChange(next);
    return next;
  };

  const handleChange = (index: number, raw: string) => {
    const clean = raw.replace(/\D/g, '');
    if (!clean) {
      setAt(index, ' ');
      return;
    }
    if (clean.length > 1) {
      const next = (value.slice(0, index) + clean).replace(/\D/g, '').slice(0, length);
      onChange(next);
      const focusIndex = Math.min(next.length, length - 1);
      refs.current[focusIndex]?.focus();
      if (next.length === length) onComplete?.(next);
      return;
    }
    const next = setAt(index, clean);
    if (index < length - 1) refs.current[index + 1]?.focus();
    if (next.length === length) onComplete?.(next);
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (value[index]) {
        onChange(value.slice(0, index) + value.slice(index + 1));
      } else if (index > 0) {
        onChange(value.slice(0, index - 1) + value.slice(index));
        refs.current[index - 1]?.focus();
      }
      return;
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      refs.current[index - 1]?.focus();
    }
    if (event.key === 'ArrowRight' && index < length - 1) {
      event.preventDefault();
      refs.current[index + 1]?.focus();
    }
    if (event.key === 'Enter' && value.length === length) {
      onComplete?.(value);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!pasted) return;
    onChange(pasted);
    refs.current[Math.min(pasted.length, length - 1)]?.focus();
    if (pasted.length === length) onComplete?.(pasted);
  };

  return (
    <div className="flex gap-2.5" role="group" aria-label="Код подтверждения">
      {Array.from({ length }).map((_, index) => (
        <input
          key={index}
          ref={(node) => {
            refs.current[index] = node;
          }}
          value={digits[index]?.trim() ?? ''}
          onChange={(event) => handleChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          onFocus={(event) => event.target.select()}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          aria-label={`Цифра ${index + 1} из ${length}`}
          className={cn(
            'tnum h-12 w-11 rounded-control border bg-surface-2 py-3 text-center font-mono text-[20px] text-text',
            'transition-colors duration-120 focus:outline-none focus:ring-2 focus:ring-accent/25',
            invalid ? 'border-danger/60 focus:border-danger' : 'border-border hover:border-border-strong focus:border-accent/55',
            disabled && 'opacity-50',
          )}
        />
      ))}
    </div>
  );
}
