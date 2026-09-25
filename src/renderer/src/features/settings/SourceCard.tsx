import { PLATFORM_NAMES, type Platform, type Settings } from '@shared/contracts/settings';
import { Button } from '@renderer/components/Button';
import { Input } from '@renderer/components/Input';

export function SourceCard({ platform, source, error, onChange, onChoose }: {
  platform: Platform; source: Settings['sources'][Platform]; error?: string;
  onChange(change: Partial<Settings['sources'][Platform]>): void; onChoose(): void;
}) {
  return <section className="source-card" aria-labelledby={`${platform}-title`}>
    <div className="source-heading"><h4 id={`${platform}-title`}>{PLATFORM_NAMES[platform]}</h4>
      <label className="source-toggle"><input type="checkbox" checked={source.enabled}
        onChange={(event) => onChange({ enabled: event.target.checked })} />启用来源</label></div>
    <label className="source-path-label" htmlFor={`${platform}-path`}>Markdown 文件路径</label>
    <div className="source-path-row"><Input id={`${platform}-path`} type="text" value={source.path}
      spellCheck={false} placeholder="请选择文件，或填写绝对路径" aria-invalid={!!error}
      aria-describedby={error ? `${platform}-error` : undefined} onChange={(event) => onChange({ path: event.target.value })} />
      <Button onClick={onChoose}>选择文件</Button></div>
    {error ? <p className="settings-error" id={`${platform}-error`}>{error}</p> : null}
  </section>;
}
