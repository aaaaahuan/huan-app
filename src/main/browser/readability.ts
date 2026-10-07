/// <reference types="vite/client" />
import type { WebContents } from 'electron';
import { z } from 'zod';
import type { PageContent } from '@shared/contracts/page-context';

import readabilitySource from '@mozilla/readability/Readability.js?raw';
import readerableSource from '@mozilla/readability/Readability-readerable.js?raw';

const resultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), url: z.string().max(4096), title: z.string(),
    text: z.string(), truncated: z.boolean(), frames: z.array(z.string().max(4096)).default([]) }),
  z.object({ ok: z.literal(false), empty: z.boolean().optional(), message: z.string().max(1000) })
]);

const extractScript = (articleOnly: boolean, includeFrames = false) => `
(() => {
  // 子 frame 的页面原型不可信；URL 和错误信息限制不依赖可被网站覆写的 String.slice。
  function bounded(value, limit) {
    if (typeof value !== 'string') return '';
    let result = '';
    for (let index = 0; index < value.length && index < limit; index++) result += value[index];
    return result;
  }
  try {
    // 子 frame 使用页面世界；不触及网站可能存在的 CommonJS module。
    const module = undefined;
    ${readerableSource}
    ${readabilitySource}

    // Other 没有固定文章路由，先排除可见登录表单。
    if (${articleOnly} && (Array.from(document.querySelectorAll('input[type="password"]')).some(input =>
      input.getClientRects().length && getComputedStyle(input).visibility !== 'hidden')))
      return { ok: false, empty: true, message: '未识别到可读文章' };

    const frames = ${includeFrames} ? Array.from(document.querySelectorAll('iframe')).filter(frame =>
      frame.getClientRects().length && getComputedStyle(frame).visibility !== 'hidden').map(frame => frame.src).filter(address => {
        try { const url = new URL(address); return address.length <= 4096 && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.origin === location.origin; }
        catch { return false; }
      }) : [];

    // 只修改副本，不能破坏原站的 DOM 和组件状态。
    // 结构化研报常用 section/div 而非长 p；仍交给 Readability 筛选正文，不回退到整页 innerText。
    const readerable = !${articleOnly} || isProbablyReaderable(document) ||
      (document.querySelectorAll('section').length >= 2 && (document.body?.textContent?.length || 0) >= 1000);
    const article = readerable ? new Readability(document.cloneNode(true)).parse() : null;
    const text = article?.textContent?.trim() || '';

    if (!text && !frames.length) return { ok: false, empty: true, message: '未识别到文章正文' };

    return {
      ok: true,
      url: bounded(location.href, 4096),
      title: (${articleOnly} ? document.querySelector('h1')?.textContent?.trim() : '') || article?.title || document.title,
      text,
      truncated: false,
      frames
    };
  } catch (error) {
    return {
      ok: false,
      message: bounded(error instanceof Error ? error.message : '正文提取失败', 1000)
    };
  }
})()
`;

export async function extractReadablePage(webContents: WebContents, articleOnly = false, signal?: AbortSignal): Promise<PageContent | null> {
  let expired = false;
  function check() {
    signal?.throwIfAborted();
    if (expired) throw new Error('正文提取已过期。');
  }
  async function extract(): Promise<PageContent | null> {
    check();
    const address = webContents.getURL();
    const mainFrame = webContents.mainFrame;
    const result = resultSchema.parse(await webContents.executeJavaScriptInIsolatedWorld(1002, [
      { code: extractScript(articleOnly, articleOnly) }
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
      if (matches.length !== 1) { truncated = true; continue; }
      const frame = matches[0];
      try {
        const embedded = resultSchema.parse(await frame.executeJavaScript(extractScript(true)));
        check();
        if (!embedded.ok || !embedded.text || frame.isDestroyed() || frame.detached || frame.parent !== mainFrame ||
            webContents.mainFrame !== mainFrame || frame.url !== url || embedded.url !== url) {
          truncated = true; continue;
        }
        const combined = text + (text ? '\n\n' : '') + embedded.title + '\n' + embedded.text;
        truncated ||= embedded.truncated;
        text = combined;
      } catch { check(); truncated = true; }
    }
    if (!text) return null;
    if (webContents.getURL() !== address) throw new Error('正文提取期间页面已变化。');
    return { title: result.title, text, truncated };
  }
  if (!articleOnly) return extract();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    const cancellation = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => { expired = true; reject(new Error('Other 正文提取超时。')); }, 5000);
      abort = () => { expired = true; reject(signal?.reason ?? new Error('正文提取已取消。')); };
      signal?.addEventListener('abort', abort, { once: true });
    });
    return await Promise.race([extract(), cancellation]);
  } finally {
    expired = true;
    clearTimeout(timeout);
    if (abort) signal?.removeEventListener('abort', abort);
  }
}
