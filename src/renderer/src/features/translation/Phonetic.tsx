export function Phonetic({ value }: { value?: string }) {
  if (!value) return null;
  return <p className="translation-phonetic" aria-label="英语音标" lang="en-fonipa">{value}</p>;
}
