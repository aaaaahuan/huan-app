/// <reference types="vite/client" />
import type { WebContents } from 'electron';
import { z } from 'zod';
import type { PageContent } from '@shared/contracts/page-context';

import readabilitySource from '@mozilla/readability/Readability.js?raw';

const resultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), url: z.string(), title: z.string().max(500),
    text: z.string().max(40000), truncated: z.boolean() }),
  z.object({ ok: z.literal(false), empty: z.boolean().optional(), message: z.string() })
]);

const extractScript = `
(() => {
  try {
    ${readabilitySource}

    // 只修改副本，不能破坏原站的 DOM 和组件状态。
    const article = new Readability(document.cloneNode(true)).parse();
    const text = article?.textContent?.trim();

    if (!text) return { ok: false, empty: true, message: '未识别到文章正文' };

    return {
      ok: true,
      url: location.href,
      title: (article.title || document.title).slice(0, 500),
      text: text.slice(0, 40000),
      truncated: text.length > 40000
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '正文提取失败'
    };
  }
})()
`;

export async function extractReadablePage(webContents: WebContents): Promise<PageContent | null> {
  const result = resultSchema.parse(await webContents.executeJavaScriptInIsolatedWorld(1002, [
    { code: extractScript }
  ]));

  if (!result.ok) {
    if (result.empty) return null;
    throw new Error(result.message);
  }
  return { title: result.title, text: result.text, truncated: result.truncated };
}
