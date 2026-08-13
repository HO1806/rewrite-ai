import type { SaveState } from './hooks/useSettings';

/**
 * Save confirmation.
 *
 * `role="status"` so the confirmation is announced — previously it was a plain
 * span, invisible to assistive tech, with a fadeIn animation that referenced a
 * keyframe defined only in an unimported stylesheet and so never played.
 */
export function SaveStatus({ state }: { state: SaveState }) {
  if (state.status === 'idle') return null;

  const isError = state.status === 'error';

  return (
    <span
      className={`status ${isError ? 'status--error' : 'status--success'}`}
      role="status"
      aria-live="polite"
    >
      {isError ? state.message : 'Saved'}
    </span>
  );
}
