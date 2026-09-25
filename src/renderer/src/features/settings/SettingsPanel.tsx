// 设置编辑器：草稿与已保存值分离，只有点击保存才请求主进程持久化。
import { useEffect, useRef, useState } from 'react';
import { PLATFORMS, PLATFORM_NAMES, type Platform, type SessionModes, type SessionMode, type Settings, type SettingsResult } from '@shared/contracts/settings';
import { Button } from '@renderer/components/Button';
import { Tabs } from '@renderer/components/Tabs';
import { SourceCard } from './SourceCard';
import { SessionCard } from './SessionCard';
import { AICard } from './AICard';
import './settings.css';

export function SettingsPanel({ onClose, onSaved, initialTab = 'sources' }: {
  onClose(): void; onSaved(): void; initialTab?: 'sources' | 'ai';
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Settings>();
  const [baseline, setBaseline] = useState('');
  // 修订标识原样交回主进程，用于检查用户编辑期间磁盘配置是否已变化。
  const [revision, setRevision] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [fields, setFields] = useState<Partial<Record<Platform, string>>>({});
  const [confirmClose, setConfirmClose] = useState(false);
  const [tab, setTab] = useState<'sources' | 'sessions' | 'ai'>(initialTab);
  const [keyChange, setKeyChange] = useState<string | null>();
  const [aiMessage, setAIMessage] = useState('');
  const [activeModes, setActiveModes] = useState<SessionModes>();
  const [sessionMessage, setSessionMessage] = useState('');
  const dirty = keyChange !== undefined || (!!draft && JSON.stringify(draft) !== baseline);

  function accept(result: SettingsResult) {
    if (!result.ok) { setMessage(result.message); return; }
    setDraft(result.settings);
    setBaseline(JSON.stringify(result.settings));
    setRevision(result.revision);
    setMessage('');
  }
  useEffect(() => {
    // 原生 dialog 提供模态焦点管理；清理函数兼容开发模式下的重复挂载。
    const element = dialog.current!;
    element.showModal();
    let cancelled = false;
    void window.huanApp.settings.load().then(
      (result) => { if (!cancelled) accept(result); },
      () => { if (!cancelled) setMessage('无法连接设置服务，请重试。'); }
    ).finally(() => { if (!cancelled) setLoading(false); });
    void window.huanApp.browser.sessionModes().then(
      (value) => { if (!cancelled) setActiveModes(value); },
      () => { if (!cancelled) setSessionMessage('无法读取本轮会话策略，请重新打开设置。'); }
    );
    return () => { cancelled = true; element.close(); };
  }, []);
  useEffect(() => {
    // 退出应用或卸载页面时保护草稿；最终是否放弃由主进程的原生确认框决定。
    if (!dirty && !busy) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty, busy]);

  async function retry() {
    setLoading(true);
    try { accept(await window.huanApp.settings.load()); }
    catch { setMessage('无法连接设置服务，请重试。'); }
    finally { setLoading(false); }
  }
  function requestClose() {
    // 关闭按钮、取消和 Escape 复用同一条离开规则。
    if (busy) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  }
  function update(platform: Platform, change: Partial<Settings['sources'][Platform]>) {
    // 只更新当前平台的草稿，并清除它的旧校验提示，不影响其他平台输入。
    setDraft((previous) => previous ? {
      ...previous, sources: { ...previous.sources, [platform]: { ...previous.sources[platform], ...change } }
    } : previous);
    setFields((previous) => ({ ...previous, [platform]: undefined }));
    setMessage('');
  }
  async function choose(platform: Platform) {
    setBusy(true);
    try {
      const result = await window.huanApp.settings.chooseFile();
      if (!result.ok) setMessage(result.message);
      // 取消系统文件选择器不等于清空路径，保留用户之前的输入。
      else if (result.path !== null) update(platform, { path: result.path });
    } catch { setMessage('无法选择文件，请重试。'); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    setMessage('');
    setFields({});
    try {
      const result = await window.huanApp.settings.save(draft, revision, keyChange);
      // 保存失败不关闭面板，也不重置草稿，方便修正后重试。
      if (!result.ok) {
        setMessage(result.message); setFields(result.fields ?? {});
        if (result.fields) setTab('sources');
        return;
      }
      setKeyChange(undefined); onSaved();
    } catch { setMessage('未能确认保存结果，请保留输入并重试；如提示配置已变更，请重新打开设置核对。'); }
    finally { setBusy(false); }
  }
  function updateMode(platform: Platform, mode: SessionMode) {
    setDraft((previous) => previous ? { ...previous, sessions: { ...previous.sessions, [platform]: mode } } : previous);
  }
  async function testKey() {
    setBusy(true); setAIMessage('正在测试…');
    try {
      const result = await window.huanApp.ai.testKey(keyChange ?? '');
      setAIMessage(result.ok ? result.value : result.message);
    } catch { setAIMessage('连接测试失败，请重试。'); }
    finally { setBusy(false); }
  }
  async function clearSession(platform: Platform) {
    if (busy || dirty) return;
    setBusy(true);
    setSessionMessage('');
    try {
      // 主进程再显示原生确认框；取消不会关闭页面或清除任何数据。
      const result = await window.huanApp.browser.clearSession(platform);
      if (!result.ok) setSessionMessage(result.message);
      else if (!result.cancelled) setSessionMessage(`${PLATFORM_NAMES[platform]} 的本地会话已清除，收藏保持不变。`);
    } catch { setSessionMessage('未能确认清除结果，请重试。'); }
    finally { setBusy(false); }
  }
  return (
    <dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title"
      onCancel={(event) => { event.preventDefault(); requestClose(); }}>
      <div className="settings-header">
        <div><h2 id="settings-title">设置</h2></div>
        <Button aria-label="关闭设置" disabled={busy} onClick={requestClose}>关闭</Button>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <Tabs<'sources' | 'sessions' | 'ai'> className="settings-tabs" label="设置分类" value={tab} onChange={setTab} disabled={busy || confirmClose}
          options={[{ value: 'sources', label: '收藏来源' }, { value: 'sessions', label: '登录与隐私' }, { value: 'ai', label: 'AI 伴读' }]} />
        <div className="settings-body">
          <div id="sources-panel" role="tabpanel" aria-labelledby="sources-tab" hidden={tab !== 'sources'}>
          <p className="settings-description">选择 Obsidian 中各平台的 Markdown 文件。应用只读，不修改原始笔记。</p>
          <p className="settings-note">启动时读取一次；保存后只重读发生变更的来源。各文件按原文顺序展示，不定时刷新。</p>
          {loading ? <p role="status">正在读取设置…</p> : null}
          {!draft && !loading ? <Button onClick={() => void retry()}>重新读取设置</Button> : null}
          {draft ? <fieldset disabled={busy || confirmClose} className="settings-sources">
            {PLATFORMS.map((platform) => <SourceCard key={platform} platform={platform} source={draft.sources[platform]}
              error={fields[platform]} onChange={(change) => update(platform, change)} onChoose={() => void choose(platform)} />)}
          </fieldset> : null}
          </div>
          <div id="sessions-panel" role="tabpanel" aria-labelledby="sessions-tab" hidden={tab !== 'sessions'}>
            <p className="settings-description">在原始网页中登录，同一平台的收藏复用会话，不同平台相互隔离。</p>
            <p className="settings-note">策略保存后需 Cmd+Q 完全退出并重启才生效，不迁移现有会话。改为仅本次运行不会删除之前保存的数据，如需移除请清除会话。</p>
            {draft ? <fieldset disabled={busy || confirmClose} className="settings-sources">
              {PLATFORMS.map((platform) => <SessionCard key={platform} platform={platform} mode={draft.sessions[platform]}
                activeMode={activeModes?.[platform]} dirty={dirty} onChange={(mode) => updateMode(platform, mode)}
                onClear={() => void clearSession(platform)} />)}
            </fieldset> : <p>请先在收藏来源页加载设置。</p>}
            {dirty ? <p className="settings-note">有未保存修改，请先保存或取消，再清除会话。</p> : null}
            <p className="settings-note">会话数据仅存本机 ~/.huan-app，不上传、不读取密码。清除会话同时移除 Cookie、网站存储及缓存，不影响笔记和收藏。</p>
            {sessionMessage ? <p className="session-feedback" role="status">{sessionMessage}</p> : null}
          </div>
          <div role="tabpanel" id="ai-panel" aria-labelledby="ai-tab" hidden={tab !== 'ai'}>
            {draft ? <fieldset className="settings-sources" disabled={busy || confirmClose}>
              <AICard hasKey={!!draft.ai.credentialId} value={keyChange} onChange={setKeyChange}
                onTest={() => void testKey()} message={aiMessage} />
            </fieldset> : <p>正在读取设置…</p>}
          </div>
          {message ? <p role="alert" className="settings-error">{message}</p> : null}
          {confirmClose ? <div className="discard-prompt" role="alert">
            <p>有未保存的修改，确定放弃吗？</p><div>
              <Button onClick={() => setConfirmClose(false)}>继续编辑</Button>
              <Button onClick={onClose}>放弃修改</Button>
            </div></div> : null}
        </div>
        <div className="settings-footer"><span>huan-app · 配置仅存本机</span><div>
          <Button disabled={busy || confirmClose} onClick={requestClose}>取消</Button>
          <Button type="submit" variant="primary" disabled={!draft || loading || busy || confirmClose}>
            {busy ? '处理中…' : '保存设置'}</Button>
        </div></div>
      </form>
    </dialog>
  );
}
