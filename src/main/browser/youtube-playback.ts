import { z } from 'zod';
import type { WebContents } from 'electron';
import { youtubeVideoId, type SubtitleResult, type SubtitleState } from '@shared/contracts/subtitles';
import type { createPageHost } from './page-host';

const sampleSchema = z.discriminatedUnion('phase', [
  z.object({ phase: z.literal('content'), seconds: z.number().finite().nonnegative(), duration: z.number().finite().nonnegative(), playing: z.boolean() }),
  z.object({ phase: z.literal('advertisement') }), z.object({ phase: z.literal('unavailable') })
]);
function playerScript(videoId: string, seconds?: number): string {
  return `(() => {
    const id = ${JSON.stringify(videoId)};
    const url = new URL(location.href);
    if (url.pathname !== '/watch' || url.searchParams.get('v') !== id) return { phase: 'unavailable' };
    const root = document.querySelector('ytd-watch-flexy[video-id="' + id + '"],ytd-watch-grid[video-id="' + id + '"]');
    const player = root?.querySelector('#movie_player');
    const video = player?.querySelector('video.html5-main-video');
    if (!video) return { phase: 'unavailable' };
    if (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting')) return { phase: 'advertisement' };
    if (video.readyState < 1 || !Number.isFinite(video.currentTime) || !Number.isFinite(video.duration)) return { phase: 'unavailable' };
    ${seconds === undefined ? '' : `const seconds = ${JSON.stringify(seconds)};
    let seekable = false;
    for (let i = 0; i < video.seekable.length; i++) if (seconds >= video.seekable.start(i) && seconds <= video.seekable.end(i)) seekable = true;
    if (seconds > video.duration || !seekable) return { phase: 'unavailable' };
    video.currentTime = seconds;`}
    return { phase: 'content', seconds: video.currentTime, duration: video.duration,
      playing: !video.paused && !video.ended && video.readyState >= 3 };
  })()`;
}

export function createYouTubePlayback(host: ReturnType<typeof createPageHost>,
  bind: (videoId: string | null) => void, update: (playback: NonNullable<SubtitleState['playback']>) => void,
  onPlaying: (videoId: string) => void) {
  let contents: WebContents | undefined;
  let videoId: string | null = null;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let detach = () => {};
  function currentVideo() { return contents && !contents.isDestroyed() && !contents.isCrashed() ? youtubeVideoId(contents.getURL()) : null; }
  function matches(target: WebContents, id: string, epoch: number) {
    return contents === target && generation === epoch && !target.isDestroyed() && !target.isCrashed() && currentVideo() === id;
  }
  function reset(id: string | null) {
    clearTimeout(timer); generation++; videoId = id; bind(id);
    if (contents && id) void sample(contents, id, generation);
  }
  async function sample(target: WebContents, id: string, epoch: number) {
    if (!matches(target, id, epoch)) return;
    const observedAt = Date.now();
    const unavailable = () => { if (matches(target, id, epoch)) update({ observedAt, phase: 'unavailable' }); };
    const watchdog = setTimeout(unavailable, 2000);
    try {
      const raw: unknown = await target.executeJavaScriptInIsolatedWorld(1003, [{ code: playerScript(id) }]);
      if (!matches(target, id, epoch)) return;
      const parsed = sampleSchema.safeParse(raw);
      if (!parsed.success || Date.now() - observedAt > 1000) unavailable();
      else {
        update({ observedAt, phase: parsed.data.phase, seconds: parsed.data.phase === 'content' ? parsed.data.seconds : undefined });
        if (parsed.data.phase === 'content' && parsed.data.playing) onPlaying(id);
      }
    } catch { unavailable(); }
    finally {
      clearTimeout(watchdog);
      if (matches(target, id, epoch)) timer = setTimeout(() => void sample(target, id, epoch), 250);
    }
  }
  const off = host.observeContents(next => {
    detach(); contents = next; reset(null);
    if (!next) return;
    const navigate = () => { const id = currentVideo(); if (id !== videoId) reset(id); };
    const inPage = (_event: Electron.Event, _url: string, main: boolean) => { if (main) navigate(); };
    const start = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => { if (event.isMainFrame && !event.isSameDocument) reset(null); };
    const gone = () => reset(null);
    next.on('did-start-navigation', start);
    next.on('did-navigate', navigate);
    next.on('did-navigate-in-page', inPage);
    next.on('did-stop-loading', navigate);
    next.on('render-process-gone', gone);
    next.on('destroyed', gone);
    detach = () => {
      next.removeListener('did-start-navigation', start); next.removeListener('did-navigate', navigate);
      next.removeListener('did-navigate-in-page', inPage); next.removeListener('render-process-gone', gone); next.removeListener('destroyed', gone);
      next.removeListener('did-stop-loading', navigate);
    };
    navigate();
  });
  return {
    currentVideo,
    async seek(id: string, seconds: number): Promise<SubtitleResult> {
      const target = contents, epoch = generation;
      if (!target || currentVideo() !== id || host.isSuspended()) return { ok: false, code: 'PLAYBACK_UNAVAILABLE', message: '当前视频播放器不可用。' };
      try {
        const raw: unknown = await target.executeJavaScriptInIsolatedWorld(1003, [{ code: playerScript(id, seconds) }]);
        const result = sampleSchema.safeParse(raw);
        if (!matches(target, id, epoch) || !result.success || result.data.phase !== 'content')
          return { ok: false, code: 'PLAYBACK_UNAVAILABLE', message: '广告、播放器或目标时间不可定位；可继续手动阅读。' };
        // 不调用 play/pause，保持原播放器状态；立即发布真实结果。
        update({ observedAt: Date.now(), phase: 'content', seconds: result.data.seconds });
        return { ok: true, value: undefined };
      } catch { return { ok: false, code: 'PLAYBACK_UNAVAILABLE', message: '视频定位失败；可继续手动阅读。' }; }
    },
    close() { off(); detach(); contents = undefined; reset(null); }
  };
}
