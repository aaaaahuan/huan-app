import type { ComponentProps } from 'react';

export function Checkbox({ label, hideLabel = false, className = '', ...props }:
  Omit<ComponentProps<'input'>, 'type'> & { label: string; hideLabel?: boolean }) {
  return <label className={`ui-checkbox ${className}`}>
    <input type="checkbox" {...props} />
    <span className={hideLabel ? 'visually-hidden' : undefined}>{label}</span>
  </label>;
}
