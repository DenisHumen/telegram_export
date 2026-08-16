import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Check } from 'lucide-react';
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
        <p className="mt-1.5 text-[12px] text-ink-faint">{hint}</p>
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
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">{leading}</span>
        ) : null}
        <input
          ref={ref}
          id={id}
          className={cn(
            'field',
            leading && 'pl-10',
            trailing && 'pr-10',
            mono && 'font-mono text-[13px]',
            error && 'border-danger/50 focus:border-danger/60 focus:ring-danger/20',
            className,
          )}
          {...rest}
        />
        {trailing ? <span className="absolute right-2 top-1/2 -translate-y-1/2">{trailing}</span> : null}
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
      <select ref={ref} id={id} className={cn('field appearance-none pr-9 cursor-pointer', className)} {...rest}>
        {children}
      </select>
    </FieldWrap>
  );
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode }>(
  function TextArea({ label, className, ...rest }, ref) {
    const autoId = useId();
    const id = rest.id ?? autoId;
    return (
      <FieldWrap label={label} htmlFor={id}>
        <textarea ref={ref} id={id} className={cn('field min-h-[92px] resize-y', className)} {...rest} />
      </FieldWrap>
    );
  },
);

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
        'group flex w-full items-start gap-3 rounded-xl border border-line bg-base/40 px-3.5 py-3 text-left',
        'transition-all duration-150 hover:border-line2 hover:bg-base/70 disabled:opacity-50 disabled:pointer-events-none',
        checked && 'border-accent/30 bg-accent/[0.07]',
        className,
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full border transition-all duration-150',
          checked ? 'border-accent/40 bg-accent-grad' : 'border-line2 bg-white/[0.06]',
        )}
      >
        <span
          className={cn(
            'h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-150',
            checked ? 'translate-x-[19px]' : 'translate-x-[3px]',
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        {description ? <span className="mt-0.5 block text-[12px] leading-snug text-ink-faint">{description}</span> : null}
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
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium',
        'transition-all duration-150',
        active
          ? 'border-accent/40 bg-accent/15 text-accent-soft shadow-[0_0_0_1px_rgba(51,144,236,0.15)]'
          : 'border-line bg-white/[0.03] text-ink-muted hover:border-line2 hover:text-ink',
        className,
      )}
    >
      {active ? <Check className="h-3.5 w-3.5" aria-hidden /> : icon}
      {children}
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
          <span className="font-mono text-[13px] text-accent-soft">{format ? format(value) : value}</span>
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
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/[0.08] accent-accent
                   [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none
                   [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
                   [&::-webkit-slider-thumb]:shadow-[0_0_0_3px_rgba(51,144,236,0.5)]
                   [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full
                   [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white"
        style={{
          backgroundImage: `linear-gradient(90deg, #3390EC 0%, #5CC8FF ${pct}%, rgba(255,255,255,0.08) ${pct}%)`,
        }}
      />
    </div>
  );
}
