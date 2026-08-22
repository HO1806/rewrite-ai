/**
 * The bolt on the popup and options headers.
 *
 * Was a bare `⚡`, whose weight, baseline and colour are decided by whichever
 * emoji font the platform ships — on the accent tile it sat low and kept its own
 * palette. Filled rather than stroked: at 1.75rem a hairline outline disappears
 * against the gradient behind it.
 */
export function AppMark({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden={true}
      focusable={false}
    >
      <path d="M13 2 3 14h8l-1 8 10-12h-8z" />
    </svg>
  );
}
