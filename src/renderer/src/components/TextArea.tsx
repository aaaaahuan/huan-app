import type { ComponentProps } from 'react';

export function TextArea({ className = '', ...props }: ComponentProps<'textarea'>) {
  return <textarea className={`ui-input ui-textarea ${className}`} {...props} />;
}
