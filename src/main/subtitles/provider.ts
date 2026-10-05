import { z } from 'zod';
import { videoIdSchema, youtubeVideoUrl, type TranscriptGuruJob, type TranscriptGuruTranscript } from '@shared/contracts/subtitles';
import type { SubtitleUsage } from '@shared/contracts/settings';

const ORIGIN = 'https://transcriptguru.io';
const FREE_RESOLUTIONS = new Set(['db_hit', 'caption_youtube']);
// 官方扩展将浏览器提取到的 YouTube 字幕上传后，服务返回此来源而非 caption。
const CAPTION_SOURCES = new Set(['caption', 'extension_upload']);
export class SubtitleFailure extends Error {
  constructor(public code: string, message: string, public submissionNotAccepted = false, public retryAfter?: number) {
    super(message);
  }
}
export function subtitleFailure(error: unknown): SubtitleFailure {
  return error instanceof SubtitleFailure ? error : new SubtitleFailure('REQUEST_FAILED', '字幕请求失败或已取消；未自动重发。');
}

const jobSchema = z.object({
  id: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/), video_id: videoIdSchema,
  status: z.string().min(1).max(64), resolution: z.string().max(64),
  transcript_id: z.string().max(128).nullable(), video_title: z.string().max(4096).nullable(),
  actual_credits: z.number().finite().nonnegative(),
  estimated_credits: z.number().finite().nonnegative(), reserved_credits: z.number().finite().nonnegative()
});
const estimateSchema = z.object({
  video_id: videoIdSchema, resolution: z.string().max(64), estimated_credits: z.number().finite().nonnegative(),
  sufficient_credits: z.boolean(), requires_confirmation: z.boolean(), plan_upgrade_required: z.boolean()
});
const balanceSchema = z.object({
  spendable_credits: z.number().finite().nonnegative(), reserved_credits: z.number().finite().nonnegative(),
  monthly_allowance: z.number().finite().nonnegative(), quota_resets_at: z.string().nullable()
});
const usageSchema = z.object({ days: z.array(z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), credits_used: z.number().finite().nonnegative()
})).max(90) });
const transcriptSchema = z.object({
  video_id: videoIdSchema, language: z.string().min(1).max(128), source: z.string().min(1).max(128),
  segments: z.array(z.object({ time: z.string().max(128), seconds: z.number().finite().nonnegative(), text: z.string() })).max(30000),
  word_count: z.number().int().nonnegative(), quality_warning: z.boolean(), quality_issues: z.array(z.unknown())
});
export function validateJob(raw: unknown, videoId: string): TranscriptGuruJob {
  const result = jobSchema.safeParse(raw);
  if (!result.success || result.data.video_id !== videoId)
    throw new SubtitleFailure('INVALID_JOB', '服务返回的任务格式或视频身份不匹配。');
  return result.data;
}
export function validateTranscript(raw: unknown, videoId: string): TranscriptGuruTranscript {
  if (typeof raw === 'object' && raw !== null && 'segments' in raw && Array.isArray(raw.segments) && raw.segments.length > 30000)
    throw new SubtitleFailure('RESOURCE_LIMIT', '字幕超过 30,000 段限制，未缓存部分结果。');
  const result = transcriptSchema.safeParse(raw);
  if (!result.success || result.data.video_id !== videoId)
    throw new SubtitleFailure('INVALID_TRANSCRIPT', '服务返回的字幕格式或视频身份不匹配。');
  const transcript = result.data;
  if (!transcript.segments.length) throw new SubtitleFailure('EMPTY_TRANSCRIPT', '服务返回空字幕；这不等于已确认视频没有字幕。');
  if (!CAPTION_SOURCES.has(transcript.source)) throw new SubtitleFailure('UNSUPPORTED_SOURCE',
    `服务返回的字幕来源“${transcript.source}”尚不支持；未接受该结果，不自动转写或翻译。`);
  let bytes = 0, previous = -1;
  for (const segment of transcript.segments) {
    if (!segment.text.trim() || segment.seconds < previous)
      throw new SubtitleFailure('INVALID_TRANSCRIPT', '字幕包含空文本或不按时间顺序排列。');
    previous = segment.seconds;
    bytes += Buffer.byteLength(segment.text, 'utf8');
    if (bytes > 2 * 1024 * 1024) throw new SubtitleFailure('RESOURCE_LIMIT', '字幕正文超过 2MiB 限制，未缓存部分结果。');
    Object.freeze(segment);
  }
  Object.freeze(transcript.segments);
  Object.freeze(transcript.quality_issues);
  return Object.freeze(transcript);
}

