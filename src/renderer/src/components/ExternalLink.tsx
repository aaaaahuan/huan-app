import type { ReactNode } from 'react';
import { Icon } from './Icon';

export function ExternalLink({ url, children, disabled, showIcon = false, onOpen }: {
  url: string; children: ReactNode; disabled?: boolean; showIcon?: boolean; onOpen(): void;
}) {
  return <a className="ui-external-link" href={url} title={url} aria-disabled={disabled || undefined}
    tabIndex={disabled ? -1 : undefined} onClick={event => {
      event.preventDefault();
      if (!disabled) onOpen();
    }}>
    <span className="ui-truncated">{children}</span>
    {showIcon ? <Icon name="external" /> : null}
  </a>;
}
