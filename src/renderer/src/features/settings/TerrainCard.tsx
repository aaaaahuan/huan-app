import { Button } from '@renderer/components/Button';
import { Input } from '@renderer/components/Input';

export function TerrainCard({ value, autoRoot, onChange, onChoose }: {
  value: string; autoRoot: string; onChange(value: string): void; onChoose(): void;
}) {
  return <section className="source-card">
    <h3>地形 / huan-path</h3>
    <label className="source-path-label" htmlFor="terrain-root">地形数据目录 (Obsidian)</label>
    <div className="source-path-row">
      <Input id="terrain-root" value={value} maxLength={4096} placeholder={autoRoot || '请选择数据目录'}
        onChange={event => onChange(event.target.value)} />
      <Button onClick={onChoose}>选择目录</Button>
    </div>
    <p className="settings-note">留空使用默认目录：{autoRoot}</p>
    <p className="settings-note">保存后使用：{value.trim() || autoRoot}</p>
    <p className="settings-note">jobs/ 和 tracks/ 保存在此目录内。更换目录会重启自有地形服务并重载页面。</p>
  </section>;
}
