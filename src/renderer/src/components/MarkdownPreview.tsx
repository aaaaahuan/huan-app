import Markdown from 'react-markdown';

export function MarkdownPreview({ content, onOpenLink }: { content: string; onOpenLink(url: string): void }) {
  // 不执行 HTML、不加载外部图片；Obsidian 双链和嵌入语法仍原样保存在源文件。
  const body = content.replace(/^(?:\uFEFF)?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '');
  return <div className="ui-markdown"><Markdown skipHtml components={{
    a: ({ href, children }) => /^https?:\/\//i.test(href ?? '') ?
      <a href={href} onClick={event => { event.preventDefault(); if (href) onOpenLink(href); }}>{children}</a> :
      <span title={href}>{children}</span>,
    img: ({ alt }) => <span className="ui-markdown-image">图片：{alt || '请在 Obsidian 中查看'}</span>
  }}>{body}</Markdown></div>;
}
