type BrandLogoProps = {
  size?: "nav" | "compact";
  className?: string;
};

function NailIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 54 150" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="quietGold" x1="8" y1="0" x2="46" y2="150" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ead39a" />
          <stop offset="0.42" stopColor="#c69a52" />
          <stop offset="1" stopColor="#8f6935" />
        </linearGradient>
      </defs>

      <ellipse cx="27" cy="17" rx="20" ry="5.5" fill="#d6b26b" />
      <ellipse cx="27" cy="15" rx="16" ry="3.8" fill="#f1ddb1" opacity="0.75" />

      <path
        d="M17 18 C22 42 23.5 78 24.5 121 L27 145 L29.5 121 C30.5 78 32 42 37 18 Z"
        fill="url(#quietGold)"
      />

      <path
        d="M26.2 28 C25.8 60 25.9 94 26.5 124"
        stroke="#fff1c8"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.25"
      />
    </svg>
  );
}

export function BrandLogo({
  size = "nav",
  className = "",
}: BrandLogoProps) {
  const compact = size === "compact";

  return (
    <div className={`select-none ${className}`}>
      <div className="flex items-center gap-[0.14em]">
        <span
          className={`brand-logo-word leading-none text-[#f4efe6] ${
            compact ? "text-2xl" : "text-3xl"
          }`}
        >
          NAILI
        </span>
        <NailIcon
          className={`translate-y-[0.02em] ${
            compact ? "h-8 w-3.5" : "h-10 w-4"
          }`}
        />
      </div>
    </div>
  );
}
