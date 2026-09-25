import type { PageContext, PageSource } from '@shared/contracts/page-context';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { z } from 'zod';

const inputSchema = z.object({ pageId: z.string(), offset: z.number().int().min(0).default(0) }).strict();

export function createReadPageTool(Type: typeof import('@earendil-works/pi-ai').Type,
  getContext: () => PageContext | undefined, onRead: (source: PageSource) => void): AgentTool {
  return {
    name: 'read_page',
    label: '读取页面正文',
    description: '按 pageId 读取本轮目录中的缓存正文；每次最多 12000 字符，可用 nextOffset 继续。只读本地快照，不访问网络。',
    parameters: Type.Object({ pageId: Type.String(), offset: Type.Optional(Type.Integer({ minimum: 0 })) }),
    async execute(_toolCallId: string, input: unknown, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const { pageId, offset } = inputSchema.parse(input);
      const page = getContext()?.pages.find(page => page.id === pageId);
      if (!page) throw new Error('页面不在本轮可读取范围内');
      if (page.status !== 'ready') throw new Error(`页面正文不可用：${page.status}`);
      if (offset > page.text.length) throw new Error('读取位置超出正文范围');
      const text = page.text.slice(offset, offset + 12000);
      const end = offset + text.length;
      const source: PageSource = { id: page.id, title: page.title, url: page.url,
        capturedAt: page.capturedAt, truncated: page.truncated };
      onRead(source);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ ...source, text,
          nextOffset: end < page.text.length ? end : null }) }],
        details: { pageId, offset, end }
      };
    }
  };
}
