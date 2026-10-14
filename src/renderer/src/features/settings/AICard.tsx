import { useEffect, useRef, useState } from 'react';
import type { Settings } from '@shared/contracts/settings';
import { Button } from '@renderer/components/Button';
import { Input, SecretInput } from '@renderer/components/Input';

export function AICard({ credentialId, value, active, onChange, onTest, message, notesPath, onNotesPathChange, localModel, onLocalModelChange }: {
  credentialId: string | null; value: string | null | undefined; active: boolean; onChange(value: string | null | undefined): void;
  onTest(): void; message: string;
  notesPath: string; onNotesPathChange(value: string): void;
  localModel: Settings['localModel']; onLocalModelChange(value: Partial<Settings['localModel']>): void;
}) {
  const hasKey = !!credentialId;
  const [visible, setVisible] = useState(false);
  const [revealedKey, setRevealedKey] = useState<{ credentialId: string; key: string }>();
  const [revealing, setRevealing] = useState(false);
  const [keyError, setKeyError] = useState('');
  const keySequence = useRef(0);
  useEffect(() => {
    setVisible(false); setRevealedKey(undefined); setRevealing(false); setKeyError('');
    return () => { keySequence.current++; };
  }, [active, credentialId]);
  useEffect(() => {
    keySequence.current++; setRevealedKey(undefined); setRevealing(false); setKeyError('');
    if (value === undefined) setVisible(false);
  }, [value]);
  async function toggleVisibility() {
    if (visible) {
      keySequence.current++; setVisible(false); setRevealedKey(undefined);
      return;
    }
    if (value !== undefined || !credentialId) { setVisible(true); return; }
    const call = ++keySequence.current;
    setRevealing(true); setKeyError('');
    try {
      const result = await window.huanApp.settings.revealAIKey(credentialId);
      if (keySequence.current !== call) return;
      if (result.ok && result.credentialId === credentialId) { setRevealedKey({ credentialId: result.credentialId, key: result.key }); setVisible(true); }
      else setKeyError(result.ok ? 'AI 凭据已变更，请重新打开设置。' : result.message);
    } catch { if (keySequence.current === call) setKeyError('无法读取 DeepSeek Key，请重试。'); }
    finally { if (keySequence.current === call) setRevealing(false); }
  }
  const savedKey = revealedKey?.credentialId === credentialId ? revealedKey.key : undefined;
  return <section className="source-card">
    <h3>DeepSeek Flash</h3>
    <p className="settings-description">在线模式连接 DeepSeek 官方服务。只需填写自己的 API Key。</p>
    <label className="source-path-label" htmlFor="deepseek-key">API Key</label>
    <SecretInput id="deepseek-key" autoComplete="off" spellCheck={false} maxLength={512}
      visible={active && visible && (value !== undefined || !!savedKey)} revealing={revealing} onToggle={() => void toggleVisibility()}
      placeholder={hasKey ? '已安全保存；留空保持不变' : '输入 DeepSeek API Key'}
      value={value === undefined ? active && visible && savedKey ? savedKey : hasKey ? '********' : '' : value ?? ''}
      onFocus={event => { if (value === undefined && hasKey) event.currentTarget.select(); }}
      onClick={event => { if (value === undefined && hasKey) event.currentTarget.select(); }}
      onChange={event => { keySequence.current++; setRevealedKey(undefined); onChange(event.target.value || undefined); }} />
    {keyError ? <p className="settings-error" role="alert">{keyError}</p> : null}
    <div className="session-actions">
      <span>{value === null ? '保存后清除 Key' : hasKey ? '已配置' : '尚未配置'}</span>
      <div><Button onClick={onTest} disabled={value === null || (!hasKey && !value)}>测试连接</Button>{' '}
        <Button disabled={!hasKey && !value} onClick={() => onChange(null)}>清除 Key</Button></div>
    </div>
    <p className="settings-note">点击下方“保存设置”后生效。Key 加密存储于本机，不写入笔记；对话界面退出后清空，Pi Session 与执行记录保存在本机 ~/.huan-app/ai。连接测试需确认，可能产生少量费用。</p>
    {message ? <p className="session-feedback" role="status">{message}</p> : null}
    <label className="source-path-label" htmlFor="notes-path">Obsidian 笔记库目录</label>
    <Input id="notes-path" value={notesPath} placeholder="填写笔记库绝对路径；留空关闭文件工具"
      onChange={event => onNotesPathChange(event.target.value)} />
    <p className="settings-note">允许 AI 读取目录内 Markdown，内容会发送给 DeepSeek；每次写入均需确认。清空并保存后，下次提问不再提供文件工具；已经发送的内容仍在本次对话中。</p>
    <h3>离线模型</h3>
    <label className="source-path-label" htmlFor="local-model-path">Qwen3.5-4B 权重文件</label>
    <Input id="local-model-path" value={localModel.modelPath} autoComplete="off" spellCheck={false} maxLength={4096}
      placeholder="填写 .gguf 权重文件的绝对路径"
      onChange={event => onLocalModelChange({ modelPath: event.target.value })} />
    <label className="source-path-label" htmlFor="local-server-path">llama-server 程序</label>
    <Input id="local-server-path" value={localModel.serverPath} autoComplete="off" spellCheck={false} maxLength={4096}
      placeholder="填写可信 llama-server 可执行文件的绝对路径"
      onChange={event => onLocalModelChange({ serverPath: event.target.value })} />
    <p className="settings-note">模型资源保留在应用包外。保存后，下次离线调用会尝试加载；启动失败时，可修正路径并保存后再次调用。已驻留模型更换路径需 Cmd+Q 完全退出并重启。只选择可信的 llama-server，程序会以当前用户权限运行。</p>
  </section>;
}
