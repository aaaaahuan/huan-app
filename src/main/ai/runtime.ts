import { utilityProcess, type UtilityProcess } from 'electron';
import { join } from 'node:path';
import type { WorkerCommand, WorkerEvent } from '@shared/contracts/ai';

export function createAIRuntime(onCrash: () => void) {
  let worker: UtilityProcess | undefined;
  let ready: Promise<void> | undefined;
  const pending = new Map<string, { receive(event: WorkerEvent): void; reject(error: Error): void }>();

  function ensure() {
    // 多个会话共享一次启动过程；收到 ready 后才允许向子进程提交请求。
    if (ready) return ready;
    ready = new Promise<void>((resolve, reject) => {
      const child = utilityProcess.fork(join(__dirname, 'ai-worker.js'), [], { serviceName: 'huan-app AI',
        stdio: 'ignore', env: { PATH: process.env.PATH ?? '', LANG: 'en_US.UTF-8', OTEL_SDK_DISABLED: 'true' } });
      worker = child;
      const timer = setTimeout(() => { reject(new Error('AI 启动超时。')); child.kill(); }, 15000);
      child.on('message', (event: WorkerEvent | { type: 'ready' }) => {
        if (worker !== child) return;
        if (event.type === 'ready') { clearTimeout(timer); resolve(); return; }
        pending.get(event.requestId)?.receive(event);
      });
      child.once('exit', () => {
        clearTimeout(timer);
        if (worker !== child) return;
        worker = undefined; ready = undefined;
        const error = new Error('AI 进程已退出，请重新开始对话；没有自动重发。');
        reject(error);
        for (const run of pending.values()) run.reject(error);
        pending.clear();
        onCrash();
      });
    }).catch((error: unknown) => {
      ready = undefined;
      throw error;
    });
    return ready;
  }
  return {
    async start(command: Extract<WorkerCommand, { type: 'start' }>, signal: AbortSignal, onEvent: (event: WorkerEvent) => void) {
      await ensure();
      signal.throwIfAborted();
      return new Promise<void>((resolve, reject) => {
        // 取消只通知 Worker；收到 settled 或进程退出才结束等待，避免假装已停止。
        const cancel = () => worker?.postMessage({ type: 'cancel', instanceId: command.instanceId, requestId: command.requestId } satisfies WorkerCommand);
        const finish = () => { pending.delete(command.requestId); signal.removeEventListener('abort', cancel); };
        pending.set(command.requestId, {
          receive(event) {
            // requestId 路由请求，instanceId 再隔离同一会话重开前后的消息。
            if (event.instanceId !== command.instanceId) return;
            onEvent(event);
            if (event.type === 'settled') { finish(); resolve(); }
          },
          reject(error) { finish(); reject(error); }
        });
        signal.addEventListener('abort', cancel, { once: true });
        try { worker!.postMessage(command); }
        catch { finish(); reject(new Error('无法提交 AI 请求，请重新开始。')); }
        if (signal.aborted) cancel();
      });
    },
    dispose(instanceId: string) { worker?.postMessage({ type: 'dispose', instanceId } satisfies WorkerCommand); },
    close() { worker?.kill(); }
  };
}
