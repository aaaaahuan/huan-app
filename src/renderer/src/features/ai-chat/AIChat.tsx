import { useEffect, useRef, useState } from 'react';
import type { AIResult, ChatEntry, ConversationState } from '@shared/contracts/ai';
import type { ReaderState } from '@shared/contracts/browser';
import { youtubeVideoId } from '@shared/contracts/subtitles';
import { Button } from '@renderer/components/Button';
import { ExecutionMetrics } from '@renderer/components/ExecutionMetrics';
import { Icon } from '@renderer/components/Icon';
import './ai-chat.css';
import type { ModelSelection } from '@shared/contracts/models';

const phases = { idle: '本轮对话', preparing: '正在准备…', generating: '正在回答…', stopping: '正在停止…', blocked: '等待停止确认' };
const pageStatuses = { empty: '未选择页面，可直接聊天', loading: '当前页面正文提取中', ready: '当前页面已缓存，AI 可按需读取',
  unavailable: '当前页面正文不可用，不影响聊天', unsupported: '当前页面暂不支持提取，可直接聊天' };
const conversationKey = 'main';
const statuses = { generating: '正在回答', complete: '', stopped: '已停止', failed: '失败', truncated: '回答已达到长度上限' };

function TurnDetails({ entry }: { entry: ChatEntry }) {
  return <details className="ai-turn-details">
    <summary>
      <span className="ai-turn-model">{entry.model}</span>
      <span className="ai-record-summary">本轮明细{entry.sources.length ? ` · 来源 ${entry.sources.length}` : ''}{entry.writes.length ? ` · 已写入 ${entry.writes.length} 项` : ''}</span>
      <Icon name="chevron" />
    </summary>
    <div className="ai-record-content">
      <p className="ai-hint">本轮模型：{entry.model}</p>
      {entry.tools ? <p className="ai-hint">本轮工具：{entry.tools.join(' / ')}</p> : null}
      {entry.sources.map(source => <div className="ai-material" key={source.id}>
        <p className="ai-material-title">{source.kind === 'subtitles' ? '已读取字幕片段' : '已读取'}：{source.title || '页面正文'}</p>
        <p className="ai-material-url">{source.url}</p>
        <p>{source.kind === 'subtitles' ? `读取了冻结字幕片段（${source.language} / ${source.subtitleSource}），不包含视频画面。` : '读取了缓存正文片段，不包含图片或视频内容。'}{source.truncated ? '缓存正文已截断。' : ''}</p>
      </div>)}
      {entry.writes.map((write, index) => <p className="ai-write" key={index}>{write.operation === 'edit' ? '已更新到本机' : '已保存到本机'}：<span>{write.path}</span></p>)}
    </div>
  </details>;
}

