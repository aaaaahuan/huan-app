import type { AlgorithmProblem } from '@shared/contracts/algorithms';
import { Button } from '@renderer/components/Button';

export function CategoryList({ items, selected, disabled, onSelect }: {
  items: AlgorithmProblem[]; selected: string; disabled: boolean; onSelect(category: string): void;
}) {
  // Map 保留首次出现的分类顺序，进度不受右侧筛选影响。
  const categories = new Map<string, { total: number; completed: number }>();
  for (const item of items) {
    const progress = categories.get(item.category) ?? { total: 0, completed: 0 };
    progress.total++;
    if (item.completed) progress.completed++;
    categories.set(item.category, progress);
  }
  return <aside className="algorithm-categories" aria-label="算法分类">
    <h2>分类</h2>
    <p className="algorithm-category-caption">按本地笔记顺序</p>
    <nav aria-label="分类选择">
      {Array.from(categories, ([name, progress]) => <Button key={name} className="algorithm-category"
        disabled={disabled} aria-current={name === selected ? 'page' : undefined}
        aria-label={`${name}，已完成 ${progress.completed} / ${progress.total} 题`}
        onClick={() => onSelect(name)}>
        <span className="ui-truncated" title={name}>{name}</span>
        <span className="algorithm-progress">{progress.completed}/{progress.total}</span>
      </Button>)}
    </nav>
  </aside>;
}
