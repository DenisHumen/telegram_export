import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePageStore } from '../../store/ui';

/**
 * Declares the page title/subtitle (rendered on the left of the top bar) and
 * teleports the primary page action into the top bar's right-hand slot, so no
 * page wastes vertical space on its own title block.
 */
export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Primary action(s) for this page. */
  children?: ReactNode;
}) {
  const setMeta = usePageStore((state) => state.setMeta);
  const slot = usePageStore((state) => state.actionsSlot);

  useEffect(() => {
    setMeta(title, subtitle ?? '');
  }, [title, subtitle, setMeta]);

  if (!children || !slot) return null;
  return createPortal(children, slot);
}
