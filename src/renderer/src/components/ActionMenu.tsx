import { useEffect, useId, useRef } from 'react';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import './action-menu.css';

export interface ActionMenuItem { id: string; label: string; icon: IconName; disabled?: boolean; destructive?: boolean; reason?: string }

// 使用浏览器顶层 popover，避免被相邻卡片的菜单按钮或滚动容器盖住。
export function ActionMenu({ label, items, onAction }: {
  label: string; items: ActionMenuItem[]; onAction(id: string, trigger: HTMLButtonElement): void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<'first' | 'last'>('first');
  function close() { if (panel.current?.matches(':popover-open')) panel.current.hidePopover(); }
  function position() {
    const button = trigger.current, menu = panel.current;
    if (!button || !menu) return;
    const rect = button.getBoundingClientRect(), gap = 5, inset = 8;
    const width = menu.offsetWidth, height = menu.offsetHeight;
    menu.style.left = `${Math.max(inset, Math.min(rect.right - width, window.innerWidth - width - inset))}px`;
    menu.style.top = `${Math.max(inset, rect.bottom + gap + height <= window.innerHeight - inset ? rect.bottom + gap : rect.top - height - gap)}px`;
  }
  function buttons() { return Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []); }
  useEffect(() => {
    const dismiss = () => { if (panel.current?.matches(':popover-open')) panel.current.hidePopover(); };
    window.addEventListener('blur', dismiss);
    window.addEventListener('resize', dismiss);
    document.addEventListener('scroll', dismiss, true);
    return () => { window.removeEventListener('blur', dismiss); window.removeEventListener('resize', dismiss); document.removeEventListener('scroll', dismiss, true); };
  }, []);
  return <div className="ui-action-menu" onBlur={event => {
    if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget)) close();
  }} onKeyDown={event => {
    const open = panel.current?.matches(':popover-open');
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); trigger.current?.focus(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (!open) { initialFocus.current = event.key === 'ArrowUp' || event.key === 'End' ? 'last' : 'first'; panel.current?.showPopover(); return; }
    const available = buttons(), index = available.findIndex(button => button === document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + available.length) % available.length;
    available[next]?.focus();
  }}>
    <Button ref={trigger} className="ui-action-menu-trigger" variant="text" aria-label={label} aria-haspopup="menu"
      aria-expanded="false" popoverTarget={id} onClick={() => { initialFocus.current = 'first'; }}><Icon name="more" /></Button>
    <div id={id} ref={panel} popover="auto" role="menu" aria-label={label} className="ui-action-menu-panel"
      onBlur={event => { if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget)) close(); }}
      onBeforeToggle={event => { if (event.newState === 'open' && panel.current) panel.current.style.visibility = 'hidden'; }}
      onToggle={event => {
        const open = event.newState === 'open';
        trigger.current?.setAttribute('aria-expanded', String(open));
        if (open) { position(); if (panel.current) panel.current.style.visibility = 'visible'; const available = buttons(); (initialFocus.current === 'last' ? available.at(-1) : available[0])?.focus(); }
      }}>
      {items.map((item, index) => <div key={item.id} role="none">
        {item.destructive && index > 0 ? <div role="separator" className="ui-action-menu-separator" /> : null}
        <Button role="menuitem" className={`ui-action-menu-item${item.destructive ? ' is-destructive' : ''}`} disabled={item.disabled} title={item.reason}
          onClick={() => { const button = trigger.current; close(); if (button) onAction(item.id, button); }}><Icon name={item.icon} /><span>{item.label}</span></Button>
      </div>)}
    </div>
  </div>;
}
