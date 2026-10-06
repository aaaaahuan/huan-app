import { Button } from '@renderer/components/Button';
import { Icon } from '@renderer/components/Icon';

export type SystemPage = 'reading' | 'translation';
export function Navigation({ active, busy, settingsDisabled, onChange, onSettings }: {
  active: SystemPage; busy: boolean; settingsDisabled: boolean;
  onChange(page: SystemPage): void; onSettings(): void;
}) {
  return <nav className="system-navigation" aria-label="系统导航">
    <div className="navigation-brand">huan</div>
    <div className="navigation-pages">
      <Button className="navigation-item" aria-label="阅读" aria-current={active === 'reading' ? 'page' : undefined}
        disabled={busy} onClick={() => onChange('reading')}>
        <Icon name="book" /><span className="navigation-label">阅读</span>
      </Button>
      <Button className="navigation-item" aria-label="翻译" aria-current={active === 'translation' ? 'page' : undefined}
        disabled={busy} onClick={() => onChange('translation')}>
        <Icon name="translate" /><span className="navigation-label">翻译</span>
      </Button>
    </div>
    <Button className="navigation-item navigation-settings" aria-label="设置" disabled={settingsDisabled}
      onClick={onSettings}><Icon name="settings" /><span className="navigation-label">设置</span></Button>
  </nav>;
}
