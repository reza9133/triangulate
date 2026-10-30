/** Three nodes converge on one point: the app's own loading mark. */
export function TriSpinner({ size = 56, label = 'Loading' }: { size?: number; label?: string }) {
  return (
    <span className="spinner" role="status" aria-label={label}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <path
          className="tri"
          d="M32 8 L56 52 L8 52 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinejoin="round"
          opacity="0.55"
        />
        <g className="orbit" fill="currentColor">
          <circle cx="32" cy="8" r="4.5" />
          <circle cx="56" cy="52" r="4.5" />
          <circle cx="8" cy="52" r="4.5" />
        </g>
        <circle className="core" cx="32" cy="40" r="5" fill="var(--accent-2)" />
      </svg>
    </span>
  );
}

/** Expanding rings: used while validators are working on a transaction. */
export function EchoSpinner({
  size = 44,
  label = 'Waiting for validators',
}: {
  size?: number;
  label?: string;
}) {
  return (
    <span className="ripple" role="status" aria-label={label} style={{ width: size, height: size }}>
      <i />
      <i />
      <i />
      <b />
    </span>
  );
}

export function LoadingBlock({ text = 'Reading the chain…' }: { text?: string }) {
  return (
    <div className="loading-block">
      <TriSpinner />
      <div>{text}</div>
    </div>
  );
}

export function Skeleton({ height = 18, width = '100%' }: { height?: number; width?: string | number }) {
  return <div className="skeleton" style={{ height, width }} aria-hidden="true" />;
}
