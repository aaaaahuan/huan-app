import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './Button';

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className="terrain-modal" aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2>{title}</h2><Button aria-label="关闭弹窗" onClick={onClose}>关闭</Button></header>{children}
  </dialog>;
}
