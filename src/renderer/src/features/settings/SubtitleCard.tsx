import { useEffect, useRef, useState } from 'react';
import type { SubtitleUsage } from '@shared/contracts/settings';
import { Button } from '@renderer/components/Button';
import { SecretInput } from '@renderer/components/Input';
import { LoadingIndicator } from '@renderer/components/LoadingIndicator';

export function SubtitleCard({ credentialId, value, active, onChange }: {
  credentialId: string | null; value: string | null | undefined; active: boolean; onChange(value: string | null): void;
}) {
  const [usage, setUsage] = useState<SubtitleUsage>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);
  const [revealedKey, setRevealedKey] = useState<{ credentialId: string; key: string }>();
  const [revealing, setRevealing] = useState(false);
  const [keyError, setKeyError] = useState('');
  const keySequence = useRef(0);
  const sequence = useRef(0);
  const showUsage = !!credentialId && value === undefined;
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
      const result = await window.huanApp.settings.revealSubtitleKey(credentialId);
      if (keySequence.current !== call) return;
      if (result.ok && result.credentialId === credentialId) { setRevealedKey({ credentialId: result.credentialId, key: result.key }); setVisible(true); }
      else setKeyError(result.ok ? '字幕凭据已变更，请重新打开设置。' : result.message);
    } catch { if (keySequence.current === call) setKeyError('无法读取字幕 Key，请重试。'); }
    finally { if (keySequence.current === call) setRevealing(false); }
  }
  async function refresh() {
    const call = ++sequence.current;
    setLoading(true); setError('');
    try {
      const next = await window.huanApp.settings.subtitleUsage();
      if (sequence.current === call && next.credentialId === credentialId) setUsage(next);
    } catch { if (sequence.current === call) setError('用量查询失败，请到官方后台查看。'); }
    finally { if (sequence.current === call) setLoading(false); }
  }
  useEffect(() => {
    if (active && showUsage) void refresh();
    return () => { sequence.current++; };
  }, [active, credentialId, showUsage]);
  const currentUsage = usage?.credentialId === credentialId ? usage : undefined;
  const savedKey = revealedKey?.credentialId === credentialId ? revealedKey.key : undefined;
  return <section className="source-card">
    <div className="source-heading"><h4>Transcript Guru</h4></div>
    <label className="source-path-label" htmlFor="subtitle-key">API Key</label>
    <SecretInput id="subtitle-key" autoComplete="off" spellCheck={false} maxLength={512}
      visible={active && visible && (value !== undefined || !!savedKey)} revealing={revealing} onToggle={() => void toggleVisibility()}
      placeholder="填写 Transcript Guru API Key" value={value === undefined ? active && visible && savedKey ? savedKey : credentialId ? '********' : '' : value ?? ''}
      onFocus={event => { if (value === undefined && credentialId) event.currentTarget.select(); }}
      onClick={event => { if (value === undefined && credentialId) event.currentTarget.select(); }}
      onChange={event => { keySequence.current++; setRevealedKey(undefined); onChange(event.target.value || null); }} />
    {keyError ? <p className="settings-error" role="alert">{keyError}</p> : null}
    {showUsage ? <section className="subtitle-usage" aria-label="当前 Key 用量" aria-busy={loading}>
      <div className="source-heading"><h4>账户用量</h4><Button variant="text" disabled={loading} onClick={() => void refresh()} aria-label="刷新字幕服务用量">{loading ? '查询中…' : '刷新'}</Button></div>
      {loading ? <LoadingIndicator label="正在加载账户用量…" /> : <p className="settings-note" role="status">{error || currentUsage?.message}</p>}
      {currentUsage?.data ? <>
        <p className="settings-note">{loading || currentUsage.stale || error ? '上次更新' : '更新时间'}：{new Date(currentUsage.data.updatedAt).toLocaleString()}</p>
        <p className="settings-note">可用 Credits：{currentUsage.data.credits} · 已预留：{currentUsage.data.reservedCredits}</p>
        <p className="settings-note">套餐每月发放：{currentUsage.data.monthlyAllowance} credits{currentUsage.data.resetsAt ? ` · 重置 ${new Date(currentUsage.data.resetsAt).toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})` : ''}</p>
        {currentUsage.data.rolling30CreditsUsed !== undefined ? <p className="settings-note">近 30 日消耗：{currentUsage.data.rolling30CreditsUsed} credits</p> : null}
      </> : null}
      <Button onClick={() => { void window.huanApp.settings.openSubtitleAccount().catch(() => setError('无法打开官方后台，请检查默认浏览器。')); }}>打开官方后台</Button>
    </section> : null}
  </section>;
}
