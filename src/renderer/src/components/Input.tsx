import type { ComponentProps } from 'react';
import { Icon, type IconName } from './Icon';

export function Input({ className = '', ...props }: ComponentProps<'input'>) {
  return <input className={`ui-input ${className}`} {...props} />;
}

export function IconInput({ icon, ...props }: ComponentProps<'input'> & { icon: IconName }) {
  return <span className="ui-icon-input"><Icon name={icon} /><Input {...props} /></span>;
}
