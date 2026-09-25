import { Button } from './Button';

export function Tabs<T extends string>({ label, value, options, disabled, onChange, className = '' }: {
  label: string; value: T; options: readonly { value: T; label: string }[]; disabled?: boolean; className?: string; onChange(value: T): void;
}) {
  return <div className={`ui-tabs ${className}`} role="tablist" aria-label={label} onKeyDown={(event) => {
    if (disabled || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = options.findIndex((option) => option.value === value);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
    const next = options[nextIndex];
    if (!next) return;
    onChange(next.value);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
  }}>{options.map((option) => <Button key={option.value} id={`${option.value}-tab`} role="tab"
    aria-selected={value === option.value} aria-controls={`${option.value}-panel`} tabIndex={value === option.value ? 0 : -1}
    disabled={disabled} onClick={() => onChange(option.value)}>{option.label}</Button>)}</div>;
}