export function AIChat({ settingsRevision, collapsed, tabbed, selection, modelChanging, onConfigure }: {
  settingsRevision: number; collapsed: boolean; tabbed: boolean; selection?: ModelSelection; modelChanging: boolean; onConfigure(): void;
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
    if (selection?.mode === 'offline') { setConfigured(true); return; }
    setConfigured(false);
    void window.huanApp.settings.load().then(result => {
      if (!cancelled) setConfigured(!!selection && result.ok && !!result.settings.ai.credentialId);
    }).catch(() => { if (!cancelled) setConfigured(false); });
    return () => { cancelled = true; };
  }, [settingsRevision, selection]);

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
    if (!current || busy || modelChanging || !configured || !draft.trim()) return;
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
  if (!configured && !current?.entries.length) return <section id="reading-chat-panel" role={tabbed ? 'tabpanel' : 'region'} aria-labelledby={tabbed ? 'reading-chat-tab' : undefined} aria-label={tabbed ? undefined : 'AI 对话'} className="ai-chat" hidden={collapsed}>
    <div className="ai-unconfigured">
      <div className="ai-empty-icon"><Icon name="book" width="36" height="36" /></div>
      <h2>准备开始伴读</h2>
      <p>在线模式需要配置 API Key，也可切换离线使用。</p>
      <Button onClick={onConfigure}>配置 DeepSeek</Button>
    </div>
  </section>;

  return <section id="reading-chat-panel" role={tabbed ? 'tabpanel' : 'region'} aria-labelledby={tabbed ? 'reading-chat-tab' : undefined} aria-label={tabbed ? undefined : 'AI 对话'} className="ai-chat" hidden={collapsed}>
    <div className="ai-heading">
      <Button className="ai-new-chat" title="清空聊天和草稿，开始新对话；不清页面材料" disabled={!current || commandBusy} onClick={() => setConfirmRestart(true)}><Icon name="plus" />新开对话</Button>
    </div>
    <div className="ai-messages">
      {!current?.entries.length ? <div className="ai-empty">
        <div className="ai-empty-icon"><Icon name="book" width="36" height="36" /></div>
        <h2>从一个问题开始</h2><p>可直接提问，也可围绕当前页面展开讨论。</p>
      </div> : null}
      {current?.entries.map(entry => <article className="ai-turn" key={entry.id}>
        <p className="ai-question"><span className="visually-hidden">你的提问：</span>{entry.question}</p>
        {entry.contextNotice ? <p className="ai-hint">{entry.contextNotice}</p> : null}
        {entry.toolError ? <p className="ai-error" role="alert">{entry.toolError}</p> : null}
        <div className={`ai-answer${!entry.answer && entry.status === 'generating' ? ' ai-answer--waiting' : ''}`}>{entry.answer || (entry.status === 'generating' ? '正在等待回复…' : '')}</div>
        {statuses[entry.status] ? <p className="ai-turn-status" role="status">{statuses[entry.status]}</p> : null}
        {entry.error ? <p className="ai-error" role="alert">{entry.error}</p> : null}
        {entry.metrics ? <ExecutionMetrics metrics={entry.metrics} className="ai-turn-metrics" /> : null}
        <TurnDetails entry={entry} />
      </article>)}
    </div>
    <div className="ai-composer">
      {!configured ? <Button onClick={onConfigure}>配置 DeepSeek</Button> : null}
      {confirmRestart ? <div className="ai-notice"><p>清空当前对话和草稿并新开对话？页面缓存与 API Key 不受影响。</p>
        <div className="ai-notice-actions"><Button onClick={() => setConfirmRestart(false)}>取消</Button><Button variant="primary" onClick={() => void restart()}>确认新开对话</Button></div></div> : null}
      <p className="ai-context-status" role="status">{youtubeVideoId(page?.url ?? '')
        ? '视频问答使用提问时已获取的字幕，不包含视频画面。播放后自动获取，可在「实时字幕」查看。'
        : pageStatuses[page?.contentStatus ?? 'empty']}</p>
      {error || current?.error ? <p className="ai-error" role="alert">{error || current?.error}</p> : null}
      {current?.lastMetrics ? <ExecutionMetrics metrics={current.lastMetrics} label="上次请求用量" /> : null}
      <div className="ai-input-box ui-input-surface">
        <label className="visually-hidden" htmlFor="ai-question">向 AI 提问</label>
        <textarea id="ai-question" placeholder={current?.entries.length ? '继续提问…' : '向 AI 提问…'} value={draft} maxLength={8000}
          disabled={!current || !configured} onChange={event => edit(event.target.value)}
          onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} />
        <div className="ai-actions">
          <span className="ai-shortcut">⌘ / Ctrl Enter 发送</span>
          {current && busy ? <Button className="ai-stop" disabled={commandBusy || current.phase === 'stopping'}
            onClick={() => void command(() => window.huanApp.ai.stop(owner()))}>停止</Button> : <Button variant="primary"
            disabled={!current || !configured || modelChanging || !draft.trim() || commandBusy} onClick={() => send()}>发送</Button>}
        </div>
      </div>
      <div className="ai-composer-status"><span role="status">{current ? phases[current.phase] : '正在准备对话'}</span><span>执行记录留本机</span></div>
    </div>
  </section>;
}
