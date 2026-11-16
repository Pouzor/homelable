import { useId } from 'react';
import { selectInterfaceIsLight, useThemeStore } from '@/stores/themeStore';

/**
 * The mark's two palettes. Dark is the official one (`docs/logo/icon.svg`); on
 * the Light interface a near-black disc reads as a hole in the page, so the
 * mark turns light: pale disc, white house, deeper accents that hold contrast
 * on white, and no glow (blur halos go muddy on a light background).
 */
const MARK = {
  dark: {
    disc: '#0d1117', discStroke: 'none', glow: '#00d4ff', glowOpacity: 0.08,
    house: '#161b22', outline: '#00d4ff', door: '#0d1117',
    hub: '#00d4ff', node: '#39d353', top: '#a855f7', lineOpacity: 0.7, useGlow: true,
  },
  light: {
    disc: '#e8f6fd', discStroke: 'rgba(2, 136, 209, 0.25)', glow: '#03a9f4', glowOpacity: 0.12,
    house: '#ffffff', outline: '#0288d1', door: '#e8f6fd',
    hub: '#0288d1', node: '#2e9e44', top: '#8e44ec', lineOpacity: 0.85, useGlow: false,
  },
} as const;

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
  const light = useThemeStore(selectInterfaceIsLight);
  const c = light ? MARK.light : MARK.dark;
  const glow = c.useGlow ? `url(#${nodeGlow})` : undefined;

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
        data-variant={light ? 'light' : 'dark'}
      >
        <defs>
          <radialGradient id={bgGlow} cx="50%" cy="35%" r="55%">
            <stop offset="0%" stopColor={c.glow} stopOpacity={c.glowOpacity} />
            <stop offset="100%" stopColor={c.disc} stopOpacity="0" />
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
        <circle cx="32" cy="32" r="31.5" fill={c.disc} stroke={c.discStroke} strokeWidth="1" />
        <circle cx="32" cy="32" r="32" fill={`url(#${bgGlow})`} />

        {/* House body */}
        <path
          d="M32 11 L53 30 L48 30 L48 53 L16 53 L16 30 L11 30 Z"
          fill={c.house}
          stroke={c.outline}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />

        {/* Floor line (subtle) */}
        <line x1="16" y1="30" x2="48" y2="30" stroke={c.outline} strokeWidth="0.5" opacity="0.25" />

        {/* Door */}
        <rect
          x="27"
          y="40"
          width="10"
          height="13"
          rx="1.5"
          fill={c.door}
          stroke={c.outline}
          strokeWidth="1"
          opacity="0.9"
        />

        {/* Network lines (drawn under nodes) */}
        <line x1="32" y1="23" x2="32" y2="30" stroke={c.top} strokeWidth="1.2" opacity={c.lineOpacity} strokeLinecap="round" />
        <line x1="21" y1="38" x2="29" y2="33" stroke={c.node} strokeWidth="1.2" opacity={c.lineOpacity} strokeLinecap="round" />
        <line x1="43" y1="38" x2="35" y2="33" stroke={c.node} strokeWidth="1.2" opacity={c.lineOpacity} strokeLinecap="round" />

        {/* Center hub */}
        <circle cx="32" cy="33" r="5" fill={c.hub} opacity="0.12" />
        <circle cx="32" cy="33" r="3" fill={c.hub} filter={glow} />

        {/* Peripheral nodes */}
        <circle cx="21" cy="38" r="2.5" fill={c.node} filter={glow} />
        <circle cx="43" cy="38" r="2.5" fill={c.node} filter={glow} />
        <circle cx="32" cy="23" r="2" fill={c.top} filter={glow} />
      </svg>
      {showText && (
        <span
          className="font-bold tracking-tight"
          style={{ fontSize: size * 0.55, fontFamily: 'Inter, sans-serif' }}
        >
          <span style={{ color: 'var(--foreground, #e6edf3)' }}>Home</span>
          <span style={{ color: 'var(--primary, #00d4ff)' }}>lable</span>
        </span>
      )}
    </div>
  );
}