export function createSubtitleProvider() {
  // 全部 HTTP 共用保守速率；清会话或重新保存同一账户的 Key 不重置 Retry-After。
  const rate = { tail: Promise.resolve<unknown>(undefined), nextAt: 0 };
  async function request(path: string, key: string, signal: AbortSignal, body?: unknown) {
    const operation = rate.tail.then(async () => {
      if (signal.aborted) throw new SubtitleFailure('CANCELLED', '字幕请求尚未发出，已取消。', true);
      const wait = rate.nextAt - Date.now();
      if (wait > 0) await new Promise<void>((resolve, reject) => {
        const finish = () => { signal.removeEventListener('abort', abort); resolve(); };
        const timer = setTimeout(finish, wait);
        const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new SubtitleFailure('CANCELLED', '字幕请求已取消。', true)); };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
      if (signal.aborted) throw new SubtitleFailure('CANCELLED', '字幕请求尚未发出，已取消。', true);
      rate.nextAt = Date.now() + 12000;
      const started = Date.now();
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
      let response: Response;
      try {
        response = await fetch(`${ORIGIN}/api/v1${path}`, { method: body ? 'POST' : 'GET', redirect: 'error', signal: requestSignal,
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      } catch { throw new SubtitleFailure('NETWORK_ERROR', '无法连接字幕服务或请求超时；提交可能已被处理，未自动重发。'); }
      console.info('[Subtitles] HTTP', { method: body ? 'POST' : 'GET', path, status: response.status, elapsedMs: Date.now() - started });
      if (!response.ok) {
        const rawRetry = response.headers.get('Retry-After');
        const retryAfter = rawRetry ? (/^\d+$/.test(rawRetry) ? Number(rawRetry) : Math.max(0, Math.ceil((Date.parse(rawRetry) - Date.now()) / 1000))) : undefined;
        if (response.status === 429 && retryAfter !== undefined && Number.isFinite(retryAfter))
          rate.nextAt = Math.max(rate.nextAt, Date.now() + retryAfter * 1000);
        await response.body?.cancel();
        const errors: Record<number, [string, string]> = {
          400: ['INVALID_INPUT', '服务拒绝此视频或参数；不能据此确认没有字幕。'],
          401: ['INVALID_KEY', 'Transcript Guru Key 无效，请在字幕服务设置中修改。'],
          402: ['INSUFFICIENT_CREDITS', '字幕服务额度不足，请到官方后台核对。'],
          403: ['ACCESS_DENIED', '此 Key 或套餐没有接口权限。'],
          429: ['RATE_LIMITED', '字幕服务限流，请按服务要求稍后手动重试。']
        };
        const [code, message] = errors[response.status] ?? ['SERVICE_ERROR', `字幕服务返回 HTTP ${response.status}，未自动重发。`];
        throw new SubtitleFailure(code, message, [400, 401, 402, 403, 429].includes(response.status), Number.isFinite(retryAfter) ? retryAfter : undefined);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new SubtitleFailure('INVALID_RESPONSE', '字幕服务没有返回响应正文。');
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 4 * 1024 * 1024) throw new SubtitleFailure('RESOURCE_LIMIT', '服务响应超过 4MiB，未缓存部分结果。');
          chunks.push(value);
        }
        try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
        catch { throw new SubtitleFailure('INVALID_RESPONSE', '字幕服务返回了无效 JSON。'); }
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    });
    rate.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }
  return {
    async estimate(videoId: string, key: string, signal: AbortSignal) {
      const result = estimateSchema.safeParse(await request('/jobs/estimate', key, signal,
        { url: youtubeVideoUrl(videoId), language: 'auto', force_asr: false }));
      if (!result.success || result.data.video_id !== videoId)
        throw new SubtitleFailure('INVALID_ESTIMATE', '无法验证费用预估或视频身份，未提交任务。', true);
      const estimate = result.data;
      console.info('[Subtitles] estimate', { videoId, resolution: estimate.resolution, credits: estimate.estimated_credits });
      if (estimate.estimated_credits !== 0 || !FREE_RESOLUTIONS.has(estimate.resolution) ||
          estimate.requires_confirmation || estimate.plan_upgrade_required || !estimate.sufficient_credits)
        throw new SubtitleFailure('CAPTIONS_UNAVAILABLE',
          `服务未提供可自动获取的免费原字幕路径（${estimate.resolution}，预估 ${estimate.estimated_credits} credits）。未创建任务，不自动转写或翻译。`, true);
    },
    async postJob(videoId: string, key: string, signal: AbortSignal) {
      return validateJob(await request('/jobs', key, signal, { url: youtubeVideoUrl(videoId), language: 'auto' }), videoId);
    },
    async readTranscript(job: TranscriptGuruJob, key: string, signal: AbortSignal) {
      let current = job;
      while (true) {
        if (!FREE_RESOLUTIONS.has(current.resolution) || current.estimated_credits || current.reserved_credits || current.actual_credits)
          throw new SubtitleFailure('UNEXPECTED_COST', '任务实际路径与免费预估不一致，已停止读取并保留任务。请在官方后台核对费用；未自动新建。');
        if (current.status === 'done') break;
        if (!['queued', 'downloading'].includes(current.status))
          throw new SubtitleFailure('JOB_NOT_READY', `字幕任务状态为 ${current.status}，已保留同一任务，未自动新建。`);
        // 只续查同一任务；共享限速和上层等待期限，不重复 POST。
        current = validateJob(await request(`/jobs/${encodeURIComponent(job.id)}`, key, signal), job.video_id);
        if (current.id !== job.id) throw new SubtitleFailure('INVALID_JOB', '续查返回了另一任务，未读取字幕。');
      }
      return validateTranscript(await request(`/jobs/${encodeURIComponent(job.id)}/transcript`, key, signal), job.video_id);
    },
    async usage(key: string, credentialId: string, signal: AbortSignal): Promise<SubtitleUsage> {
      const balance = balanceSchema.safeParse(await request('/credits/balance', key, signal));
      if (!balance.success) throw new SubtitleFailure('INVALID_BALANCE', '服务余额格式无法验证，请到官方后台查看。');
      const updatedAt = Date.now();
      const rawReset = balance.data.quota_resets_at;
      // 官方日期缺少时区时表示 UTC，与官网的日期展示保持一致。
      const resetAt = rawReset ? Date.parse(/Z$|[+-]\d{2}:?\d{2}$/.test(rawReset) ? rawReset : `${rawReset}Z`) : NaN;
      const data: NonNullable<SubtitleUsage['data']> = {
        updatedAt, credits: balance.data.spendable_credits, reservedCredits: balance.data.reserved_credits,
        monthlyAllowance: balance.data.monthly_allowance, resetsAt: Number.isFinite(resetAt) ? resetAt : undefined
      };
      try {
        const usage = usageSchema.safeParse(await request('/credits/usage?days=30', key, signal));
        if (!usage.success) throw new SubtitleFailure('INVALID_USAGE', '服务消耗记录格式无法验证。');
        data.rolling30CreditsUsed = usage.data.days.reduce((sum, day) => sum + day.credits_used, 0);
      } catch {
        return { credentialId, phase: 'ready', data, message: '余额已读取；近 30 日消耗暂无法查询。账户日 / 月 API 调用配额未公开，不以 credits 代替调用次数。' };
      }
      return { credentialId, phase: 'ready', data, message: '官方账户余额与近 30 日 credits 消耗。账户日 / 月 API 调用配额未公开，不以 credits 代替调用次数。' };
    }
  };
}
