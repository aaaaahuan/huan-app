import { PLATFORM_NAMES, type Platform, type SessionMode } from '@shared/contracts/settings';
import { Button } from '@renderer/components/Button';

export function SessionCard({ platform, mode, activeMode, dirty, onChange, onClear }: {
  platform: Platform; mode: SessionMode; activeMode?: SessionMode; dirty: boolean;
  onChange(mode: SessionMode): void; onClear(): void;
}) {
  return <section className="source-card session-card">
    <div className="source-heading"><h4>{PLATFORM_NAMES[platform]}</h4>
      <span className="session-current">本轮：{!activeMode ? '读取中' : activeMode === 'persistent' ? '重启后保留' : '仅本次运行'}</span></div>
    <div className="session-options" role="group" aria-label={`${PLATFORM_NAMES[platform]} 登录态保存策略`}>
      {(['memory', 'persistent'] as const).map((value) => <label key={value}>
        <input type="radio" name={`${platform}-session`} value={value} checked={mode === value} onChange={() => onChange(value)} />
        <span>{value === 'memory' ? '仅本次运行' : '重启后保留'}</span>
      </label>)}
    </div>
    <div className="session-actions"><span>{activeMode && mode !== activeMode ? '保存后，完全退出并重启生效' : '登录有效期由平台决定'}</span>
      <Button variant="text" disabled={dirty || !activeMode} onClick={onClear} aria-label={`清除 ${PLATFORM_NAMES[platform]} 会话`}>清除会话</Button></div>
  </section>;
}
