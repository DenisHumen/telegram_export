import { AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/cn';
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
        <AlertTriangle
          className={cn('mt-0.5 h-5 w-5 shrink-0', request?.danger ? 'text-danger' : 'text-warning')}
          aria-hidden
        />
        <p className="text-[13.5px] leading-relaxed text-dim">
          {request?.description ?? 'Действие нельзя отменить.'}
        </p>
      </div>
    </Modal>
  );
}
