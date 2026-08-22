interface StreamOutputProps {
  text: string;
  isGenerating: boolean;
  error: string | null;
}

/**
 * The streaming result.
 *
 * **The result area is deliberately not a live region.** It was `aria-live`,
 * which re-announces the whole region on every mutation — and a chunk arrives
 * per token, so a screen reader restarted the entire suggestion from the top
 * dozens of times per rewrite. The announcement is now a single status message
 * when generation finishes, which is the one moment there is something to say.
 * Errors keep `role="alert"`, which is correctly assertive.
 */
export function StreamOutput({ text, isGenerating, error }: StreamOutputProps) {
  return (
    <div className="card__output" aria-busy={isGenerating}>
      {isGenerating && !text && (
        <div className="card__status">
          <div className="card__spinner" aria-hidden="true" />
          <span>Generating suggestion…</span>
        </div>
      )}

      {error ? (
        <div className="card__error" role="alert">
          <strong>Error:</strong> {error}
        </div>
      ) : (
        <span>{text}</span>
      )}

      <span className="sr-only" role="status">
        {!isGenerating && text && !error ? 'Suggestion ready' : ''}
      </span>
    </div>
  );
}
