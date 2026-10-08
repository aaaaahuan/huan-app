import { useEffect, useRef, useState } from 'react';

const MIN_LEFT = 240;
const MIN_RIGHT = 280;
const MIN_READER = 520;
const DIVIDER = 12;
export type PanelSide = 'left' | 'right';

export function usePanelWidths(leftHidden: boolean, rightHidden: boolean, priority: PanelSide) {
  const workspace = useRef<HTMLDivElement>(null);
  const drag = useRef<{ side: PanelSide; x: number; width: number } | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const [available, setAvailable] = useState(window.innerWidth);
  const [preferred, setPreferred] = useState({ left: 280, right: 320 });
  useEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const observer = new ResizeObserver(() => { if (element.clientWidth) setAvailable(element.clientWidth); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const end = () => { drag.current = undefined; setDragging(false); };
    window.addEventListener('blur', end);
    return () => window.removeEventListener('blur', end);
  }, []);

  // 窄窗口临时隐藏低优先级面板，不覆盖用户的展开宽度偏好。
  const compact = available < MIN_READER + MIN_LEFT + MIN_RIGHT + DIVIDER * 2;
  const both = !leftHidden && !rightHidden;
  const hideLeft = leftHidden || (compact && both && priority === 'right');
  const hideRight = rightHidden || (compact && both && priority === 'left');
  const budget = Math.max(0, available - MIN_READER - (hideLeft ? 0 : DIVIDER) - (hideRight ? 0 : DIVIDER));
  const left = hideLeft ? 0 : Math.max(MIN_LEFT, Math.min(preferred.left, budget - (hideRight ? 0 : MIN_RIGHT)));
  const right = hideRight ? 0 : Math.max(MIN_RIGHT, Math.min(preferred.right, budget - (hideLeft ? 0 : left)));
  const limits = {
    left: { min: MIN_LEFT, max: Math.max(MIN_LEFT, Math.min(420, budget - (hideRight ? 0 : right))) },
    right: { min: MIN_RIGHT, max: Math.max(MIN_RIGHT, Math.min(520, budget - (hideLeft ? 0 : left))) }
  };
  function change(side: PanelSide, value: number) {
    const { min, max } = limits[side];
    setPreferred(previous => ({ ...previous, [side]: Math.max(min, Math.min(max, value)) }));
  }
  function start(side: PanelSide, x: number) {
    drag.current = { side, x, width: side === 'left' ? left : right };
    setDragging(true);
  }
  function move(x: number) {
    const current = drag.current;
    if (current) change(current.side, current.width + (x - current.x) * (current.side === 'left' ? 1 : -1));
  }
  function end() { drag.current = undefined; setDragging(false); }
  return { workspace, left, right, hideLeft, hideRight, compact, limits, dragging, change, start, move, end };
}
