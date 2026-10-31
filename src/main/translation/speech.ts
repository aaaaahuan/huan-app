import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import type { SpeechRequest, SpeechResult } from '@shared/contracts/translation';

const execute = promisify(execFile);
export function createSpeechPlayback() {
  type SpeechRun = { id: string; cancelled: boolean; child?: ChildProcessWithoutNullStreams };
  let active: SpeechRun | undefined;
  let voice: string | undefined;
  let closed = false;
  function stop(id?: string) {
    if (!active || (id && active.id !== id)) return;
    active.cancelled = true;
    active.child?.kill('SIGTERM');
  }
  return {
    hasWork: () => !!active,
    stop,
    close() { closed = true; stop(); },
    async speak(request: SpeechRequest): Promise<SpeechResult> {
      if (closed) return { status: 'failed', error: '朗读服务已关闭。' };
      if (active) return { status: 'failed', error: '请先停止当前朗读。' };
      const run: SpeechRun = { id: request.requestId, cancelled: false };
      active = run;
      try {
        if (process.platform !== 'darwin') throw new Error('当前英语朗读需要 macOS 系统语音。');
        if (!voice) {
          const { stdout } = await execute('/usr/bin/say', ['-v', '?'], { timeout: 5000, maxBuffer: 256 * 1024 });
          const english = [...stdout.matchAll(/^(.+?)\s+en[_-][A-Z]{2}\s+#/gm)].map(match => match[1].trim());
          voice = ['Samantha', 'Alex', 'Daniel', 'Karen'].map(name => english.find(voice => voice === name || voice.startsWith(`${name} (`))).find(Boolean) ?? english[0];
          if (!voice) throw new Error('未找到已安装的英语语音，请在 macOS 系统设置中添加英语语音后重试。');
        }
        if (run.cancelled) return { status: 'stopped' };
        const selectedVoice = voice;
        return await new Promise<SpeechResult>(resolve => {
          // 固定可执行文件与参数，正文经 stdin 传入；不执行 shell，也不解释语音控制标记。
          const child = spawn('/usr/bin/say', ['-v', selectedVoice, '-r', '170', '-f', '-'], { stdio: 'pipe' });
          run.child = child;
          child.stdout.resume(); child.stderr.resume();
          child.stdin.on('error', () => { /* 子进程提前退出由 error/close 统一反馈。 */ });
          child.once('error', () => resolve({ status: 'failed', error: '无法启动系统英语朗读，请稍后重试。' }));
          child.once('close', code => resolve(run.cancelled ? { status: 'stopped' } : code === 0 ? { status: 'complete' }
            : { status: 'failed', error: '系统英语朗读失败，请检查语音与音频输出设置。' }));
          child.stdin.end(request.text.replace(/\[\[[\s\S]*?\]\]/g, ' ').replace(/\0/g, ''));
        });
      } catch (error) {
        return run.cancelled ? { status: 'stopped' } : { status: 'failed', error: error instanceof Error ? error.message : String(error) };
      } finally { if (active === run) active = undefined; }
    }
  };
}
