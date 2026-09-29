type Props = {
  label: string; controls: string; value: number; min: number; max: number; direction: 1 | -1;
  onStart(x: number): void; onMove(x: number): void; onEnd(): void; onChange(value: number): void;
};

export function PanelDivider({ label, controls, value, min, max, direction, onStart, onMove, onEnd, onChange }: Props) {
  return <div className="panel-divider" role="separator" tabIndex={0} aria-label={label}
    aria-orientation="vertical" aria-controls={controls} aria-valuemin={min} aria-valuemax={max}
    aria-valuenow={Math.round(value)} aria-valuetext={`${Math.round(value)} 像素`}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId); onStart(event.clientX);
    }}
    onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) onMove(event.clientX); }}
    onPointerUp={event => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      onEnd();
    }}
    onPointerCancel={onEnd} onLostPointerCapture={onEnd}
    onKeyDown={event => {
      const next = event.key === 'Home' ? min : event.key === 'End' ? max
        : event.key === 'ArrowLeft' ? value - direction * 16 : event.key === 'ArrowRight' ? value + direction * 16 : undefined;
      if (next !== undefined) { event.preventDefault(); onChange(Math.max(min, Math.min(max, next))); }
    }} />;
}
