import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';

export function FieldWrap({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      {label ? (
        <label className="label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="mt-1.5 text-[12px] text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[12px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  wrapClassName?: string;
  mono?: boolean;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, leading, trailing, wrapClassName, mono, className, ...rest },
  ref,
) {
  const autoId = useId();
  const id = rest.id ?? autoId;
  return (
    <FieldWrap label={label} hint={hint} error={error} htmlFor={id} className={wrapClassName}>
      <div className="relative">
        {leading ? (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">{leading}</span>
        ) : null}
        <input
          ref={ref}
          id={id}
          className={cn(
            'field',
            leading && 'pl-9',
            trailing && 'pr-10',
            mono && 'font-mono text-[13px]',
            error && 'border-danger/50 focus:border-danger/60 focus:ring-danger/20',
            className,
          )}
          {...rest}
        />
        {trailing ? <span className="absolute right-1.5 top-1/2 -translate-y-1/2">{trailing}</span> : null}
      </div>
    </FieldWrap>
  );
});

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  hint?: ReactNode;
  wrapClassName?: string;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hint, wrapClassName, className, children, ...rest },
  ref,
) {
  const autoId = useId();
  const id = rest.id ?? autoId;
  return (
    <FieldWrap label={label} hint={hint} htmlFor={id} className={wrapClassName}>
      <div className="relative">
        <select
          ref={ref}
          id={id}
          className={cn('field cursor-pointer appearance-none pr-9', className)}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
      </div>
    </FieldWrap>
  );
});

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode }
>(function TextArea({ label, className, ...rest }, ref) {
  const autoId = useId();
  const id = rest.id ?? autoId;
  return (
    <FieldWrap label={label} htmlFor={id}>
      <textarea ref={ref} id={id} className={cn('field min-h-[92px] resize-y', className)} {...rest} />
    </FieldWrap>
  );
});

/** Switch row — quiet by default, accent only on the track when on. */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'group flex w-full items-start gap-3 rounded-control border border-border bg-surface px-3 py-2.5 text-left',
        'transition-colors duration-120 hover:border-border-strong',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-[18px] w-[32px] shrink-0 items-center rounded-pill transition-colors duration-120',
          checked ? 'bg-accent' : 'bg-surface-2 ring-1 ring-inset ring-border-strong',
        )}
      >
        <span
          className={cn(
            'h-3 w-3 rounded-pill bg-white transition-transform duration-120',
            checked ? 'translate-x-[16px]' : 'translate-x-[3px]',
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-text">{label}</span>
        {description ? <span className="mt-0.5 block text-[12px] leading-snug text-muted">{description}</span> : null}
      </span>
    </button>
  );
}

export function Chip({
  active,
  onClick,
  children,
  icon,
  className,
  title,
  count,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
  title?: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-[12.5px] font-medium',
        'transition-colors duration-120',
        active
          ? 'border-transparent bg-accent-soft text-accent'
          : 'border-border bg-transparent text-dim hover:border-border-strong hover:text-text',
        className,
      )}
    >
      {active && !icon ? <Check className="h-3.5 w-3.5" aria-hidden /> : icon}
      {children}
      {count !== undefined ? <span className="tnum text-[11.5px] text-muted">{count}</span> : null}
    </button>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  format,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  label?: ReactNode;
  format?: (value: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const id = useId();
  return (
    <div>
      {label ? (
        <div className="mb-2 flex items-baseline justify-between">
          <label className="label mb-0" htmlFor={id}>
            {label}
          </label>
          <span className="tnum font-mono text-[13px] text-text">{format ? format(value) : value}</span>
        </div>
      ) : null}
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-pill
                   [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none
                   [&::-webkit-slider-thumb]:rounded-pill [&::-webkit-slider-thumb]:border-0
                   [&::-webkit-slider-thumb]:bg-[var(--accent)]
                   [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-pill
                   [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[var(--accent)]"
        style={{
          backgroundImage: `linear-gradient(90deg, var(--accent) 0%, var(--accent) ${pct}%, var(--surface-2) ${pct}%)`,
        }}
      />
    </div>
  );
}

/** Small segmented control — used for tabs that must not look like buttons. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('inline-flex items-center gap-0.5 rounded-control border border-border p-0.5', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12.5px] font-medium transition-colors duration-120',
            value === option.value ? 'bg-accent-soft text-accent' : 'text-dim hover:bg-veil hover:text-text',
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}
