import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { ensureSubtitlesSchema, seekSubtitlesSchema } from '@shared/contracts/subtitles';
import type { createSubtitleService } from './service';
import type { createYouTubePlayback } from '@main/browser/youtube-playback';

export function registerSubtitles(service: ReturnType<typeof createSubtitleService>, playback: ReturnType<typeof createYouTubePlayback>,
  assertTrusted: (event: IpcMainInvokeEvent) => void) {
  ipcMain.handle(IPC_CHANNELS.subtitles.get, event => { assertTrusted(event); return service.get(); });
  ipcMain.handle(IPC_CHANNELS.subtitles.ensure, (event, input: unknown) => {
    assertTrusted(event);
    const parsed = ensureSubtitlesSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: 'INVALID_INPUT', message: '字幕请求参数不正确。' };
    return service.ensure(parsed.data.videoId, parsed.data.retry);
  });
  ipcMain.handle(IPC_CHANNELS.subtitles.seek, (event, input: unknown) => {
    assertTrusted(event);
    const parsed = seekSubtitlesSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: 'INVALID_INPUT', message: '视频定位参数不正确。' };
    return playback.seek(parsed.data.videoId, parsed.data.seconds);
  });
}
