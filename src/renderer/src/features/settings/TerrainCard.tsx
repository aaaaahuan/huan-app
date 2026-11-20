import { Button } from '@renderer/components/Button';
import { Input } from '@renderer/components/Input';

export function TerrainCard({ value, autoRoot, onChange, onChoose }: {
  value: string; autoRoot: string; onChange(value: string): void; onChoose(): void;
}) {
  return <section className="source-card">
    <h3>原生地形</h3>
    <label className="source-path-label" htmlFor="terrain-root">地形建模缓存目录</label>
    <div className="source-path-row">
      <Input id="terrain-root" value={value} maxLength={4096} placeholder={autoRoot || '请选择数据目录'}
        onChange={event => onChange(event.target.value)} />
      <Button onClick={onChoose}>选择目录</Button>
    </div>
    <p className="settings-note">留空使用默认目录：{autoRoot}</p>
    <p className="settings-note">保存后使用：{value.trim() || autoRoot}</p>
    <p className="settings-note">这里只保存构建与预览缓存。作品列表始终读取 Obsidian 的 huan-path/轨迹作品记录.md；更换缓存目录不会增加或删除作品。</p>
  </section>;
}
