import { useEffect, useRef, useState } from 'react';
import type { AIResult, ConversationState } from '@shared/contracts/ai';
import type { ReaderState } from '@shared/contracts/browser';
import { Button, IconButton } from '@renderer/components/Button';
import { Icon } from '@renderer/components/Icon';
import './ai-chat.css';

const phases = { idle: '临时对话', preparing: '正在准备…', generating: '正在回答…', stopping: '正在停止…', blocked: '等待停止确认' };
const pageStatuses = { empty: '未选择页面，可直接聊天', loading: '当前页面正文提取中', ready: '当前页面已缓存，AI 可按需读取',
  unavailable: '当前页面正文不可用，不影响聊天', unsupported: '当前页面暂不支持提取，可直接聊天' };
const conversationKey = 'main';
const statuses = { generating: '正在回答', complete: '', stopped: '已停止', failed: '失败', truncated: '回答已达到长度上限' };

export function AIChat({ settingsRevision, collapsed, onConfigure }: {
  settingsRevision: number; collapsed: boolean; onConfigure(): void;
}) {
  const [conversation, setConversation] = useState<ConversationState>();
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  const editVersion = useRef(0);
  const submittedVersion = useRef<number | undefined>(undefined);
  const latestRevision = useRef(0);
  const hydrated = useRef(false);
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState(false);
  const [commandBusy, setCommandBusy] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [page, setPage] = useState<ReaderState>();
  const current = conversation?.key === conversationKey ? conversation : undefined;
  const busy = current?.phase !== 'idle';

  useEffect(() => {
    let cancelled = false;
    const accept = (next: ReaderState) => {
      if (!cancelled) setPage(previous => !previous || next.revision > previous.revision ? next : previous);
    };
    const off = window.huanApp.browser.onState(accept);
    void window.huanApp.browser.get().then(accept).catch(() => undefined);
    return () => { cancelled = true; off(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.huanApp.settings.load().then(result => {
      if (!cancelled) setConfigured(result.ok && !!result.settings.ai.credentialId);
    }).catch(() => { if (!cancelled) setConfigured(false); });
    return () => { cancelled = true; };
  }, [settingsRevision]);

  useEffect(() => {
    let cancelled = false;
    setError('');
    setConfirmRestart(false);
    setConversation(undefined);
    setDraft('');
    draftRef.current = '';

    editVersion.current = 0; submittedVersion.current = undefined; latestRevision.current = 0;
    hydrated.current = false;

    const accept = (state: ConversationState) => {
      // 首次查询和状态推送可能乱序，只接收当前会话更新的版本。
      if (cancelled || state.key !== conversationKey || state.revision <= latestRevision.current) return false;
      latestRevision.current = state.revision;
      if (!hydrated.current) {
        hydrated.current = true;
        if (editVersion.current === 0) { draftRef.current = state.draft; setDraft(state.draft); }
      }
      setConversation(previous => !previous || state.revision > previous.revision ? state : previous);
      const latest = state.entries.at(-1);
      // 清空已发送文本或恢复失败草稿时，必须保留用户发送后新编辑的内容。
      if (latest?.status === 'generating' && submittedVersion.current === editVersion.current && !state.draft) {
        draftRef.current = ''; setDraft('');
      }
      if (state.phase === 'idle' && submittedVersion.current === editVersion.current && state.draft) {
        draftRef.current = state.draft; setDraft(state.draft);
      }
      return true;
    };

    const off = window.huanApp.ai.onState(accept);
    void window.huanApp.ai.get(conversationKey).then(result => {
      if (cancelled) return;
      if (!result.ok) { setError(result.message); return; }
      accept(result.value);
    }).catch(() => { if (!cancelled) setError('无法读取对话。'); });
    return () => { cancelled = true; off(); };
  }, []);

  async function command(action: () => Promise<AIResult<unknown>>) {
    if (commandBusy) return;
    setCommandBusy(true); setError('');
    try { const result = await action(); if (!result.ok) setError(result.message); }
    catch { setError('操作失败，请重试。'); }
    finally { setCommandBusy(false); }
  }
  function edit(text: string) {
    editVersion.current++;
    setDraft(text); draftRef.current = text;
    if (current) void window.huanApp.ai.draft({ key: current.key, instanceId: current.instanceId }, text)
      .catch(() => setError('草稿同步失败。'));
  }
  function owner() { return { key: current!.key, instanceId: current!.instanceId }; }
  function send() {
    if (!current || busy || !configured || !draft.trim()) return;
    submittedVersion.current = editVersion.current;
    void command(() => window.huanApp.ai.send({ ...owner(), requestId: crypto.randomUUID(), text: draft }));
  }
  async function restart() {
    if (!current) return;
    await command(async () => {
      const result = await window.huanApp.ai.restart(owner());
      if (result.ok) { setConversation(result.value); draftRef.current = ''; setDraft(''); setConfirmRestart(false); }
      return result;
    });
  }
  if (!configured) return <aside id="ai-chat" className="ai-chat" hidden={collapsed} aria-label="AI 辅助阅读">
    <div className="ai-unconfigured">
      <Icon name="book" width="48" height="48" />
      <p>需要配置api-key后可用ai伴读能力</p>
      <Button onClick={onConfigure}>配置 DeepSeek</Button>
    </div>
  </aside>;

  return <aside id="ai-chat" className="ai-chat" hidden={collapsed} aria-label="AI 辅助阅读">
    <div className="ai-heading">
      <IconButton className="ai-new-chat" icon="plus" label="新开对话" disabled={!current || commandBusy} onClick={() => setConfirmRestart(true)} /></div>
    <div className="ai-messages">
      {!current?.entries.length ? <p className="ai-empty">可以直接提问，也可以让 AI 按需读取已缓存的帖子。切换帖子不会清空对话。</p> : null}
      {current?.entries.map(entry => <article className="ai-turn" key={entry.id}>
        <p className="ai-question">{entry.question}</p>
        {entry.contextNotice ? <p className="ai-hint">{entry.contextNotice}</p> : null}
        {entry.sources.map(source => <details className="ai-material" key={source.id}>
          <summary>已读取：{source.title || '页面正文'}</summary>
          <p>{source.url}</p>
          <p>读取了缓存正文片段，不包含图片或视频内容。{source.truncated ? '缓存正文已截断。' : ''}</p>
        </details>)}
        <div className="ai-answer">{entry.answer || (entry.status === 'generating' ? '正在等待回复…' : '')}</div>
        {statuses[entry.status] ? <small>{statuses[entry.status]}</small> : null}
        {entry.error ? <p className="ai-error">{entry.error}</p> : null}
      </article>)}
    </div>
    <div className="ai-composer">
      {confirmRestart ? <div className="ai-notice"><p>清空当前对话和草稿并新开对话？页面缓存与 API Key 不受影响。</p>
        <Button onClick={() => setConfirmRestart(false)}>取消</Button>{' '}<Button onClick={() => void restart()}>确认新开对话</Button></div> : null}
      <p className="ai-hint" role="status">{pageStatuses[page?.contentStatus ?? 'empty']}</p>
      {error || current?.error ? <p className="ai-error" role="alert">{error || current?.error}</p> : null}
      <label className="visually-hidden" htmlFor="ai-question">向 AI 提问</label>
      <textarea id="ai-question" placeholder="向 AI 提问…" value={draft} maxLength={8000}
        disabled={!current || !configured} onChange={event => edit(event.target.value)}
        onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} />
      <div className="ai-actions">
        {current && busy ? <Button disabled={commandBusy || current.phase === 'stopping'}
          onClick={() => void command(() => window.huanApp.ai.stop(owner()))}>停止</Button> : <Button variant="primary"
          disabled={!current || !configured || !draft.trim() || commandBusy} onClick={() => send()}>发送</Button>}
      </div>
      <p className="ai-hint" role="status">{current ? phases[current.phase] : '正在准备对话'} · ⌘ Enter 发送 · 退出不保留</p>
    </div>
  </aside>;
}
