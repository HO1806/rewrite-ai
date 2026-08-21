import { TRANSLATE_LANGUAGES } from '@/shared/constants';

interface LanguagePickerProps {
  language: string;
  onChange: (language: string) => void;
}

/**
 * The dropdown behind the gear on the Translate tab.
 *
 * A native `<select>` on purpose: it is the one control that renders its own
 * popup above everything, which matters inside a card that is already clamped to
 * the viewport and cannot afford to grow a scrolling list of its own.
 */
export function LanguagePicker({ language, onChange }: LanguagePickerProps) {
  // A language set before this list existed, or typed elsewhere, must not vanish
  // from the picker just because it is not one of the twelve.
  const options = TRANSLATE_LANGUAGES.includes(language)
    ? TRANSLATE_LANGUAGES
    : [language, ...TRANSLATE_LANGUAGES];

  return (
    <div className="card__languages">
      <label className="card__languages-label" htmlFor="rewrite-ai-language">
        Translate into
      </label>
      <select
        id="rewrite-ai-language"
        className="card__select"
        value={language}
        autoFocus
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}
