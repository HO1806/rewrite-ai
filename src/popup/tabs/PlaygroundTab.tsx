/**
 * A scratchpad for checking that the configured provider actually works.
 *
 * Uses the shared streaming hook, so it no longer leaks a port on every run —
 * its hand-rolled copy of the protocol kept no reference to the port and never
 * disconnected, letting two runs interleave into one string.
 */

import { useState } from 'react';
import { ACTIONS } from '@/shared/constants';
import type { RewriteAction } from '@/shared/types';
import { useStreamingRewrite } from '@/ui/hooks/useStreamingRewrite';

const SAMPLE = 'their going to the meating tomorow to discus the new projekt';

export function PlaygroundTab() {
  const [input, setInput] = useState(SAMPLE);
  const [action, setAction] = useState<RewriteAction>('improve');
  const { text, isGenerating, error, start } = useStreamingRewrite();

  const canRun = input.trim().length > 0 && !isGenerating;

  return (
    <div className="tabpanel">
      <div className="field">
        <label className="field__label" htmlFor="playground-action">
          Action
        </label>
        <select
          id="playground-action"
          className="select"
          value={action}
          onChange={(event) => setAction(event.target.value as RewriteAction)}
        >
          {ACTIONS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="playground-input">
          Text
        </label>
        <textarea
          id="playground-input"
          className="textarea"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
      </div>

      <button
        type="button"
        className="button button--primary"
        disabled={!canRun}
        onClick={() => start({ action, text: input })}
      >
        {isGenerating ? (
          <>
            <span className="spinner" aria-hidden="true" />
            Generating…
          </>
        ) : (
          'Run'
        )}
      </button>

      <div className="field">
        <span className="field__label">Result</span>
        <div className="output" aria-live="polite" aria-busy={isGenerating}>
          {error ? (
            <span className="field__error" role="alert">
              {error}
            </span>
          ) : text ? (
            <span>{text}</span>
          ) : (
            <span className="output--placeholder">
              The result will stream here.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
