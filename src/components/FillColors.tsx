import { rotateHue } from '../utils/colors';

const MAX = 4;

interface Props {
  label: string;
  colors: string[];
  /** Fewest colours allowed: 0 lets the list fall back to `auto`. */
  min: number;
  /** What an empty list means, shown in its place (e.g. "Accent"). */
  auto?: string;
  /** The colour an empty list stands for, to start from when one is set. */
  fallback?: string;
  onChange: (colors: string[]) => void;
}

/**
 * A text colour that can be one colour or a gradient: one swatch is a solid
 * fill, two to four run left to right across the text.
 */
export function FillColors({ label, colors, min, auto, fallback = '#ffffff', onChange }: Props) {
  const next = colors.length ? colors[colors.length - 1] : fallback;
  // A second colour that differs visibly from the first: its hue turned a third of the way round.
  const gradientEnd = rotateHue(fallback, 120);
  return (
    <div className="field">
      <label>
        {label}
        {colors.length >= 2 ? ' · gradient' : ''}
      </label>
      <div className="thumb-gradient">
        {colors.length >= 2 && (
          <span className="thumb-gradient-bar" style={{ background: `linear-gradient(90deg, ${colors.join(', ')})` }} />
        )}
        <div className="thumb-gradient-stops">
          {colors.length === 0 && auto && <span className="hint" style={{ margin: 0 }}>{auto}</span>}
          {colors.map((hex, index) => (
            <span key={index} className="thumb-stop">
              <span className="swatch" style={{ background: hex }}>
                <input
                  type="color"
                  value={hex}
                  aria-label={`${label} ${index + 1}`}
                  onChange={(event) => onChange(colors.map((c, i) => (i === index ? event.target.value : c)))}
                />
              </span>
              {colors.length > min && (
                <button className="mini-btn" title="Remove" onClick={() => onChange(colors.filter((_, i) => i !== index))}>
                  ✕
                </button>
              )}
            </span>
          ))}
          {colors.length === 0 && (
            <>
              <button className="chip" title="One colour" onClick={() => onChange([fallback])}>
                Colour
              </button>
              <button className="chip" title="Two colours running across the text" onClick={() => onChange([fallback, gradientEnd])}>
                Gradient
              </button>
            </>
          )}
          {colors.length > 0 && colors.length < MAX && (
            <button className="chip" title="Add a colour to the gradient" onClick={() => onChange([...colors, next])}>
              + gradient
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
