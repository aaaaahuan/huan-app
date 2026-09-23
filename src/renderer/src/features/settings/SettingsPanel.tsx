// 设置编辑器：草稿与已保存值分离，只有点击保存才请求主进程持久化。
import { useEffect, useRef, useState } from 'react';
import { PLATFORMS, PLATFORM_NAMES, type Platform, type Settings, type SettingsResult } from '@shared/contracts/settings';
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
  return (
    <dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title"
      onCancel={(event) => { event.preventDefault(); requestClose(); }}>
      <div className="settings-header">
        <div><p className="settings-eyebrow">HUAN-APP / PREFERENCES</p><h2 id="settings-title">设置</h2></div>
        <button type="button" aria-label="关闭设置" disabled={busy} onClick={requestClose}>关闭</button>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="settings-body">
          <h3>收藏来源</h3>
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
          {message ? <p role="alert" className="settings-error">{message}</p> : null}
          {confirmClose ? <div className="discard-prompt" role="alert">
            <p>有未保存的修改，确定放弃吗？</p><div>
              <button type="button" onClick={() => setConfirmClose(false)}>继续编辑</button>
              <button type="button" onClick={onClose}>放弃修改</button>
            </div></div> : null}
        </div>
        <div className="settings-footer"><span>配置仅保存在本机 · ~/.huan-app/settings.json</span><div>
          <button type="button" disabled={busy || confirmClose} onClick={requestClose}>取消</button>
          <button type="submit" className="primary-button" disabled={!draft || loading || busy || confirmClose}>
            {busy ? '处理中…' : '保存设置'}</button>
        </div></div>
      </form>
    </dialog>
  );
}
