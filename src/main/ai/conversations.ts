import { randomUUID } from 'node:crypto';
import type { ConversationState, Owner, SendInput, ChatEntry } from '@shared/contracts/ai';
import type { PageContext } from '@shared/contracts/page-context';
import { createAIRuntime } from './runtime';

// Run 只管理在途操作；结束后释放，模型历史由 Worker 内的 Agent 保存。
type Run = { id: string; controller: AbortController; done?: Promise<void> };
type Conversation = { state: ConversationState; submitted: boolean; run?: Run;
  requests: Map<string, string>; broken: boolean; draftRevision: number; publishTimer?: ReturnType<typeof setTimeout> };
type ContextProvider = (signal: AbortSignal) => Promise<PageContext | undefined>;
const message = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';

export function createConversations(getKey: () => Promise<string>, publish: (state: ConversationState) => void) {
  const sessions = new Map<string, Conversation>();
  const running = new Set<Run>();
  let revision = 0;
  const runtime = createAIRuntime(() => {
    for (const owner of sessions.values()) {
      if (!owner.submitted) continue;
      owner.broken = true;
      owner.state.error = 'AI 进程已退出。聊天仍可查看，请重新开始后继续。';
      notify(owner);
    }
  });
  function notify(owner: Conversation, debounce = false) {
    if (sessions.get(owner.state.key) !== owner) return;
    if (debounce) {
      owner.publishTimer ??= setTimeout(() => { owner.publishTimer = undefined; notify(owner); }, 60);
      return;
    }
    clearTimeout(owner.publishTimer); owner.publishTimer = undefined;
    owner.state.revision = ++revision;
    publish(owner.state);
  }
  function create(key: string) {
    const owner: Conversation = { submitted: false, requests: new Map(), broken: false, draftRevision: 0,
      state: { key, instanceId: randomUUID(), revision: ++revision, phase: 'idle', draft: '', entries: [], error: '' } };
    sessions.set(key, owner);
    return owner;
  }
  function requireOwner(input: Owner) {
    const owner = sessions.get(input.key);
    if (!owner || owner.state.instanceId !== input.instanceId) throw new Error('对话已重新开始，请刷新当前状态。');
    return owner;
  }
  function stopRun(owner: Conversation, run: Run) {
    run.controller.abort(); owner.state.phase = 'stopping'; notify(owner);
    const timer = setTimeout(() => {
      if (running.has(run)) { owner.state.phase = 'blocked'; owner.state.error = '停止尚未确认，请等待或重新开始。'; notify(owner); }
    }, 10000);
    void run.done?.finally(() => clearTimeout(timer));
  }
  return {
    get(key: string) {
      if (!sessions.has(key) && sessions.size >= 64) throw new Error('临时会话已达上限，请退出应用后重试。');
      return (sessions.get(key) ?? create(key)).state;
    },
    draft(input: Owner, text: string) { const owner = requireOwner(input); owner.state.draft = text; owner.draftRevision++; },
    send(input: SendInput, provideContext?: ContextProvider) {
      const owner = requireOwner(input);
      const signature = JSON.stringify(input);
      if (owner.requests.has(input.requestId)) {
        if (owner.requests.get(input.requestId) !== signature) throw new Error('请求编号已使用。');
        return;
      }
      if (owner.run) throw new Error('当前任务尚未结束，请等待或停止。');
      if (owner.broken) throw new Error('AI 进程已退出，请重新开始对话。');
      if (owner.requests.size >= 200 || owner.state.entries.length >= 60) throw new Error('当前对话已达上限，请重新开始。');
      if (running.size >= 3) throw new Error('同时最多处理 3 个任务，请等待已有任务结束。');
      const run: Run = { id: input.requestId, controller: new AbortController() };
      const draftRevision = owner.draftRevision;
      // 在任何异步授权前占用会话；停止覆盖授权、生成和收尾全过程。
      owner.run = run; owner.state.phase = 'preparing'; owner.state.error = '';
      owner.requests.set(input.requestId, signature);
      running.add(run); notify(owner);
      const timer = setTimeout(() => { owner.state.error = '请求超时，正在取消；未自动重发。'; stopRun(owner, run); }, 180000);
      let entry: ChatEntry | undefined;
      run.done = (async () => {
        const key = await getKey();
        run.controller.signal.throwIfAborted();
        let context: PageContext | undefined;
        let contextNotice: string | undefined;
        try { context = await provideContext?.(run.controller.signal); }
        catch (error) {
          run.controller.signal.throwIfAborted();
          contextNotice = `未提供页面上下文，已继续发送问题：${message(error)}`;
        }
        run.controller.signal.throwIfAborted();
        await runtime.start({ type: 'start', instanceId: owner.state.instanceId, requestId: run.id, key, text: input.text, context },
          run.controller.signal, event => {
            if (sessions.get(input.key) !== owner || owner.run !== run) return;
            if (event.type === 'accepted') {
              owner.submitted = true;
              const last = owner.state.entries.at(-1);
              if (last?.status === 'failed' && last.question === input.text) owner.state.entries.pop();
              entry = { id: run.id, question: input.text, answer: '', status: 'generating', sources: [], contextNotice };
              owner.state.entries.push(entry);
              if (owner.draftRevision === draftRevision) owner.state.draft = '';
              if (!run.controller.signal.aborted) owner.state.phase = 'generating';
            } else if (event.type === 'delta' && entry) {
              entry.answer = event.reset ? event.text : entry.answer + event.text;
            } else if (event.type === 'page-read' && entry) {
              if (!entry.sources.some(source => source.id === event.source.id)) entry.sources.push(event.source);
            } else if (event.type === 'settled') {
              if (entry) { entry.answer = event.text; entry.status = event.status; entry.error = event.error; }
              if (event.error) owner.state.error = event.error;
            }
            notify(owner, event.type === 'delta');
          });
      })().catch(error => {
        owner.state.error = run.controller.signal.aborted ? '已停止。' : message(error);
      }).finally(() => {
        clearTimeout(timer); running.delete(run);
        if (entry?.status === 'generating') { entry.status = 'failed'; entry.error = '请求中断，未自动重发。'; }
        if ((!entry || entry.status === 'failed') && owner.draftRevision === draftRevision) owner.state.draft = input.text;
        if (owner.run === run) { owner.run = undefined; owner.state.phase = 'idle'; notify(owner); }
      });
    },
    stop(input: Owner) { const owner = requireOwner(input); if (owner.run) stopRun(owner, owner.run); },
    restart(input: Owner) {
      const owner = requireOwner(input);
      const fresh = create(input.key);
      clearTimeout(owner.publishTimer);
      owner.run?.controller.abort(); runtime.dispose(owner.state.instanceId);
      notify(fresh); return fresh.state;
    },
    hasWork: () => running.size > 0,
    close() { for (const run of running) run.controller.abort(); runtime.close(); }
  };
}
