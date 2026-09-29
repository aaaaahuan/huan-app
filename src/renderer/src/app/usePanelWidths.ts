import { useEffect, useRef, useState } from 'react';

const MIN_LEFT = 240;
const MIN_RIGHT = 280;
const MIN_READER = 320;
const DIVIDER = 6;
type Side = 'left' | 'right';

export function usePanelWidths(leftHidden: boolean, rightHidden: boolean) {
  const workspace = useRef<HTMLDivElement>(null);
  const drag = useRef<{ side: Side; x: number; width: number } | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const [available, setAvailable] = useState(window.innerWidth);
  const [preferred, setPreferred] = useState({ left: 350, right: 340 });
  useEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setAvailable(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const end = () => { drag.current = undefined; setDragging(false); };
    window.addEventListener('blur', end);
    return () => window.removeEventListener('blur', end);
  }, []);

  // 窗口缩小时只压缩实际宽度，保留用户偏好；展开侧栏也不能挤占阅读区。
  const budget = available - MIN_READER - (leftHidden ? 0 : DIVIDER) - (rightHidden ? 0 : DIVIDER);
  const left = leftHidden ? 0 : Math.max(MIN_LEFT, Math.min(preferred.left, budget - (rightHidden ? 0 : MIN_RIGHT)));
  const right = rightHidden ? 0 : Math.max(MIN_RIGHT, Math.min(preferred.right, budget - left));
  const limits = {
    left: { min: MIN_LEFT, max: Math.max(MIN_LEFT, Math.min(420, budget - right)) },
    right: { min: MIN_RIGHT, max: Math.max(MIN_RIGHT, Math.min(520, budget - left)) }
  };
  function change(side: Side, value: number) {
    const { min, max } = limits[side];
    setPreferred(previous => ({ ...previous, [side]: Math.max(min, Math.min(max, value)) }));
  }
  function start(side: Side, x: number) {
    drag.current = { side, x, width: side === 'left' ? left : right };
    setDragging(true);
  }
  function move(x: number) {
    const current = drag.current;
    if (current) change(current.side, current.width + (x - current.x) * (current.side === 'left' ? 1 : -1));
  }
  function end() { drag.current = undefined; setDragging(false); }
  return { workspace, left, right, limits, dragging, change, start, move, end };
}
