import { Button } from '@renderer/components/Button';
import { SYSTEM_PAGES, SYSTEM_PAGE_NAMES, type SystemPage } from '@shared/contracts/settings';
export type { SystemPage } from '@shared/contracts/settings';

export function Navigation({ active, busy, visibleTabs, onChange }: {
  active: SystemPage; busy: boolean; visibleTabs: SystemPage[]; onChange(page: SystemPage): void;
}) {
  return <nav className="system-navigation" aria-label="系统导航">
    <div className="navigation-pages">
      {SYSTEM_PAGES.filter(page => visibleTabs.includes(page)).map(page =>
        <Button key={page} className="navigation-item" aria-label={SYSTEM_PAGE_NAMES[page]}
          aria-current={active === page ? 'page' : undefined} disabled={busy} onClick={() => onChange(page)}>
          {SYSTEM_PAGE_NAMES[page]}
        </Button>)}
    </div>
  </nav>;
}
