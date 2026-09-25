// 原生 tooltip 不受列表滚动裁剪；完整文本仍保留在可访问名称中。
export function TruncatedText({ text, className = '' }: { text: string; className?: string }) {
  return <span className={`ui-truncated ${className}`} title={text}>{text}</span>;
}
