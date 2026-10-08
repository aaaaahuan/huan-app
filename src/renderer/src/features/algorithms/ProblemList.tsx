import type { AlgorithmProblem } from '@shared/contracts/algorithms';
import { Checkbox } from '@renderer/components/Checkbox';
import { ExternalLink } from '@renderer/components/ExternalLink';

export function ProblemList({ items, disabled, onToggle, onOpen }: {
  items: AlgorithmProblem[]; disabled: boolean; onToggle(item: AlgorithmProblem): void; onOpen(item: AlgorithmProblem): void;
}) {
  return <div className="algorithm-table-frame">
    <table className="algorithm-table" aria-label="题目清单">
      <colgroup><col className="algorithm-completion-column" /><col className="algorithm-title-column" /><col /></colgroup>
      <thead><tr><th scope="col">完成</th><th scope="col">题目</th><th scope="col">帖子链接</th></tr></thead>
      <tbody>{items.map(item => <tr key={item.id} className={item.completed ? 'algorithm-completed' : undefined}>
        <td><Checkbox id={`algorithm-completed-${item.id}`} label={`标记 ${item.title} 已完成`} hideLabel checked={item.completed} disabled={disabled}
          onChange={() => onToggle(item)} /></td>
        <td title={item.title}><ExternalLink url={item.url} disabled={disabled} onOpen={() => onOpen(item)}>{item.title}</ExternalLink></td>
        <td><ExternalLink url={item.url} disabled={disabled} showIcon onOpen={() => onOpen(item)}>{item.url}</ExternalLink></td>
      </tr>)}</tbody>
    </table>
  </div>;
}
