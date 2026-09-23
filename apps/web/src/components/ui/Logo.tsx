type LogoProps = {
  size?: number;
  title?: string;
  className?: string;
};

// Site mark. Colour comes from the parent via currentColor.
export function Logo({ size = 24, title, className }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path
        fillRule="evenodd"
        d="M10 4h44a6 6 0 0 1 6 6v44a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6V10a6 6 0 0 1 6-6zM32 10a22 22 0 1 0 0 44 22 22 0 1 0 0-44z"
      />
      <path d="M40 14.1A19 19 0 0 1 40 49.9z" />
      <path d="M36 25.4A6 6 0 1 0 36 32.6z" />
      <path d="M36 37h-7c-5 0-7 3-7 7v6.2a19 19 0 0 0 14 1.3z" />
    </svg>
  );
}
