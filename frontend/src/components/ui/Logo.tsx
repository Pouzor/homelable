import { useId } from 'react';

interface LogoProps {
  size?: number;
  showText?: boolean;
  className?: string;
}

/**
 * Official Homelable mark — kept in sync with `docs/logo/icon.svg`.
 * Wordmark colors follow `docs/logo/logo-md.svg` (Home = #e6edf3, lable = #00d4ff).
 */
export function Logo({ size = 32, showText = true, className = '' }: LogoProps) {
  // Colons are legal in a URL fragment but confuse some tooling — strip them.
  const uid = useId().replace(/:/g, '');
  const bgGlow = `homelable-bg-glow-${uid}`;
  const nodeGlow = `homelable-node-glow-${uid}`;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        data-testid="logo-mark"
      >
        <defs>
          <radialGradient id={bgGlow} cx="50%" cy="35%" r="55%">
            <stop offset="0%" stopColor="#00d4ff" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#0d1117" stopOpacity="0" />
          </radialGradient>
          <filter id={nodeGlow}>
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background */}
        <circle cx="32" cy="32" r="32" fill="#0d1117" />
        <circle cx="32" cy="32" r="32" fill={`url(#${bgGlow})`} />

        {/* House body */}
        <path
          d="M32 11 L53 30 L48 30 L48 53 L16 53 L16 30 L11 30 Z"
          fill="#161b22"
          stroke="#00d4ff"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />

        {/* Floor line (subtle) */}
        <line x1="16" y1="30" x2="48" y2="30" stroke="#00d4ff" strokeWidth="0.5" opacity="0.25" />

        {/* Door */}
        <rect
          x="27"
          y="40"
          width="10"
          height="13"
          rx="1.5"
          fill="#0d1117"
          stroke="#00d4ff"
          strokeWidth="1"
          opacity="0.9"
        />

        {/* Network lines (drawn under nodes) */}
        <line x1="32" y1="23" x2="32" y2="30" stroke="#a855f7" strokeWidth="1.2" opacity="0.7" strokeLinecap="round" />
        <line x1="21" y1="38" x2="29" y2="33" stroke="#39d353" strokeWidth="1.2" opacity="0.7" strokeLinecap="round" />
        <line x1="43" y1="38" x2="35" y2="33" stroke="#39d353" strokeWidth="1.2" opacity="0.7" strokeLinecap="round" />

        {/* Center hub */}
        <circle cx="32" cy="33" r="5" fill="#00d4ff" opacity="0.12" />
        <circle cx="32" cy="33" r="3" fill="#00d4ff" filter={`url(#${nodeGlow})`} />

        {/* Peripheral nodes */}
        <circle cx="21" cy="38" r="2.5" fill="#39d353" filter={`url(#${nodeGlow})`} />
        <circle cx="43" cy="38" r="2.5" fill="#39d353" filter={`url(#${nodeGlow})`} />
        <circle cx="32" cy="23" r="2" fill="#a855f7" filter={`url(#${nodeGlow})`} />
      </svg>
      {showText && (
        <span
          className="font-bold tracking-tight"
          style={{ fontSize: size * 0.55, fontFamily: 'Inter, sans-serif' }}
        >
          <span style={{ color: '#e6edf3' }}>Home</span>
          <span style={{ color: '#00d4ff' }}>lable</span>
        </span>
      )}
    </div>
  );
}
