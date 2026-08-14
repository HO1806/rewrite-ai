/**
 * The floating rewrite card.
 *
 * Visual direction follows Microsoft Edge's Rewrite panel. This file was 585
 * lines with about half of it JSX and a quarter inline style declarations; the
 * markup now lives in focused child components and the styling in card.css.
 */

import { useEffect, useId, useRef, useState } from 'react';
import type {
  AdjustParams,
  RewriteAction,
  SelectionInfo,
} from '@/shared/types';
import { useStreamingRewrite } from '@/ui/hooks/useStreamingRewrite';
import { useTimedFlag } from '@/ui/hooks/useTimedFlag';
import {
  ReplaceOutcome,
  copyToClipboard,
  replaceSelectedText,
} from '../replace';
import { useAnchoredPosition } from '../hooks/useAnchoredPosition';
import {
  useCardKeyboard,
  useDismissOnOutsidePointer,
} from '../hooks/useCardKeyboard';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { AdjustDrawer } from './AdjustDrawer';
import { countAdjustments } from './adjustCategories';
import { CardActionBar } from './CardActionBar';
import { CardHeader } from './CardHeader';
import { StreamOutput } from './StreamOutput';

const CLOSE_DELAY_MS = 400;
const COPIED_DURATION_MS = 2000;

interface RewriteCardProps {
  selectionInfo: SelectionInfo;
  initialAction: RewriteAction;
  onClose: () => void;
}

export function RewriteCard({
  selectionInfo,
  initialAction,
  onClose,
}: RewriteCardProps) {
  const [action] = useState<RewriteAction>(initialAction);
  const [adjustParams, setAdjustParams] = useState<AdjustParams>({});
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [outcome, setOutcome] = useState<ReplaceOutcome | null>(null);
  const [isCopied, flagCopied] = useTimedFlag(COPIED_DURATION_MS);

  const cardRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Held in a ref, not state: the guard has to be read synchronously. */
  const isReplacing = useRef(false);
  const titleId = useId();

  const { text, isGenerating, error, start } = useStreamingRewrite();
  const position = useAnchoredPosition(selectionInfo, cardRef);

  // Kick off the initial rewrite. `start` is stable, so this runs once.
  useEffect(() => {
    start({ action: initialAction, text: selectionInfo.text });
  }, [start, initialAction, selectionInfo.text]);

  useEffect(
    () => () => {
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    },
    [],
  );

  /**
   * Gated on `!error` as well: the output area shows the error *instead of* any
   * text already streamed, so leaving Replace and Copy enabled offered to act on
   * text the user could no longer see.
   */
  const canAct = Boolean(text) && !isGenerating && !error;

  const handleReplace = async () => {
    /**
     * Replacement now yields to the event loop — an editor that keeps its own
     * selection has to observe ours before the edit is offered — so a second
     * click can land mid-flight and insert the text twice.
     */
    if (!text || isReplacing.current) return;
    isReplacing.current = true;

    try {
      const result = await replaceSelectedText(selectionInfo, text);
      setOutcome(result);

      // Only auto-dismiss when there is nothing left for the user to do. A
      // clipboard fallback has to stay on screen so they can see it and paste.
      if (result === 'replaced' || result === 'unchanged') {
        closeTimer.current = setTimeout(onClose, CLOSE_DELAY_MS);
      }
    } finally {
      isReplacing.current = false;
    }
  };

  const handleCopy = async () => {
    if (!text) return;
    // Uses the hardened helper rather than a bare navigator.clipboard call,
    // which rejects unhandled when the document is not focused.
    if (await copyToClipboard(text)) flagCopied();
  };

  const handleAdjust = (next: AdjustParams) => {
    setAdjustParams(next);
    setOutcome(null);
    start({ action, text: selectionInfo.text, adjustParams: next });
  };

  const handleRegenerate = () => {
    setOutcome(null);
    start({ action, text: selectionInfo.text, adjustParams: adjustParams });
  };

  useCardKeyboard({
    onDismiss: onClose,
    onConfirm: () => void handleReplace(),
    canConfirm: canAct,
  });
  useDismissOnOutsidePointer(cardRef, onClose);
  useFocusTrap(cardRef);

  return (
    <div
      ref={cardRef}
      className="card"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <CardHeader action={action} titleId={titleId} onClose={onClose} />

      <StreamOutput text={text} isGenerating={isGenerating} error={error} />

      {isDrawerOpen && (
        <AdjustDrawer
          params={adjustParams}
          isDisabled={isGenerating}
          onChange={handleAdjust}
        />
      )}

      <CardActionBar
        canAct={canAct}
        isGenerating={isGenerating}
        isDrawerOpen={isDrawerOpen}
        adjustCount={countAdjustments(adjustParams)}
        lastOutcome={outcome}
        isCopied={isCopied}
        onReplace={() => void handleReplace()}
        onToggleDrawer={() => setIsDrawerOpen((open) => !open)}
        onRegenerate={handleRegenerate}
        onCopy={() => void handleCopy()}
      />
    </div>
  );
}
