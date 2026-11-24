/**
 * ToggleRow — labeled switch. The checkbox is the real control (keyboard,
 * forms, a11y); the track/knob is its visual skin, focusable via the
 * input's :focus-visible sibling styling.
 */
import type { ReactNode } from 'react';

export function ToggleRow({
  label,
  checked,
  onChange,
  hint,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
  hint?: ReactNode;
}) {
  return (
    <div className="toggle-row">
      <label className="toggle-label">
        <span className="toggle-text">{label}</span>
        <span className="switch">
          <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
          <span className="switch-track" aria-hidden>
            <span className="switch-knob" />
          </span>
        </span>
      </label>
      {hint && <p className="field-hint toggle-hint">{hint}</p>}
    </div>
  );
}
