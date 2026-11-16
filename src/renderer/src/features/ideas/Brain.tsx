import { useEffect, useRef, useState } from 'react';
import type { IdeaEntry } from '@shared/contracts/ideas';
import data from './brain.json';

export function Brain({ entries, pulseID, active }: { entries: IdeaEntry[]; pulseID?: string; active: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  const live = useRef({ entries, pulseID });
  live.current = { entries, pulseID };
  const redraw = useRef<() => void>(() => undefined);
  const pulse = useRef(0);
  useEffect(() => {
    const element = canvas.current;
    if (!element || !active) return;
    const ctx = element.getContext('2d');
    if (!ctx) { setUnavailable(true); return; }
    let yaw = -.5, pitch = .35, dragging = false, x = 0, y = 0;
    let frame = 0;
    function draw() {
      if (!element || !ctx) return;
      const { width: w, height: h } = element.getBoundingClientRect();
      if (!w || !h) return;
      const d = Math.min(window.devicePixelRatio || 1, 2);
      if (element.width !== Math.round(w * d) || element.height !== Math.round(h * d)) { element.width = Math.round(w * d); element.height = Math.round(h * d); }
      ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const scale = Math.min(w / 3.25, h / 2.65);
      const rotate = (v: number[]) => { const x = v[0] * cy + v[2] * sy, z = -v[0] * sy + v[2] * cy; return [x, v[1] * cp - z * sp, v[1] * sp + z * cp]; };
      const project = (v: number[]) => { const r = rotate(v); return [w / 2 + r[0] * scale * (1 + r[2] * .045), h * .49 - r[1] * scale * (1 + r[2] * .045), r[2]]; };
      const vertices = data.vertices.map(project);
      const facing = data.normals.map(v => rotate(v)[2]);
      ctx.strokeStyle = '#65cbdc'; ctx.lineWidth = .65; ctx.globalAlpha = .28;
      ctx.beginPath();
      for (const [a, b] of data.edges) if (facing[a] * facing[b] < 0) { ctx.moveTo(vertices[a][0], vertices[a][1]); ctx.lineTo(vertices[b][0], vertices[b][1]); }
      ctx.stroke();
      data.fibers.forEach((path, i) => {
        ctx.beginPath(); ctx.strokeStyle = i % 5 === 0 ? '#91a5ed' : '#56c9eb'; ctx.lineWidth = .65 + i % 3 * .2;
        const depth = path.reduce((sum, k) => sum + vertices[k][2], 0) / path.length;
        ctx.globalAlpha = (.14 + i % 7 * .04) * Math.max(.35, Math.min(1, (depth + 1.3) / 2));
        path.forEach((k, j) => { if (j) ctx.lineTo(vertices[k][0], vertices[k][1]); else ctx.moveTo(vertices[k][0], vertices[k][1]); }); ctx.stroke();
      });
      for (const entry of live.current.entries) {
        // FNV-1a 与 iOS 保持一致；记录位置与顺序无关，重读或插入旧记录不会重新洗牌。
        let hash = 2166136261;
        for (let i = 0; i < entry.id.length; i++) hash = Math.imul(hash ^ entry.id.charCodeAt(i), 16777619) >>> 0;
        const anchor = data.anchors[hash % data.anchors.length];
        const position = data.vertices[anchor].map((v, i) => v + (((hash >>> (i * 8)) & 255) / 255 - .5) * .018);
        const q = project(position), strength = Math.max(.3, Math.min(1, (q[2] + 1.3) / 2.5));
        ctx.globalAlpha = strength; ctx.shadowColor = '#9effef'; ctx.shadowBlur = 9; ctx.fillStyle = '#c2fff3'; ctx.beginPath(); ctx.arc(q[0], q[1], 1.8, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
        if (entry.id === live.current.pulseID && pulse.current > 0) {
          ctx.globalAlpha = pulse.current * .75; ctx.strokeStyle = '#c9fff3'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(q[0], q[1], 5 + (1 - pulse.current) * 30, 0, Math.PI * 2); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); };
    redraw.current = schedule;
    const down = (event: PointerEvent) => { dragging = true; x = event.clientX; y = event.clientY; element.setPointerCapture(event.pointerId); };
    const move = (event: PointerEvent) => { if (!dragging) return; yaw += (event.clientX - x) * .008; pitch = Math.max(-1.1, Math.min(1.2, pitch + (event.clientY - y) * .006)); x = event.clientX; y = event.clientY; schedule(); };
    const up = () => { dragging = false; };
    element.addEventListener('pointerdown', down); element.addEventListener('pointermove', move); element.addEventListener('pointerup', up); element.addEventListener('pointercancel', up);
    const observer = new ResizeObserver(schedule); observer.observe(element); schedule();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); element.removeEventListener('pointerdown', down); element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', up); element.removeEventListener('pointercancel', up); redraw.current = () => undefined; };
  }, [active]);
  useEffect(() => { redraw.current(); }, [entries]);
  useEffect(() => {
    if (!pulseID || !active || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const start = performance.now(); let frame = 0;
    function animate() { pulse.current = Math.max(0, 1 - (performance.now() - start) / 1100); redraw.current(); if (pulse.current > 0) frame = requestAnimationFrame(animate); }
    animate(); return () => { cancelAnimationFrame(frame); pulse.current = 0; };
  }, [pulseID, active]);
  return <div className="idea-universe"><span className="idea-scene-label">IDEA NEURAL NETWORK</span><canvas ref={canvas} aria-label={`光纤大脑，${entries.length} 个灵感光点，可拖动旋转`} role="img" />
    <span className="idea-scene-caption">{unavailable ? '图形预览不可用，仍可记录灵感' : '每一个念头，都有一个位置'}</span></div>;
}
