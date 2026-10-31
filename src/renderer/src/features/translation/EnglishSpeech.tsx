import { useEffect, useRef, useState } from 'react';
import { Button } from '@renderer/components/Button';

export function useEnglishSpeech() {
  const [owner, setOwner] = useState('');
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<{ owner: string; text: string }>();
  const run = useRef<{ id: string; owner: string } | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (run.current) void window.huanApp.translation.stopSpeech(run.current.id).catch(() => undefined);
    };
  }, []);
  async function stop() {
    const current = run.current;
    if (!current) return;
    setStopping(true);
    try { await window.huanApp.translation.stopSpeech(current.id); }
    catch (failure) { if (mounted.current) { setError({ owner: current.owner, text: String(failure) }); setStopping(false); } }
  }
  async function play(nextOwner: string, text: string) {
    if (run.current || !text.trim()) return;
    const current = { id: crypto.randomUUID(), owner: nextOwner };
    run.current = current; setOwner(nextOwner); setStopping(false); setError(undefined);
    try {
      const result = await window.huanApp.translation.speak({ requestId: current.id, text });
      if (mounted.current && result.error) setError({ owner: nextOwner, text: result.error });
    } catch (failure) { if (mounted.current) setError({ owner: nextOwner, text: String(failure) }); }
    finally { if (run.current === current) { run.current = undefined; if (mounted.current) { setOwner(''); setStopping(false); } } }
  }
  return { owner, stopping, error, play, stop };
}
export type EnglishSpeech = ReturnType<typeof useEnglishSpeech>;

export function SpeechButton({ speech, owner, text, label }: { speech: EnglishSpeech; owner: string; text: string; label: string }) {
  const playing = speech.owner === owner;
  return <span className="study-speech">
    <Button aria-label={playing ? `停止朗读${label}` : `朗读${label}`} title="系统英语语音" disabled={playing ? speech.stopping : !!speech.owner || !/[a-z]/i.test(text)}
      onClick={() => void (playing ? speech.stop() : speech.play(owner, text))}>{playing ? speech.stopping ? '正在停止…' : '停止朗读' : '朗读'}</Button>
    {speech.error?.owner === owner ? <span className="study-speech-error" role="alert">{speech.error.text}</span> : null}
  </span>;
}
