type Props = { size?: number; className?: string; label?: string };

// Warning triangle drawn in currentColor
export function WarningIcon({ size = 16, className, label }: Props) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d="M8 1.5L15 14H1L8 1.5z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8 6v3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11.8" r="0.95" fill="currentColor" />
    </svg>
  );
}
