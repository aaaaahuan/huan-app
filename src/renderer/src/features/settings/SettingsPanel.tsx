// 设置编辑器：草稿与已保存值分离，只有点击保存才请求主进程持久化。
import { useEffect, useRef, useState } from 'react';
import { PLATFORMS, PLATFORM_NAMES, type Platform, type SessionModes, type SessionMode, type Settings, type SettingsResult } from '@shared/contracts/settings';
import './settings.css';

export function SettingsPanel({ onClose, onSaved }: { onClose(): void; onSaved(): void }) {
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
  const [tab, setTab] = useState<'sources' | 'sessions'>('sources');
  const [activeModes, setActiveModes] = useState<SessionModes>();
  const [sessionMessage, setSessionMessage] = useState('');
  const dirty = !!draft && JSON.stringify(draft) !== baseline;

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
      const result = await window.huanApp.settings.save(draft, revision);
      // 保存失败不关闭面板，也不重置草稿，方便修正后重试。
      if (!result.ok) { setMessage(result.message); setFields(result.fields ?? {}); return; }
      onSaved();
    } catch { setMessage('未能确认保存结果，请保留输入并重试；如提示配置已变更，请重新打开设置核对。'); }
    finally { setBusy(false); }
  }
  function updateMode(platform: Platform, mode: SessionMode) {
    setDraft((previous) => previous ? { ...previous, sessions: { ...previous.sessions, [platform]: mode } } : previous);
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
        <button type="button" aria-label="关闭设置" disabled={busy} onClick={requestClose}>关闭</button>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="settings-tabs" role="tablist" aria-label="设置分类" onKeyDown={(event) => {
          if (busy || confirmClose || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 'sources' : event.key === 'End' ? 'sessions' : tab === 'sources' ? 'sessions' : 'sources';
          setTab(next);
          event.currentTarget.querySelector<HTMLButtonElement>(`#${next}-tab`)?.focus();
        }}>
          <button id="sources-tab" type="button" role="tab" aria-selected={tab === 'sources'} aria-controls="sources-panel"
            tabIndex={tab === 'sources' ? 0 : -1} disabled={busy || confirmClose} onClick={() => setTab('sources')}>收藏来源</button>
          <button id="sessions-tab" type="button" role="tab" aria-selected={tab === 'sessions'} aria-controls="sessions-panel"
            tabIndex={tab === 'sessions' ? 0 : -1} disabled={busy || confirmClose} onClick={() => setTab('sessions')}>登录与隐私</button>
        </div>
        <div className="settings-body">
          <div id="sources-panel" role="tabpanel" aria-labelledby="sources-tab" hidden={tab !== 'sources'}>
          <p className="settings-description">选择 Obsidian 中各平台的 Markdown 文件。应用只读，不修改原始笔记。</p>
          <p className="settings-note">启动时读取一次；保存后只重读发生变更的来源。各文件按原文顺序展示，不定时刷新。</p>
          {loading ? <p role="status">正在读取设置…</p> : null}
          {!draft && !loading ? <button type="button" onClick={() => void retry()}>重新读取设置</button> : null}
          {draft ? <fieldset disabled={busy || confirmClose} className="settings-sources">
            {PLATFORMS.map((platform) => {
              const source = draft.sources[platform];
              return <section className="source-card" key={platform} aria-labelledby={`${platform}-title`}>
                <div className="source-heading"><h4 id={`${platform}-title`}>{PLATFORM_NAMES[platform]}</h4>
                  <label className="source-toggle"><input type="checkbox" checked={source.enabled}
                    onChange={(event) => update(platform, { enabled: event.target.checked })} />启用来源</label></div>
                <label className="source-path-label" htmlFor={`${platform}-path`}>Markdown 文件路径</label>
                <div className="source-path-row"><input id={`${platform}-path`} type="text" value={source.path}
                  spellCheck={false} placeholder="请选择文件，或填写绝对路径" aria-invalid={!!fields[platform]}
                  aria-describedby={fields[platform] ? `${platform}-error` : undefined}
                  onChange={(event) => update(platform, { path: event.target.value })} />
                  <button type="button" onClick={() => void choose(platform)}>选择文件</button></div>
                {fields[platform] ? <p className="settings-error" id={`${platform}-error`}>{fields[platform]}</p> : null}
              </section>;
            })}
          </fieldset> : null}
          </div>
          <div id="sessions-panel" role="tabpanel" aria-labelledby="sessions-tab" hidden={tab !== 'sessions'}>
            <p className="settings-description">在原始网页中登录，同一平台的收藏复用会话，不同平台相互隔离。</p>
            <p className="settings-note">策略保存后需 Cmd+Q 完全退出并重启才生效，不迁移现有会话。改为仅本次运行不会删除之前保存的数据，如需移除请清除会话。</p>
            {draft ? <fieldset disabled={busy || confirmClose} className="settings-sources">
              {PLATFORMS.map((platform) => <section className="source-card session-card" key={platform}>
                <div className="source-heading"><h4>{PLATFORM_NAMES[platform]}</h4>
                  <span className="session-current">本轮：{!activeModes ? '读取中' : activeModes[platform] === 'persistent' ? '重启后保留' : '仅本次运行'}</span></div>
                <div className="session-options" role="group" aria-label={`${PLATFORM_NAMES[platform]} 登录态保存策略`}>
                  {(['memory', 'persistent'] as const).map((mode) => <label key={mode}>
                    <input type="radio" name={`${platform}-session`} value={mode} checked={draft.sessions[platform] === mode}
                      onChange={() => updateMode(platform, mode)} />
                    <span>{mode === 'memory' ? '仅本次运行' : '重启后保留'}</span>
                  </label>)}
                </div>
                <div className="session-actions"><span>{activeModes && draft.sessions[platform] !== activeModes[platform] ? '保存后，完全退出并重启生效' : '登录有效期由平台决定'}</span>
                  <button type="button" className="text-button" disabled={dirty || !activeModes} onClick={() => void clearSession(platform)}
                    aria-label={`清除 ${PLATFORM_NAMES[platform]} 会话`}>清除会话</button></div>
              </section>)}
            </fieldset> : <p>请先在收藏来源页加载设置。</p>}
            {dirty ? <p className="settings-note">有未保存修改，请先保存或取消，再清除会话。</p> : null}
            <p className="settings-note">会话数据仅存本机 ~/.huan-app，不上传、不读取密码。清除会话同时移除 Cookie、网站存储及缓存，不影响笔记和收藏。</p>
            {sessionMessage ? <p className="session-feedback" role="status">{sessionMessage}</p> : null}
          </div>
          {message ? <p role="alert" className="settings-error">{message}</p> : null}
          {confirmClose ? <div className="discard-prompt" role="alert">
            <p>有未保存的修改，确定放弃吗？</p><div>
              <button type="button" onClick={() => setConfirmClose(false)}>继续编辑</button>
              <button type="button" onClick={onClose}>放弃修改</button>
            </div></div> : null}
        </div>
        <div className="settings-footer"><span>huan-app · 基础版 A6 · 配置仅存本机</span><div>
          <button type="button" disabled={busy || confirmClose} onClick={requestClose}>取消</button>
          <button type="submit" className="primary-button" disabled={!draft || loading || busy || confirmClose}>
            {busy ? '处理中…' : '保存设置'}</button>
        </div></div>
      </form>
    </dialog>
  );
}
