import { useId } from 'react';

/**
 * The Triangulate mark: three sources at the corners of a triangle, and the point where their lines
 * meet. One position fixed by several independent bearings is what the name means.
 */
export function LogoMark({ size = 32, animated = true }: { size?: number; animated?: boolean }) {
  const gid = useId().replace(/:/g, '');
  return (
    <svg
      className={animated ? 'logo-mark' : undefined}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Triangulate logo"
    >
      <defs>
        <linearGradient id={`g${gid}`} x1="8" y1="58" x2="58" y2="6" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent-2)" />
        </linearGradient>
      </defs>
      <path
        d="M32 5 L59 55 L5 55 Z"
        fill="none"
        stroke={`url(#g${gid})`}
        strokeWidth="4.5"
        strokeLinejoin="round"
      />
      <g stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" opacity="0.85">
        <path className="edge" d="M32 5 L32 38" />
        <path className="edge" d="M5 55 L30 40.5" />
        <path className="edge" d="M59 55 L34 40.5" />
      </g>
      <circle cx="32" cy="5" r="4" fill="var(--ink)" />
      <circle cx="5" cy="55" r="4" fill="var(--ink)" />
      <circle cx="59" cy="55" r="4" fill="var(--ink)" />
      <circle className="pt" cx="32" cy="40" r="6.5" fill={`url(#g${gid})`} />
      <circle cx="32" cy="40" r="2.3" fill="var(--bg)" />
    </svg>
  );
}

export function Wordmark({ size = 30 }: { size?: number }) {
  return (
    <span className="brand">
      <LogoMark size={size} />
      <span>Triangulate</span>
    </span>
  );
}

/** The official GenLayer mark, used as an inline mask so it follows the theme colour. */
export function GenLayerMark({ size = 22 }: { size?: number }) {
  const url = `${import.meta.env.BASE_URL}brand/genlayer-logo.svg`;
  return (
    <span
      role="img"
      aria-label="GenLayer"
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        background: 'currentColor',
        WebkitMask: `url(${url}) center / contain no-repeat`,
        mask: `url(${url}) center / contain no-repeat`,
      }}
    />
  );
}
