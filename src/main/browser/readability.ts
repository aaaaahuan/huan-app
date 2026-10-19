/// <reference types="vite/client" />
import type { WebContents } from 'electron';
import { z } from 'zod';
import type { PageContent } from '@shared/contracts/page-context';

import readabilitySource from '@mozilla/readability/Readability.js?raw';

const resultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), url: z.string(), title: z.string(),
    text: z.string(), truncated: z.boolean(), frames: z.array(z.string()).default([]) }),
  z.object({ ok: z.literal(false), empty: z.boolean().optional(), message: z.string() })
]);

const extractScript = (includeFrames = false) => `
(() => {
  try {
    // 子 frame 使用页面世界；不触及网站可能存在的 CommonJS module。
    const module = undefined;
    ${readabilitySource}

    const frames = ${includeFrames} ? Array.from(document.querySelectorAll('iframe')).filter(frame =>
      frame.getClientRects().length && getComputedStyle(frame).visibility !== 'hidden').map(frame => frame.src).filter(address => {
        try { const url = new URL(address); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.origin === location.origin; }
        catch { return false; }
      }) : [];

    // 只修改副本，不能破坏原站的 DOM 和组件状态。
    const article = new Readability(document.cloneNode(true)).parse();
    const text = article?.textContent?.trim() || '';

    if (!text && !frames.length) return { ok: false, empty: true, message: '未识别到文章正文' };

    return {
      ok: true,
      url: location.href,
      title: document.querySelector('h1')?.textContent?.trim() || article?.title || document.title,
      text,
      truncated: false,
      frames
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
})()
`;

export async function extractReadablePage(webContents: WebContents, signal?: AbortSignal): Promise<PageContent | null> {
  function check() {
    signal?.throwIfAborted();
  }
  async function extract(): Promise<PageContent | null> {
    check();
    const address = webContents.getURL();
    const mainFrame = webContents.mainFrame;
    const result = resultSchema.parse(await webContents.executeJavaScriptInIsolatedWorld(1002, [
      { code: extractScript(true) }
    ]));
    check();
    if (!result.ok) {
      if (result.empty) return null;
      throw new Error(result.message);
    }
    if (result.url !== address || webContents.getURL() !== address) throw new Error('正文提取期间页面已变化。');
    let text = result.text;
    let truncated = result.truncated;
    // 子 frame API 无隔离世界接口；仅 URL 同源且可见 src 唯一匹配的直接子 frame。
    for (const url of result.frames) {
      check();
      if (new URL(url).origin !== new URL(address).origin) continue;
      const matches = mainFrame.frames.filter(candidate => !candidate.isDestroyed() && !candidate.detached && candidate.parent === mainFrame && candidate.url === url);
      // 重复 src 或尚未加载的 frame 无法安全关联；保留已提取正文并标记材料不完整。
      if (matches.length !== 1) { truncated = true; continue; }
      const frame = matches[0];
      const embedded = resultSchema.parse(await frame.executeJavaScript(extractScript()));
      check();
      if (!embedded.ok) {
        if (embedded.empty) continue;
        throw new Error(embedded.message);
      }
      if (frame.isDestroyed() || frame.detached || frame.parent !== mainFrame ||
          webContents.mainFrame !== mainFrame || frame.url !== url || embedded.url !== url)
        throw new Error('正文提取期间子页面已变化。');
      if (!embedded.text) continue;
      const combined = text + (text ? '\n\n' : '') + embedded.title + '\n' + embedded.text;
      truncated ||= embedded.truncated;
      text = combined;
    }
    if (!text) return null;
    if (webContents.getURL() !== address) throw new Error('正文提取期间页面已变化。');
    return { title: result.title, text, truncated };
  }
  if (!signal) return extract();
  let abort: (() => void) | undefined;
  try {
    const cancellation = new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason ?? new Error('正文提取已取消。'));
      signal?.addEventListener('abort', abort, { once: true });
    });
    return await Promise.race([extract(), cancellation]);
  } finally {
    if (abort) signal?.removeEventListener('abort', abort);
  }
}
