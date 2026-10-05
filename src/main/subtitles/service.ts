import type { Settings, SubtitleUsage } from '@shared/contracts/settings';
import { youtubeVideoUrl, type SubtitleDocument, type SubtitleResult, type SubtitleState, type TranscriptGuruJob } from '@shared/contracts/subtitles';
import { createSubtitleProvider, SubtitleFailure, subtitleFailure } from './provider';

type Entry = {
  job?: TranscriptGuruJob; transcript?: SubtitleDocument['transcript']; credentialId?: string;
  promise?: Promise<SubtitleResult<SubtitleDocument>>; controller?: AbortController;
  submissionUnknown?: boolean;
  error?: NonNullable<SubtitleState['error']>;
};
export function createSubtitleService(initial: Settings, currentVideo: () => string | null,
  readKey: (id: string) => Promise<string>, publish: (state: SubtitleState) => void,
  confirmNewJob: (signal: AbortSignal) => Promise<boolean>) {
  const entries = new Map<string, Entry>();
  const provider = createSubtitleProvider();
  let config = initial.subtitles;
  let usageRequest: { credentialId: string; controller: AbortController; promise: Promise<SubtitleUsage> } | undefined;
  let lastUsage: SubtitleUsage | undefined;
  let state: SubtitleState = { revision: 0, videoId: null, phase: 'idle' };
  function notify() { state = { ...state, revision: state.revision + 1 }; publish(state); }
  function publishEntry() {
    const entry = state.videoId ? entries.get(state.videoId) : undefined;
    state = { ...state, phase: entry?.transcript ? 'ready' : entry?.promise ? 'loading' : entry?.error ? 'error' : 'idle', error: entry?.error };
    notify();
  }
  function sameEntry(videoId: string, entry: Entry, controller: AbortController) {
    return entries.get(videoId) === entry && entry.controller === controller;
  }
  function ensure(videoId: string, retry = false): Promise<SubtitleResult<SubtitleDocument>> {
    if (currentVideo() !== videoId || state.videoId !== videoId)
      return Promise.resolve({ ok: false, code: 'VIDEO_CHANGED', message: '当前页面的视频已变化，请重新选择。' });
    let entry = entries.get(videoId);
    if (!entry) {
      if (entries.size >= 20) {
        const disposable = [...entries].find(([id, value]) => id !== state.videoId && !value.promise &&
          (value.transcript || (!value.job && !value.submissionUnknown)));
        if (!disposable) return Promise.resolve({ ok: false, code: 'CACHE_CAPACITY', message: '字幕缓存已满，未丢弃可续查或未知任务。请完全退出应用后重试。' });
        entries.delete(disposable[0]);
      }
      entry = {}; entries.set(videoId, entry);
    }
    // 最近使用的结果移到末尾，不淘汰当前、在途、可续查或提交未知记录。
    entries.delete(videoId); entries.set(videoId, entry);
    if (entry.transcript && entry.job) {
      publishEntry(); return Promise.resolve({ ok: true, value: { job: entry.job, transcript: entry.transcript } });
    }
    if (entry.promise) return entry.promise;
    if (entry.error && !retry) return Promise.resolve({ ok: false, ...entry.error });
    const target = entry, credential = config.credentialId, consent = config.consentVersion;
    const controller = new AbortController();
    target.controller = controller;
    const deadline = setTimeout(() => controller.abort(), 120000);
    function assertCurrentCredential() {
      if (!sameEntry(videoId, target, controller) || credential !== config.credentialId)
        throw new SubtitleFailure('CREDENTIAL_CHANGED', '字幕凭据已变化，旧请求已停止。', true);
      if (controller.signal.aborted) throw new SubtitleFailure('CANCELLED', '字幕获取已取消或等待超时；已受理的服务端任务可能仍在运行。');
    }
    target.promise = Promise.resolve().then(async (): Promise<SubtitleResult<SubtitleDocument>> => {
      if (!credential) throw new SubtitleFailure('KEY_MISSING', '配置 Transcript Guru 后可获取视频字幕。', true);
      if (consent < 1) throw new SubtitleFailure('CONSENT_REQUIRED', '请在字幕服务设置中重新保存并授权 Key。', true);
      let key: string;
      try { key = await readKey(credential); }
      catch { throw new SubtitleFailure('KEY_DECRYPT_FAILED', '无法解密字幕服务 Key，请在设置中重新填写。', true); }
      assertCurrentCredential();
      const replacing = !!((target.job && target.credentialId !== credential) || target.submissionUnknown);
      if (replacing) {
        if (!retry) throw new SubtitleFailure('NEW_JOB_CONFIRMATION', '旧任务所属账户已变化或提交结果未知；重新创建前需要确认。', true);
        if (!await confirmNewJob(controller.signal)) throw new SubtitleFailure('NEW_JOB_CANCELLED', '未重新提交，旧任务记录已保留。', true);
        assertCurrentCredential();
      }
      if (!target.job || replacing) {
        await provider.estimate(videoId, key, controller.signal);
        assertCurrentCredential();
        const previouslyUnknown = target.submissionUnknown;
        target.submissionUnknown = true;
        target.error = { code: 'SUBMISSION_UNKNOWN', message: '提交结果未知；新建前需确认，避免重复任务和费用。' };
        let job: TranscriptGuruJob;
        try { job = await provider.postJob(videoId, key, controller.signal); }
        catch (error) {
          // 只有本次 POST 明确未受理才能清未知标记，取消确认不能清旧提交记录。
          if (subtitleFailure(error).submissionNotAccepted) target.submissionUnknown = previouslyUnknown;
          throw error;
        }
        // 换 Key 后也先保留已确定受理的任务；只有清会话才彻底移除条目。
        if (!sameEntry(videoId, target, controller)) throw new SubtitleFailure('CANCELLED', '字幕会话已清除。');
        target.job = job; target.credentialId = credential; target.error = undefined; target.submissionUnknown = false;
        assertCurrentCredential();
      }
      const transcript = await provider.readTranscript(target.job, key, controller.signal);
      assertCurrentCredential();
      target.transcript = transcript; target.error = undefined;
      console.info('[Subtitles] ready', { videoId, jobId: target.job.id, segments: transcript.segments.length });
      return { ok: true, value: { job: target.job, transcript } };
    }).catch(error => {
      const failure = subtitleFailure(error);
      if (sameEntry(videoId, target, controller)) {
        target.error = target.submissionUnknown
          ? { code: 'SUBMISSION_UNKNOWN', message: '旧提交结果仍未知；未自动新建任务，重新提交必须再次确认。' }
          : { code: failure.code, message: failure.message, retryAfter: failure.retryAfter };
        console.warn('[Subtitles] failed', { videoId, jobId: target.job?.id, code: target.error?.code });
        return { ok: false as const, ...target.error! };
      }
      return { ok: false as const, code: failure.code, message: failure.message, retryAfter: failure.retryAfter };
    }).finally(() => {
      clearTimeout(deadline);
      if (!sameEntry(videoId, target, controller)) return;
      target.promise = undefined; target.controller = undefined;
      if (state.videoId === videoId) publishEntry();
    });
    publishEntry();
    return target.promise;
  }
  return {
    get: () => state, ensure,
    usage(): Promise<SubtitleUsage> {
      const credentialId = config.credentialId;
      if (!credentialId) return Promise.resolve({ credentialId, phase: 'unavailable', message: '请先保存字幕服务 Key。' });
      if (usageRequest?.credentialId === credentialId) return usageRequest.promise;
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 120000);
      const request = { credentialId, controller, promise: Promise.resolve().then(async () => {
        const key = await readKey(credentialId);
        const result = await provider.usage(key, credentialId, controller.signal);
        if (credentialId !== config.credentialId || controller.signal.aborted)
          throw new SubtitleFailure('CREDENTIAL_CHANGED', '字幕凭据已变化，旧账户查询已停止。');
        lastUsage = result;
        return result;
      }).catch(error => ({ credentialId, phase: 'error' as const, message: subtitleFailure(error).message,
        stale: lastUsage?.credentialId === credentialId && !!lastUsage.data,
        data: lastUsage?.credentialId === credentialId ? lastUsage.data : undefined
      })).finally(() => { clearTimeout(deadline); if (usageRequest === request) usageRequest = undefined; }) };
      usageRequest = request;
      return request.promise;
    },
    bind(videoId: string | null) {
      if (state.videoId === videoId) return;
      state = { revision: state.revision, videoId, phase: 'idle' }; publishEntry();
    },
    updatePlayback(playback: NonNullable<SubtitleState['playback']>) {
      if (!state.videoId) return;
      state = { ...state, playback, maxReachedSeconds: playback.phase === 'content' && playback.seconds !== undefined
        ? Math.max(state.maxReachedSeconds ?? 0, playback.seconds) : state.maxReachedSeconds }; notify();
    },
    snapshot() {
      if (!state.videoId || currentVideo() !== state.videoId) return undefined;
      const entry = entries.get(state.videoId);
      const sentAt = Date.now();
      const playback = state.playback?.phase === 'content' && sentAt - state.playback.observedAt <= 1000
        ? state.playback : { observedAt: state.playback?.observedAt ?? sentAt, phase: state.playback?.phase === 'advertisement' ? 'advertisement' as const : 'unavailable' as const };
      return structuredClone({ videoId: state.videoId, url: youtubeVideoUrl(state.videoId), title: entry?.job?.video_title ?? undefined,
        transcriptId: entry?.job?.transcript_id ?? undefined, sentAt, playback, transcript: entry?.transcript });
    },
    async configure(settings: Settings) {
      if (settings.subtitles.credentialId === config.credentialId && settings.subtitles.consentVersion === config.consentVersion) return;
      config = settings.subtitles;
      const pending: Promise<unknown>[] = [];
      if (usageRequest) { usageRequest.controller.abort(); pending.push(usageRequest.promise); }
      lastUsage = undefined;
      for (const entry of entries.values()) {
        entry.controller?.abort(); if (entry.promise) pending.push(entry.promise);
      }
      await Promise.allSettled(pending);
      // 无任务且确定未提交的失败属于旧配置；新账户不能沿用旧账户的权限/额度错误。
      for (const entry of entries.values()) if (!entry.job && !entry.submissionUnknown) entry.error = undefined;
      publishEntry();
    },
    clear() {
      const pendingUsage = usageRequest;
      usageRequest = undefined; pendingUsage?.controller.abort(); lastUsage = undefined;
      for (const entry of entries.values()) entry.controller?.abort();
      entries.clear();
      state = { revision: state.revision, videoId: null, phase: 'idle' }; notify();
    }
  };
}
