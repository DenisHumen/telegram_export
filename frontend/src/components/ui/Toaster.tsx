import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useToastStore, type ToastKind } from '../../store/ui';

const ICONS: Record<ToastKind, typeof Info> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const ACCENTS: Record<ToastKind, string> = {
  success: 'text-success border-success/25 bg-success/[0.07]',
  error: 'text-danger border-danger/25 bg-danger/[0.07]',
  info: 'text-accent-soft border-accent/25 bg-accent/[0.07]',
};

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  return createPortal(
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2.5"
      role="status"
      aria-live="polite"
    >
      {toasts.map((item) => {
        const Icon = ICONS[item.kind];
        return (
          <div
            key={item.id}
            className={cn(
              'pointer-events-auto flex items-start gap-3 rounded-2xl border bg-surface/95 p-3.5 shadow-lift backdrop-blur-xl',
              'animate-slide-in-right',
              ACCENTS[item.kind],
            )}
          >
            <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium text-ink">{item.title}</p>
              {item.description ? (
                <p className="mt-0.5 break-words text-[12.5px] leading-snug text-ink-muted">{item.description}</p>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="Закрыть уведомление"
              onClick={() => dismiss(item.id)}
              className="rounded-md p-1 text-ink-faint transition-colors hover:bg-white/5 hover:text-ink"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
