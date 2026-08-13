import { getAction } from '@/shared/constants';
import type { RewriteAction } from '@/shared/types';
import { CloseIcon, SparkleIcon } from './icons';

interface CardHeaderProps {
  action: RewriteAction;
  titleId: string;
  onClose: () => void;
}

export function CardHeader({ action, titleId, onClose }: CardHeaderProps) {
  return (
    <div className="card__header">
      <div className="card__heading">
        {/* The leading mark Edge puts before the suggestion. */}
        <span className="card__sparkle">
          <SparkleIcon />
        </span>
        <span className="card__title" id={titleId}>
          {getAction(action).cardTitle}
        </span>
        <span className="card__badge">AI generated</span>
      </div>

      <button
        type="button"
        className="card__button card__button--ghost"
        onClick={onClose}
        aria-label="Close (Escape)"
      >
        <CloseIcon />
      </button>
    </div>
  );
}
