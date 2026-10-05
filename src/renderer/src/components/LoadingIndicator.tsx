export function LoadingIndicator({ label, className = '' }: { label: string; className?: string }) {
  return <p className={`ui-loading ${className}`} role="status">{label}</p>;
}
