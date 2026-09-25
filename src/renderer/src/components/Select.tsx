import type { ComponentProps } from 'react';
import { Icon } from './Icon';

// 受控原生选择器保留系统菜单与键盘行为，不自行复制一套下拉状态。
export function Select<T extends string>({ value, options, onValueChange, className = '', ...props }: Omit<ComponentProps<'select'>, 'value' | 'defaultValue' | 'onChange' | 'children'> & {
  value: T; options: readonly { value: T; label: string }[]; onValueChange(value: T): void;
}) {
  return <span className="ui-select"><select {...props} className={`ui-input ${className}`} value={value} onChange={(event) => {
    const option = options.find((entry) => entry.value === event.target.value);
    if (option) onValueChange(option.value);
  }}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><Icon name="chevron" /></span>;
}
