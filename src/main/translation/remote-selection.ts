/// <reference types="vite/client" />
import type { WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import script from './remote-selection-script.js?raw';
import type { LookupRequest, TranslationResult } from '@shared/contracts/translation';
const pendingSchema = z.object({ token: z.number().int(), text: z.string().min(1).max(2000), context: z.string().max(2000), trigger: z.enum(['double-click', 'manual']) });
/** 仅在隔离世界读取固定选区消息，不向远程网页暴露 IPC 或任意主进程方法。 */
export function attachRemoteSelection(contents: WebContents, service: { lookup(input: LookupRequest): Promise<TranslationResult>; stop(id: string): void }, visible: () => boolean) {
  let disposed = false, polling = false;
  let active: { id: string; token: number } | undefined;
  const execute = (code: string) => contents.executeJavaScriptInIsolatedWorld(1003, [{ code }]);
  function cancel() { if (active) service.stop(active.id); active = undefined; }
  async function poll() {
    if (disposed || polling || contents.isDestroyed()) return;
    polling = true;
    try {
      if (!visible()) { cancel(); await execute('globalThis.huanSelection?.close()'); return; }
      await execute(script);
      const value: unknown = await execute('(() => { const s=globalThis.huanSelection; const pending=s.pending;s.pending=null;return {token:s.token,pending}; })()');
      const snapshot = z.object({ token: z.number(), pending: z.unknown() }).parse(value);
      if (active && active.token !== snapshot.token) cancel();
      if (!snapshot.pending) return;
      const query = pendingSchema.parse(snapshot.pending);
      cancel(); const request = { id: randomUUID(), token: query.token }; active = request;
      const source = { module: 'reading-webpage', url: contents.getURL().slice(0,4000), title: contents.getTitle().slice(0,500), context: query.context, trigger: query.trigger };
      void service.lookup({ requestId: request.id, direction: 'en-zh', text: query.text, source }).then(async result => {
        if (disposed || active !== request || contents.isDestroyed()) return;
        active = undefined;
        await execute(`globalThis.huanSelection?.finish(${query.token},${JSON.stringify(result)})`);
      }).catch(error => { if (!disposed) console.error('Selection translation failed', error); });
    } catch (error) { if (!contents.isDestroyed() && visible()) console.error('Selection polling failed', error); }
    finally { polling = false; }
  }
  const timer = setInterval(() => void poll(), 200);
  contents.on('did-start-navigation', cancel);
  return () => { disposed = true; clearInterval(timer); cancel(); contents.removeListener('did-start-navigation', cancel); };
}
