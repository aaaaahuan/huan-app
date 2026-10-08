import { Button } from '@renderer/components/Button';

export type SystemPage = 'reading' | 'translation' | 'algorithms';
export function Navigation({ active, busy, onChange }: {
  active: SystemPage; busy: boolean; onChange(page: SystemPage): void;
}) {
  return <nav className="system-navigation" aria-label="系统导航">
    <div className="navigation-pages">
      <Button className="navigation-item" aria-label="阅读" aria-current={active === 'reading' ? 'page' : undefined}
        disabled={busy} onClick={() => onChange('reading')}>
        阅读
      </Button>
      <Button className="navigation-item" aria-label="翻译" aria-current={active === 'translation' ? 'page' : undefined}
        disabled={busy} onClick={() => onChange('translation')}>
        翻译
      </Button>
      <Button className="navigation-item" aria-label="算法训练" aria-current={active === 'algorithms' ? 'page' : undefined}
        disabled={busy} onClick={() => onChange('algorithms')}>
        算法训练
      </Button>
    </div>
  </nav>;
}
