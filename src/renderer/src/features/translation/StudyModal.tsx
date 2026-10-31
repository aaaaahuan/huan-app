import { useEffect, useId, useRef, type ReactNode } from 'react';
import { IconButton } from '@renderer/components/Button';

export function StudyModal({ title, children, onClose, className = '' }: {
  title: string; children: ReactNode; onClose(): void; className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement;
    element.showModal();
    element.querySelector<HTMLTextAreaElement | HTMLInputElement>('textarea, input')?.focus();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return <dialog ref={dialog} className={`study-dialog ${className}`} aria-labelledby={id}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="study-dialog-heading"><h2 id={id}>{title}</h2><IconButton icon="close" label="关闭弹窗" onClick={onClose} /></header>
    <div className="study-dialog-body">{children}</div>
  </dialog>;
}
