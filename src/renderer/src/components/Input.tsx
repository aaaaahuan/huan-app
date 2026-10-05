import type { ComponentProps } from 'react';
import { Icon, type IconName } from './Icon';
import { IconButton } from './Button';

export function Input({ className = '', ...props }: ComponentProps<'input'>) {
  return <input className={`ui-input ${className}`} {...props} />;
}

export function IconInput({ icon, ...props }: ComponentProps<'input'> & { icon: IconName }) {
  return <span className="ui-icon-input"><Icon name={icon} /><Input {...props} /></span>;
}

export function SecretInput({ visible, revealing = false, onToggle, ...props }: ComponentProps<'input'> & {
  visible: boolean; revealing?: boolean; onToggle(): void;
}) {
  return <span className="ui-secret-input">
    <Input {...props} type={visible ? 'text' : 'password'} disabled={props.disabled || revealing} />
    <IconButton icon={visible ? 'eye-off' : 'eye'} label={revealing ? '正在读取 API Key' : visible ? '隐藏 API Key' : '显示完整 API Key'}
      aria-pressed={visible} aria-controls={props.id} disabled={props.disabled || revealing || !props.value} onClick={onToggle} />
  </span>;
}
