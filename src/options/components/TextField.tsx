/**
 * TextField — labeled text input with the immediate-save affordances:
 * optional password visibility toggle, an inline (non-blocking) warning
 * line, a hint line, and the saved ✓. Fully controlled; the section wires
 * onChange/onBlur to the store's debounced persist.
 */
import { useState, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { SavedIndicator } from './SavedIndicator';

export function TextField({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  hint,
  warning,
  password = false,
  multiline = false,
  rows = 4,
  list,
  savedKey,
  'aria-label': ariaLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  hint?: ReactNode;
  /** Non-blocking inline warning (e.g. the sk- prefix heuristic). */
  warning?: string | null;
  password?: boolean;
  multiline?: boolean;
  rows?: number;
  list?: string;
  savedKey?: string;
  'aria-label'?: string;
}) {
  const [visible, setVisible] = useState(false);

  const controlProps = {
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    onBlur,
    placeholder,
    className: password ? 'field-input has-toggle' : 'field-input',
    list,
    'aria-label': ariaLabel ?? label,
    autoComplete: 'off' as const,
    spellCheck: false,
  };

  return (
    <div className="form-group">
      <label className="field-label">
        <span>{label}</span>
        <SavedIndicator savedKey={savedKey} />
      </label>
      {multiline ? (
        <textarea {...controlProps} rows={rows} />
      ) : (
        <div className="field-input-row">
          <input {...controlProps} type={password && !visible ? 'password' : 'text'} />
          {password && (
            <button
              type="button"
              className="icon-btn visibility-toggle"
              onClick={() => setVisible(v => !v)}
              aria-label={visible ? 'hide password' : 'show password'}
              tabIndex={-1}
            >
              {visible ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          )}
        </div>
      )}
      {warning && <p className="field-warning">{warning}</p>}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}
