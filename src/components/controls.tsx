import { useEffect, useState, type ReactNode } from 'react';
import { isValidHex } from '../utils/colors';

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="section">
      <h3 className="section-title">
        <span>{title}</span>
        {action}
      </h3>
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="field-row">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className="slider-value">{format ? format(value) : value}</span>
      </div>
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="checkbox-row">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <select className="select" value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Hex field plus a native colour picker. The text input keeps its own draft
 * state so typing a partial value like "#0" does not repaint the canvas with an
 * invalid colour on every keystroke.
 */
export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [valid, setValid] = useState(true);

  useEffect(() => {
    setDraft(value);
    setValid(true);
  }, [value]);

  const commit = (next: string) => {
    setDraft(next);
    const withHash = next.startsWith('#') ? next : `#${next}`;
    if (isValidHex(withHash)) {
      setValid(true);
      onChange(withHash.toLowerCase());
    } else {
      setValid(false);
    }
  };

  return (
    <div className="color-row">
      <label title={label}>{label}</label>
      <input
        className={`color-hex${valid ? '' : ' invalid'}`}
        value={draft}
        spellCheck={false}
        onChange={(event) => commit(event.target.value)}
        onBlur={() => {
          if (!valid) {
            setDraft(value);
            setValid(true);
          }
        }}
      />
      <span className="swatch" style={{ background: value }}>
        <input
          type="color"
          value={normalizeForPicker(value)}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
        />
      </span>
    </div>
  );
}

/** `<input type="color">` only accepts #rrggbb. */
function normalizeForPicker(value: string): string {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  }
  if (/^#[0-9a-f]{8}$/i.test(value)) return value.slice(0, 7);
  return '#ffffff';
}
