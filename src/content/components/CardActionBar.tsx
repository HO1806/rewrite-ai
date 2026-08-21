import type { ReplaceOutcome } from '../replace';
import { RegenerateIcon, ReplaceIcon } from './icons';

interface CardActionBarProps {
  canAct: boolean;
  isGenerating: boolean;
  lastOutcome: ReplaceOutcome | null;
  isCopied: boolean;
  onReplace: () => void;
  onRegenerate: () => void;
  onCopy: () => void;
}

export function CardActionBar({
  canAct,
  isGenerating,
  lastOutcome,
  isCopied,
  onReplace,
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
        title="Copy the suggestion"
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
    case 'unchanged':
      return 'No change needed';
    case 'copied':
      return 'Copied instead';
    // The page was modified but not verifiably substituted, so saying "Copied
    // instead" would imply the field was left untouched when it was not.
    case 'copied-dirty':
      return 'Copied — check the field';
    case 'failed':
      return 'Could not replace';
    default:
      return 'Replace';
  }
}
