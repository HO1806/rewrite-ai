/**
 * The floating rewrite card.
 *
 * Two modes behind two tabs, Rewrite and Translate. The adjust drawer that used
 * to sit here — tone, format and length pills — was removed along with the
 * right-click actions it duplicated; the tabs occupy that space now, and are the
 * only way to reach Translate since the shortcut is the sole entry point.
 */

import { useEffect, useId, useRef, useState } from 'react';
import type { RewriteAction, SelectionInfo } from '@/shared/types';
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
import { CardActionBar } from './CardActionBar';
import { CardHeader } from './CardHeader';
import { CardTabs } from './CardTabs';
import { LanguagePicker } from './LanguagePicker';
import { StreamOutput } from './StreamOutput';

const CLOSE_DELAY_MS = 400;
const COPIED_DURATION_MS = 2000;

interface RewriteCardProps {
  selectionInfo: SelectionInfo;
  initialAction: RewriteAction;
  /** The stored translation language, resolved before the card mounts. */
  initialLanguage: string;
  onClose: () => void;
  /**
   * Persists a language chosen from the gear.
   *
   * Returns a promise the card awaits: the worker reads the stored language when
   * building the prompt, so the re-run must not start before the write lands.
   */
  onLanguageChange: (language: string) => Promise<void>;
}

export function RewriteCard({
  selectionInfo,
  initialAction,
  initialLanguage,
  onClose,
  onLanguageChange,
}: RewriteCardProps) {
  const [action, setAction] = useState<RewriteAction>(initialAction);
  const [language, setLanguage] = useState(initialLanguage);
  const [isLanguageOpen, setIsLanguageOpen] = useState(false);
  const [outcome, setOutcome] = useState<ReplaceOutcome | null>(null);
  const [isCopied, flagCopied] = useTimedFlag(COPIED_DURATION_MS);

  const cardRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Held in a ref, not state: the guard has to be read synchronously. */
  const isReplacing = useRef(false);
  /** Focus goes back here when the language picker closes. */
  const gearRef = useRef<HTMLButtonElement>(null);
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
     * Replacement yields to the event loop — an editor that keeps its own
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

  /** Switching tab re-runs the same selection through the other action. */
  const handleSelectTab = (next: RewriteAction) => {
    if (next === action) return;
    setAction(next);
    setIsLanguageOpen(false);
    setOutcome(null);
    start({ action: next, text: selectionInfo.text });
  };

  const handleLanguageChange = async (next: string) => {
    setLanguage(next);
    setIsLanguageOpen(false);
    setOutcome(null);

    /**
     * Awaited, and that is the whole point.
     *
     * The worker reads `translateLanguage` from storage when it builds the
     * prompt, so starting the re-run before the write lands translates into the
     * *previous* language — and pressing Regenerate then appears to "fix" it,
     * which is the shape of a bug nobody reports accurately. The comment here
     * used to claim this waited while the call was fire-and-forget.
     */
    await onLanguageChange(next);

    // The picker has unmounted, taking focus with it; without this, focus falls
    // to the page body outside the shadow root and the card's focus trap has
    // nothing left to trap.
    gearRef.current?.focus();

    start({ action: 'translate', text: selectionInfo.text });
  };

  const handleRegenerate = () => {
    setOutcome(null);
    start({ action, text: selectionInfo.text });
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

      <CardTabs
        action={action}
        language={language}
        onSelect={handleSelectTab}
        onOpenLanguages={() => setIsLanguageOpen((open) => !open)}
        isLanguageOpen={isLanguageOpen}
        gearRef={gearRef}
      />

      {isLanguageOpen && (
        <LanguagePicker
          language={language}
          onChange={(next) => void handleLanguageChange(next)}
        />
      )}

      <StreamOutput text={text} isGenerating={isGenerating} error={error} />

      <CardActionBar
        canAct={canAct}
        isGenerating={isGenerating}
        lastOutcome={outcome}
        isCopied={isCopied}
        onReplace={() => void handleReplace()}
        onRegenerate={handleRegenerate}
        onCopy={() => void handleCopy()}
      />
    </div>
  );
}
