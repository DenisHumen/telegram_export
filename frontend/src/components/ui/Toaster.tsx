import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useToastStore, type ToastKind } from '../../store/ui';

const ICONS: Record<ToastKind, typeof Info> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const ICON_TONE: Record<ToastKind, string> = {
  success: 'text-success',
  error: 'text-danger',
  info: 'text-accent',
};

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  return createPortal(
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((item) => {
        const Icon = ICONS[item.kind];
        return (
          <div
            key={item.id}
            className="elevated pointer-events-auto flex animate-slide-in-right items-start gap-3 p-3.5"
          >
            <Icon className={cn('mt-0.5 h-[17px] w-[17px] shrink-0', ICON_TONE[item.kind])} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-text">{item.title}</p>
              {item.description ? (
                <p className="mt-0.5 break-words text-[12.5px] leading-snug text-dim">{item.description}</p>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="Закрыть уведомление"
              onClick={() => dismiss(item.id)}
              className="rounded-[8px] p-1 text-muted transition-colors duration-120 hover:bg-veil hover:text-text"
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
