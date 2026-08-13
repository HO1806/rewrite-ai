import type { CardPosition } from '@/shared/types';
import { SparkleIcon } from './icons';

interface RewriteTriggerProps {
  position: CardPosition;
  /** The live keyboard binding, so a rebind stays truthful. */
  shortcut: string | null;
  onActivate: () => void;
}

/**
 * The inline offer to rewrite, floated beside the selection.
 *
 * `onMouseDown` must both prevent default and stop propagation: without
 * preventDefault the mousedown collapses the very selection we are about to
 * rewrite, and without stopPropagation the host page may treat it as a click
 * away from its own editor.
 */
export function RewriteTrigger({
  position,
  shortcut,
  onActivate,
}: RewriteTriggerProps) {
  return (
    <button
      type="button"
      className="trigger"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={onActivate}
      title={
        shortcut
          ? `Rewrite selected text (${shortcut})`
          : 'Rewrite selected text'
      }
    >
      <span className="trigger__icon">
        <SparkleIcon />
      </span>
      <span>Rewrite</span>
      {shortcut && <span className="trigger__hint">{shortcut}</span>}
    </button>
  );
}
