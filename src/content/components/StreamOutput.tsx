interface StreamOutputProps {
  text: string;
  isGenerating: boolean;
  error: string | null;
}

/**
 * The streaming result.
 *
 * `aria-live="polite"` plus `aria-busy` is what makes the generation audible to
 * a screen reader — previously text streamed in with no announcement at all, and
 * errors were rendered as ordinary text rather than an alert.
 */
export function StreamOutput({ text, isGenerating, error }: StreamOutputProps) {
  return (
    <div className="card__output" aria-live="polite" aria-busy={isGenerating}>
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
    </div>
  );
}
