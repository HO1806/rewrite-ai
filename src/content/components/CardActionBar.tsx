import type { ReplaceOutcome } from '../replace';
import { AdjustIcon, RegenerateIcon, ReplaceIcon } from './icons';

interface CardActionBarProps {
  canAct: boolean;
  isGenerating: boolean;
  isDrawerOpen: boolean;
  adjustCount: number;
  lastOutcome: ReplaceOutcome | null;
  isCopied: boolean;
  onReplace: () => void;
  onToggleDrawer: () => void;
  onRegenerate: () => void;
  onCopy: () => void;
}

export function CardActionBar({
  canAct,
  isGenerating,
  isDrawerOpen,
  adjustCount,
  lastOutcome,
  isCopied,
  onReplace,
  onToggleDrawer,
  onRegenerate,
  onCopy,
}: CardActionBarProps) {
  return (
    <div className="card__actions">
      <div className="card__actions-group">
        <button
          type="button"
          className={`card__button ${
            lastOutcome === 'replaced'
              ? 'card__button--success'
              : 'card__button--primary'
          }`}
          onClick={onReplace}
          disabled={!canAct}
          title="Replace selection (Ctrl+Enter)"
        >
          <ReplaceIcon />
          {/* Reports what actually happened. This button used to show
              "Replaced" even when the text had only reached the clipboard. */}
          <span>{replaceLabel(lastOutcome)}</span>
        </button>

        <button
          type="button"
          className={`card__button ${isDrawerOpen ? 'card__button--active' : ''}`}
          onClick={onToggleDrawer}
          aria-expanded={isDrawerOpen}
          title="Adjust tone, format and length"
        >
          <AdjustIcon />
          <span>Adjust</span>
          {adjustCount > 0 && (
            <span className="card__count">
              {adjustCount}
              <span className="sr-only"> adjustments applied</span>
            </span>
          )}
        </button>

        <button
          type="button"
          className="card__button card__button--icon"
          onClick={onRegenerate}
          disabled={isGenerating}
          aria-label="Regenerate"
          title="Regenerate"
        >
          <RegenerateIcon />
        </button>
      </div>

      <button
        type="button"
        className="card__button"
        onClick={onCopy}
        disabled={!canAct}
      >
        {isCopied ? '✓ Copied' : 'Copy'}
      </button>
    </div>
  );
}

function replaceLabel(outcome: ReplaceOutcome | null): string {
  switch (outcome) {
    case 'replaced':
      return 'Replaced';
    case 'copied':
      return 'Copied instead';
    case 'failed':
      return 'Could not replace';
    default:
      return 'Replace';
  }
}
