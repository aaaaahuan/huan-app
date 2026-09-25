import type { SVGProps } from 'react';

export type IconName = 'search' | 'chevron' | 'settings' | 'collapse' | 'expand' | 'back' | 'forward' | 'book' | 'bookmarks' | 'plus';

// 图形集中维护；业务组件只选择语义名称，不重复拼装 SVG。
export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  if (name === 'book') return <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" {...props}>
    <path d="M24 12c-5-4-12-5-19-3v28c7-2 14-1 19 3 5-4 12-5 19-3V9c-7-2-14-1-19 3Zm0 0v28" />
    <path d="M11 17c3 0 5 .5 7 1.5M30 18.5c2-1 4-1.5 7-1.5" />
  </svg>;
  if (name === 'bookmarks') return <svg viewBox="0 0 96 96" fill="none" aria-hidden="true" {...props}>
    <circle cx="48" cy="48" r="39" fill="#eff5ed" />
    <rect x="26" y="25" width="39" height="49" rx="7" fill="#e3eddf" transform="rotate(-8 26 25)" />
    <rect x="30" y="21" width="38" height="50" rx="7" fill="#fafcf8" stroke="currentColor" strokeWidth="1.5" />
    <path d="M49 22v22l6-4 6 4V22M39 54h19M39 61h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    {name === 'search' ? <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></> : null}
    {name === 'chevron' ? <path d="m7 10 5 5 5-5" /> : null}
    {name === 'plus' ? <path d="M12 5v14M5 12h14" /> : null}
    {name === 'settings' ? <><path d="m9 3 6 0 1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z" /><circle cx="12" cy="12" r="3" /></> : null}
    {name === 'collapse' || name === 'expand' ? <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /><path d={name === 'expand' ? 'm13 9 3 3-3 3' : 'm17 9-3 3 3 3'} /></> : null}
    {name === 'back' ? <path d="M20 12H4m6-6-6 6 6 6" /> : null}
    {name === 'forward' ? <path d="M4 12h16m-6-6 6 6-6 6" /> : null}
  </svg>;
}
