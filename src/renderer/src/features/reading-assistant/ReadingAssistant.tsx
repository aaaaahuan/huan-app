import { useEffect, useRef, useState } from 'react';
import type { ReaderState } from '@shared/contracts/browser';
import { isYouTubeUrl } from '@shared/contracts/subtitles';
import { Tabs } from '@renderer/components/Tabs';
import { AIChat } from '@renderer/features/ai-chat/AIChat';
import { Subtitles } from '@renderer/features/subtitles/Subtitles';
import './reading-assistant.css';

type ReadingTab = 'reading-chat' | 'reading-subtitles';
export function ReadingAssistant({ collapsed, settingsRevision, onConfigure }: {
  collapsed: boolean; settingsRevision: number; onConfigure(tab: 'ai' | 'subtitles'): void;
}) {
  const [page, setPage] = useState<ReaderState>();
  const [tab, setTab] = useState<ReadingTab>('reading-chat');
  const revision = useRef(-1);
  useEffect(() => {
    let cancelled = false;
    const accept = (next: ReaderState) => {
      if (cancelled || next.revision <= revision.current) return;
      revision.current = next.revision;
      setPage(next);
      // 切换收藏时主进程先发布空 URL；这不是已确认离开 YouTube，不能丢失 Tab 选择。
      if ((next.url && !isYouTubeUrl(next.url)) || next.phase === 'empty') setTab('reading-chat');
    };
    const off = window.huanApp.browser.onState(accept);
    void window.huanApp.browser.get().then(accept).catch(() => undefined);
    return () => { cancelled = true; off(); };
  }, []);
  const youtube = isYouTubeUrl(page?.url ?? '');
  const active = youtube ? tab : 'reading-chat';
  return <aside id="ai-chat" className="reading-assistant" hidden={collapsed} aria-label="伴读面板">
    <Tabs<ReadingTab> className="reading-tabs" label="伴读视图" value={active} onChange={setTab}
      options={youtube ? [{ value: 'reading-chat', label: 'AI 伴读' }, { value: 'reading-subtitles', label: '实时字幕' }]
        : [{ value: 'reading-chat', label: 'AI 伴读' }]} />
    <AIChat collapsed={active !== 'reading-chat'} settingsRevision={settingsRevision} onConfigure={() => onConfigure('ai')} />
    <Subtitles visible={!collapsed && active === 'reading-subtitles'} hidden={active !== 'reading-subtitles'}
      settingsRevision={settingsRevision} onConfigure={() => onConfigure('subtitles')} />
  </aside>;
}
