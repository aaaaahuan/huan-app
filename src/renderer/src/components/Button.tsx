import type { ComponentProps } from 'react';
import { Icon, type IconName } from './Icon';

export function Button({ type = 'button', className = '', variant = 'default', ...props }: ComponentProps<'button'> & { variant?: 'default' | 'primary' | 'text' }) {
  return <button type={type} className={`ui-button ui-button--${variant} ${className}`} {...props} />;
}

export function IconButton({ icon, label, className = '', ...props }: Omit<ComponentProps<'button'>, 'children' | 'aria-label'> & { icon: IconName; label: string }) {
  return <Button className={`ui-icon-button ${className}`} title={label} aria-label={label} {...props}><Icon name={icon} /></Button>;
}
