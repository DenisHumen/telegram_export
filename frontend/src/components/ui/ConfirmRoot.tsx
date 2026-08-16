import { AlertTriangle } from 'lucide-react';
import { useConfirmStore } from '../../store/ui';
import { Button } from './Button';
import { Modal } from './Modal';

/** Renders the single confirm dialog driven by `confirmDialog()`. */
export function ConfirmRoot() {
  const request = useConfirmStore((state) => state.request);
  const answer = useConfirmStore((state) => state.answer);

  return (
    <Modal
      open={request !== null}
      onClose={() => answer(false)}
      size="sm"
      title={request?.title ?? ''}
      footer={
        <>
          <Button variant="ghost" onClick={() => answer(false)}>
            {request?.cancelLabel ?? 'Отмена'}
          </Button>
          <Button variant={request?.danger ? 'danger' : 'primary'} onClick={() => answer(true)}>
            {request?.confirmLabel ?? 'Подтвердить'}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <div
          className={
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ' +
            (request?.danger ? 'border-danger/30 bg-danger/10 text-danger' : 'border-line bg-surface2 text-accent-soft')
          }
        >
          <AlertTriangle className="h-5 w-5" aria-hidden />
        </div>
        <p className="text-[14px] leading-relaxed text-ink-muted">
          {request?.description ?? 'Действие нельзя отменить.'}
        </p>
      </div>
    </Modal>
  );
}
