import { Button } from '@renderer/components/Button';
import { Input } from '@renderer/components/Input';

export function AICard({ hasKey, value, onChange, onTest, message }: {
  hasKey: boolean; value: string | null | undefined; onChange(value: string | null | undefined): void;
  onTest(): void; message: string;
}) {
  return <section className="source-card">
    <h3>DeepSeek Flash</h3>
    <p className="settings-description">内置唯一模型，连接 DeepSeek 官方服务。只需填写自己的 API Key。</p>
    <label className="source-path-label" htmlFor="deepseek-key">API Key</label>
    <Input id="deepseek-key" type="password" autoComplete="off" spellCheck={false} maxLength={512}
      placeholder={hasKey ? '已安全保存；留空保持不变' : '输入 DeepSeek API Key'} value={value ?? ''}
      onChange={event => onChange(event.target.value || undefined)} />
    <div className="session-actions">
      <span>{value === null ? '保存后清除 Key' : hasKey ? '已配置' : '尚未配置'}</span>
      <div><Button onClick={onTest} disabled={value === null || (!hasKey && !value)}>测试连接</Button>{' '}
        <Button disabled={!hasKey && !value} onClick={() => onChange(null)}>清除 Key</Button></div>
    </div>
    <p className="settings-note">点击下方“保存设置”后生效。Key 加密存储于本机，不写入笔记；聊天只保留到退出应用。连接测试需确认，可能产生少量费用。</p>
    {message ? <p className="session-feedback" role="status">{message}</p> : null}
  </section>;
}
