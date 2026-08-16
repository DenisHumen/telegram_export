import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Tooltip } from './Tooltip';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white border border-transparent hover:bg-accent-hover',
  secondary: 'bg-surface-2 text-text border border-border hover:border-border-strong',
  ghost: 'bg-transparent text-dim border border-transparent hover:bg-veil hover:text-text',
  danger: 'bg-transparent text-danger border border-danger/30 hover:bg-danger/10',
  success: 'bg-transparent text-success border border-success/30 hover:bg-success/10',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 gap-1.5 rounded-control px-2.5 text-[12.5px]',
  md: 'h-9 gap-2 rounded-control px-3.5 text-[13.5px]',
  lg: 'h-10 gap-2 rounded-control px-4 text-[14px]',
};

const BASE =
  'inline-flex select-none items-center justify-center whitespace-nowrap font-medium ' +
  'transition-colors duration-120 active:scale-[0.98] ' +
  'disabled:pointer-events-none disabled:opacity-45 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, fullWidth, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && 'w-full', className)}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name; also the tooltip text unless `tooltip={false}`. */
  label: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  tooltip?: boolean;
}

const BOX: Record<Size, string> = {
  sm: 'h-8 w-8 rounded-control',
  md: 'h-9 w-9 rounded-control',
  lg: 'h-10 w-10 rounded-control',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'ghost', size = 'md', loading, tooltip = true, className, children, disabled, ...rest },
  ref,
) {
  const button = (
    <button
      ref={ref}
      aria-label={label}
      disabled={disabled || loading}
      className={cn(BASE, VARIANTS[variant], BOX[size], className)}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : children}
    </button>
  );

  return tooltip ? <Tooltip label={label}>{button}</Tooltip> : button;
});
