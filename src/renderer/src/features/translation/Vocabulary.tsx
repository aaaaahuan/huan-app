import { useEffect, useState } from 'react';
import { MarkdownPreview } from '@renderer/components/MarkdownPreview';
import type { VocabularyCard } from '@shared/contracts/english-study';
import { Button } from '@renderer/components/Button';
import { StudyModal } from './StudyModal';

export function Vocabulary({ onClose }: { onClose(): void }) {
  const [cards, setCards] = useState<VocabularyCard[]>([]);
  const [filter, setFilter] = useState('');
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let disposed = false;
    void window.huanApp.translation.vocabulary().then(result => {
      if (!disposed) { setCards(result.cards); setState('ready'); }
    }, failure => { if (!disposed) { setError(String(failure)); setState('failed'); } });
    return () => { disposed = true; };
  }, [revision]);
  const shown = cards.filter(card => `${card.word} ${card.content}`.toLowerCase().includes(filter.toLowerCase()));
  return <StudyModal title="生词本" onClose={onClose}>
    <div className="study-toolbar"><p>来自 Obsidian · {cards.length} 个词条</p><Button disabled={state === 'loading'} onClick={() => { setState('loading'); setError(''); setRevision(value => value + 1); }}>刷新</Button></div>
    <input className="study-search" aria-label="搜索生词" placeholder="搜索单词、释义或例句…" value={filter} onChange={event => setFilter(event.target.value)} />
    {state === 'loading' ? <p role="status">正在读取生词本…</p> : null}
    {error ? <p className="translation-error" role="alert">{error}</p> : null}
    {state === 'ready' && !shown.length ? <p>{cards.length ? '没有匹配的词条。' : '生词本还没有词条。在长句练习中选中英语单词，即可加入。'}</p> : null}
    <div className="vocabulary-grid">{shown.map((card, index) => <article className="vocabulary-card" key={`${card.word}-${index}`}>
      <h3>{card.word}</h3><MarkdownPreview content={card.content} onOpenLink={url => {
        void window.huanApp.algorithms.openNoteLink(url).then(result => {
          if (!result.ok) setError(result.message);
        }, failure => setError(String(failure)));
      }} />
    </article>)}</div>
  </StudyModal>;
}
