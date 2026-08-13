/**
 * Card icons.
 *
 * Feather-style stroke geometry, marked aria-hidden — every one of these sits
 * next to a text label or an aria-label on the button itself.
 */

interface IconProps {
  size?: number;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor' as const,
  'aria-hidden': true,
  focusable: false as const,
});

export function ReplaceIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2.5}>
      <polyline points="9 10 4 15 9 20" />
      <path d="M20 4v7a4 4 0 0 1-4 4H4" />
    </svg>
  );
}

export function AdjustIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2}>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}

export function RegenerateIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  );
}

/** The leading mark on the card header and the trigger, as Edge has. */
export function SparkleIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={1.6}>
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />
      <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </svg>
  );
}

export function ToneIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2}>
      <path d="M12 3v10" />
      <path d="M9 13a3 3 0 1 0 6 0" />
      <path d="M5 11v1a7 7 0 0 0 14 0v-1" />
      <path d="M12 19v2" />
    </svg>
  );
}

export function FormatIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2}>
      <path d="M5 5h14" />
      <path d="M5 10h14" />
      <path d="M5 15h9" />
      <path d="M5 20h5" />
    </svg>
  );
}

export function LengthIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2}>
      <path d="M4 12h16" />
      <path d="M4 8v8" />
      <path d="M20 8v8" />
    </svg>
  );
}

export function CloseIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2}>
      <line x1="5" y1="5" x2="19" y2="19" />
      <line x1="19" y1="5" x2="5" y2="19" />
    </svg>
  );
}
