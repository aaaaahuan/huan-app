import { randomUUID } from 'node:crypto';
import type { ConversationState, Owner, SendInput, ChatEntry, NoteWrite } from '@shared/contracts/ai';
import type { ModelIdentity, ExecutionResult, ExecutionEvent } from '@shared/contracts/ai-execution';
import type { PageContext, PageSource } from '@shared/contracts/page-context';
import type { AgentHandle, RecordApprovalDecision } from '../agent/agent';
import { prepareReadingInput, type ReaderToolContext } from '../agent/reading-agent';
import type { NoteProposal } from '../agent/note-tools';

type Run = { id: string; controller: AbortController; done?: Promise<void> };
type Conversation = {
  state: ConversationState;
  submitted: boolean;
  run?: Run;
  privateHistory: boolean;
  requests: Map<string, string>;
  draftRevision: number;
  pendingPrevious?: Promise<void>;
  publishTimer?: ReturnType<typeof setTimeout>;
};
type ContextProvider = (
  signal: AbortSignal, model: ModelIdentity, recordApprovalDecision: RecordApprovalDecision
) => Promise<PageContext | undefined>;
type ApproveNote = (proposal: NoteProposal, signal: AbortSignal) => Promise<boolean>;

const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';
const emptyMaterials = (): PageContext => ({ pages: [] });

function finalAssistant(result: ExecutionResult) {
  for (let index = result.messages.length - 1; index >= 0; index--) {
    const message = result.messages[index];
    if (message.role === 'assistant') return message;
  }
  return undefined;
}

function assistantText(result: ExecutionResult) {
  const message = finalAssistant(result);
  return message?.content.filter(block => block.type === 'text').map(block => block.text).join('') ?? '';
}

function outcome(result: ExecutionResult, model: ModelIdentity): Pick<ChatEntry, 'status' | 'error'> {
  const final = finalAssistant(result);
  const raw = [result.failure?.httpStatus ? `HTTP ${result.failure.httpStatus}` : '',
    final?.errorMessage || result.warning || result.failure?.code || ''].filter(Boolean).join('：');
  if (result.status === 'interrupted')
    return { status: 'failed', error: '原生会话中断，后续对话已切换到新会话；此前聊天仍显示，但不会进入模型上下文。' };
  if (result.status === 'aborted' || final?.stopReason === 'aborted') return { status: 'stopped' };
  if (result.status === 'completed' && final?.stopReason === 'length')
    return { status: 'truncated', error: 'finish_reason=length（模型未完整生成回答）' };
  if (result.status === 'completed' && final?.stopReason === 'stop' && assistantText(result).trim())
    return { status: 'complete' };
  if (result.status === 'declined') return { status: 'failed', error: '请求未被模型受理。' };
  if (model.mode === 'offline')
    return { status: 'failed', error: raw || '本地模型请求失败，未自动重发。' };
  return { status: 'failed', error: raw || '模型请求失败；服务商可能已处理或计费，未自动重发。' };
}

