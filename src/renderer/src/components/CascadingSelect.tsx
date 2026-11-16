import { useEffect, useId, useRef } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';
import './cascading-select.css';

export interface CascadingGroup { id: string; name: string; models: { id: string; name: string }[]; message?: string }

export function CascadingSelect({ label, value, groups, activeGroup, selectedGroup, selectedValue, disabled, loading, error,
  onGroupChange, onSelect, onRefresh }: {
  label: string; value: string; groups: CascadingGroup[]; activeGroup: string; selectedGroup: string; selectedValue: string;
  disabled: boolean; loading: boolean; error: string;
  onGroupChange(id: string): void; onSelect(group: string, value: string): void; onRefresh(): void;
}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const groupColumn = useRef<HTMLDivElement>(null), modelColumn = useRef<HTMLDivElement>(null);
  const group = groups.find(item => item.id === activeGroup) ?? groups[0];
  function close() { if (panel.current?.matches(':popover-open')) panel.current.hidePopover(); }
  useEffect(() => {
    const dismiss = () => { if (panel.current?.matches(':popover-open')) panel.current.hidePopover(); };
    window.addEventListener('resize', dismiss); window.addEventListener('blur', dismiss);
    return () => { window.removeEventListener('resize', dismiss); window.removeEventListener('blur', dismiss); };
  }, []);
  useEffect(() => { if (disabled && panel.current?.matches(':popover-open')) panel.current.hidePopover(); }, [disabled]);
  return <div className="ui-cascading-select" onKeyDown={event => {
    if (event.key === 'Escape') { close(); trigger.current?.focus(); return; }
    if (event.key === 'ArrowDown' && event.target === trigger.current) { event.preventDefault(); panel.current?.showPopover(); return; }
    const column = groupColumn.current?.contains(event.target as Node) ? groupColumn.current : modelColumn.current;
    if (event.key === 'ArrowRight' && column === groupColumn.current) {
      event.preventDefault(); modelColumn.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); return;
    }
    if (event.key === 'ArrowLeft' && column === modelColumn.current) {
      event.preventDefault(); groupColumn.current?.querySelector<HTMLButtonElement>('[aria-expanded=true]')?.focus(); return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(column?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    const index = buttons.findIndex(button => button === document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }}>
    <Button ref={trigger} className="ui-cascading-trigger" disabled={disabled} aria-label={label} aria-haspopup="menu" aria-expanded="false" popoverTarget={id}>
      <span>{value}</span><Icon name="chevron" />
    </Button>
    <div id={id} ref={panel} popover="auto" className="ui-cascading-panel" onBlur={event => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close();
    }} onToggle={event => {
      const open = event.newState === 'open'; trigger.current?.setAttribute('aria-expanded', String(open));
      if (!open || !panel.current || !trigger.current) return;
      const rect = trigger.current.getBoundingClientRect();
      panel.current.style.left = `${Math.max(8, Math.min(rect.right - panel.current.offsetWidth, window.innerWidth - panel.current.offsetWidth - 8))}px`;
      panel.current.style.top = `${rect.bottom + 6}px`;
      groupColumn.current?.querySelector<HTMLButtonElement>(`[aria-expanded=true]`)?.focus();
    }}>
      <div className="ui-cascading-columns">
        <div ref={groupColumn} role="menu" aria-label="模型服务商" className="ui-cascading-groups">
          {groups.map(item => <Button key={item.id} role="menuitem" aria-haspopup="menu" aria-expanded={item.id === group?.id}
            className="ui-cascading-item" onMouseEnter={() => onGroupChange(item.id)} onFocus={() => onGroupChange(item.id)} onClick={() => onGroupChange(item.id)}>
            <span>{item.name}</span><span aria-hidden="true">›</span>
          </Button>)}
        </div>
        <div ref={modelColumn} role="menu" aria-label={`${group?.name ?? ''} 模型`} className="ui-cascading-models" aria-busy={loading}>
          {loading ? <p role="status">正在获取可用模型…</p> : group?.models.map(model => <Button key={model.id} role="menuitemradio"
            aria-checked={group.id === selectedGroup && model.id === selectedValue} className="ui-cascading-item" title={model.id}
            onClick={() => { onSelect(group.id, model.id); close(); trigger.current?.focus(); }}><span>{model.name}</span>
            {group.id === selectedGroup && model.id === selectedValue ? <span aria-hidden="true">✓</span> : null}
          </Button>)}
          {!loading && group?.message ? <p role="status">{group.message}</p> : null}
          {!loading && error ? <p role="alert">{error}</p> : null}
        </div>
      </div>
      <div className="ui-cascading-footer"><span>可用的对话模型</span><Button variant="text" disabled={loading} onClick={onRefresh}>刷新列表</Button></div>
    </div>
  </div>;
}
