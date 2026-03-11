interface LogoProps {
  size?: number;
  showText?: boolean;
  className?: string;
}

export function Logo({ size = 32, showText = true, className = '' }: LogoProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="32" cy="32" r="32" fill="#0d1117" />
        <path
          d="M32 12 L52 30 L48 30 L48 52 L16 52 L16 30 L12 30 Z"
          fill="#161b22"
          stroke="#00d4ff"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <rect x="27" y="40" width="10" height="12" rx="1" fill="#0d1117" stroke="#00d4ff" strokeWidth="1" />
        <circle cx="32" cy="33" r="3" fill="#00d4ff" />
        <circle cx="22" cy="38" r="2" fill="#39d353" />
        <line x1="22" y1="38" x2="29" y2="33" stroke="#39d353" strokeWidth="1" opacity="0.7" />
        <circle cx="42" cy="38" r="2" fill="#39d353" />
        <line x1="42" y1="38" x2="35" y2="33" stroke="#39d353" strokeWidth="1" opacity="0.7" />
        <circle cx="32" cy="24" r="2" fill="#a855f7" />
        <line x1="32" y1="24" x2="32" y2="30" stroke="#a855f7" strokeWidth="1" opacity="0.7" />
        <circle cx="32" cy="33" r="3" fill="none" stroke="#00d4ff" strokeWidth="1.5" opacity="0.4" />
      </svg>
      {showText && (
        <span
          className="font-bold tracking-tight"
          style={{ fontSize: size * 0.55, fontFamily: 'Inter, sans-serif' }}
        >
          <span style={{ color: '#00d4ff' }}>Home</span>
          <span style={{ color: '#ffffff' }}>lable</span>
        </span>
      )}
    </div>
  );
}