// 对话只管理 UI 所属权和授权；消息与工具执行由共享的 AgentHandle 管理。
export function createConversations(
  agent: AgentHandle<ReaderToolContext>,
  publish: (state: ConversationState) => void,
  getNotesPath: () => Promise<string>,
  approveNote: ApproveNote,
  approveHistory: (signal: AbortSignal) => Promise<boolean>
) {
  const sessions = new Map<string, Conversation>();
  const running = new Set<Run>();
  let revision = 0;

  function notify(owner: Conversation, debounce = false) {
    if (sessions.get(owner.state.key) !== owner) return;
    if (debounce) {
      owner.publishTimer ??= setTimeout(() => { owner.publishTimer = undefined; notify(owner); }, 60);
      return;
    }
    clearTimeout(owner.publishTimer);
    owner.publishTimer = undefined;
    owner.state.revision = ++revision;
    publish(owner.state);
  }

  function create(key: string, pendingPrevious?: Promise<void>) {
    const owner: Conversation = {
      submitted: false, privateHistory: false, requests: new Map(), draftRevision: 0, pendingPrevious,
      state: { key, instanceId: randomUUID(), revision: ++revision, phase: 'idle', draft: '', entries: [], error: '' }
    };
    sessions.set(key, owner);
    return owner;
  }

  function requireOwner(input: Owner) {
    const owner = sessions.get(input.key);
    if (!owner || owner.state.instanceId !== input.instanceId)
      throw new Error('对话已重新开始，请刷新当前状态。');
    return owner;
  }

  function stopRun(owner: Conversation, run: Run) {
    run.controller.abort('USER_STOP');
    owner.state.phase = 'stopping';
    notify(owner);
    const timer = setTimeout(() => {
      if (running.has(run)) {
        owner.state.phase = 'blocked';
        owner.state.error = '停止尚未确认，请等待或重新开始。';
        notify(owner);
      }
    }, 10000);
    void run.done?.finally(() => clearTimeout(timer));
  }

  return {
    get(key: string) {
      return (sessions.get(key) ?? create(key)).state;
    },
    draft(input: Owner, text: string) {
      const owner = requireOwner(input);
      owner.state.draft = text;
      owner.draftRevision++;
    },
    send(input: SendInput, provideContext?: ContextProvider) {
      const owner = requireOwner(input);
      const signature = JSON.stringify(input);
      if (owner.requests.has(input.requestId)) {
        if (owner.requests.get(input.requestId) !== signature) throw new Error('请求编号已使用。');
        return;
      }
      if (owner.run) throw new Error('当前任务尚未结束，请等待或停止。');
      const run: Run = { id: input.requestId, controller: new AbortController() };
      const draftRevision = owner.draftRevision;
      owner.run = run;
      owner.state.phase = 'preparing';
      owner.state.error = '';
      owner.state.lastMetrics = undefined;
      owner.requests.set(input.requestId, signature);
      running.add(run);
      notify(owner);

      let entry: ChatEntry | undefined;
      let model: ModelIdentity | undefined;
      let tools: string[] = [];
      let toolError: string | undefined;
      let contextNotice: string | undefined;
      const onSource = (source: PageSource) => {
        if (!entry || sessions.get(input.key) !== owner || owner.run !== run) return;
        try {
          if (!entry.sources.some(item => item.id === source.id && item.kind === source.kind))
            entry.sources.push(source);
          notify(owner);
        } catch { /* UI 投影不影响已完成的工具读取。 */ }
      };
      const onWrite = (write: NoteWrite) => {
        if (!entry || sessions.get(input.key) !== owner || owner.run !== run) return;
        try {
          entry.writes.push(write);
          notify(owner);
        } catch { /* 文件写入已经提交，UI 发布失败不能改变工具结算。 */ }
      };
      const onEvent = (event: ExecutionEvent) => {
        if (sessions.get(input.key) !== owner || owner.run !== run) return;
        if (event.type === 'accepted' && model) {
          owner.submitted = true;
          if (model.mode === 'offline') owner.privateHistory = true;
          const last = owner.state.entries.at(-1);
          if (last?.status === 'failed' && !last.writes.length && last.question === input.text)
            owner.state.entries.pop();
          entry = {
            id: run.id, question: input.text, answer: '',
            model: (model.mode === 'offline' ? '离线' : '在线') + ' · ' + model.modelId,
            status: 'generating', sources: [], writes: [], contextNotice,
            tools, toolError
          };
          owner.state.entries.push(entry);
          if (owner.draftRevision === draftRevision) owner.state.draft = '';
          if (!run.controller.signal.aborted) owner.state.phase = 'generating';
          notify(owner);
        } else if (event.type === 'message_start' && entry && event.data.role === 'assistant') {
          entry.answer = '';
          notify(owner);
        } else if (event.type === 'message_delta' && entry && typeof event.data.text === 'string') {
          entry.answer += event.data.text;
          notify(owner, true);
        }
      };

      run.done = (async () => {
        await owner.pendingPrevious;
        run.controller.signal.throwIfAborted();
        const result = await agent.execute({
          runId: run.id,
          sessionId: owner.state.instanceId,
          async prepare({ signal, model: selectedModel, target, recordApprovalDecision }) {
            model = selectedModel;
            if (selectedModel.mode === 'online' && owner.privateHistory) {
              const allowed = await approveHistory(signal);
              await recordApprovalDecision({ invocationId: randomUUID(), decision: allowed ? 'approved' : 'declined',
                scope: 'preflight' });
              if (!allowed) throw new Error('未授权发送离线对话历史，请继续离线使用或新开对话。');
              signal.throwIfAborted();
              owner.privateHistory = false;
            }
            let notesPath = '';
            try { notesPath = await getNotesPath(); }
            catch (error) {
              signal.throwIfAborted();
              toolError = `笔记工具加载失败：${errorMessage(error)}`;
            }
            signal.throwIfAborted();
            let context: PageContext | undefined;
            try { context = await provideContext?.(signal, selectedModel, recordApprovalDecision); }
            catch (error) {
              signal.throwIfAborted();
              contextNotice = '未提供页面上下文，已继续发送问题：' + errorMessage(error);
            }
            signal.throwIfAborted();
            const scope: ReaderToolContext = {
              materials: context ?? emptyMaterials(), notesPath,
              async approveNoteWrite(proposal, invocationId, toolSignal) {
                const allowed = await approveNote(proposal, toolSignal ?? signal);
                await recordApprovalDecision({ invocationId, decision: allowed ? 'approved' : 'declined' });
                return allowed;
              },
              onPageRead: onSource, onSubtitlesRead: onSource, onNoteWritten: onWrite
            };
            const prepared = await prepareReadingInput(input.text, scope, target);
            tools = prepared.tools?.map(tool => tool.name) ?? [];
            toolError ??= prepared.toolError;
            return { ...prepared, toolError };
          }
        }, { signal: run.controller.signal, onEvent });
        if (entry && model) {
          entry.answer = assistantText(result);
          entry.metrics = result.metrics;
          const settled = outcome(result, model);
          entry.status = settled.status;
          entry.error = settled.error;
          if (settled.error) owner.state.error = settled.error;
          if (result.record.state === 'partial' && result.record.warning)
            owner.state.error = result.record.warning;
          notify(owner);
        } else if (result.status !== 'completed') {
          owner.state.lastMetrics = result.metrics;
          owner.state.error = run.controller.signal.aborted ? '已停止。'
            : result.warning ?? result.record.warning ?? result.failure?.code ?? 'AI 执行失败。';
        }
      })().catch(error => {
        owner.state.error = run.controller.signal.aborted ? '已停止。' : errorMessage(error);
      }).finally(() => {
        running.delete(run);
        if (entry?.status === 'generating') {
          entry.status = 'failed';
          entry.error = '请求中断，未自动重发。';
        }
        if ((!entry || entry.status === 'failed') && owner.draftRevision === draftRevision)
          owner.state.draft = input.text;
        if (owner.run === run) {
          owner.run = undefined;
          owner.state.phase = 'idle';
          notify(owner);
        }
      });
    },
    stop(input: Owner) {
      const owner = requireOwner(input);
      if (owner.run) stopRun(owner, owner.run);
    },
    restart(input: Owner) {
      const owner = requireOwner(input);
      owner.run?.controller.abort('NEW_SESSION');
      clearTimeout(owner.publishTimer);
      const fresh = create(input.key, owner.run?.done);
      notify(fresh);
      return fresh.state;
    },
    hasWork: () => running.size > 0,
    async close() {
      for (const run of running) run.controller.abort('APP_CLOSING');
      await Promise.allSettled([...running].map(run => run.done));
    }
  };
}
