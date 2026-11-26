import type { InstrumentFamily } from '../models/MidiProject';

/**
 * A library of small monochrome glyphs, drawn straight to canvas so they survive
 * export at any resolution.
 *
 * Every icon draws inside a `size × size` box anchored at (x, y) using the
 * current strokeStyle and lineWidth. They are stroke-only and built from as few
 * segments as possible — at 13px on screen, detail turns to mud.
 */

export type IconName =
  // Keys
  | 'piano'
  | 'keyboard'
  | 'organ'
  | 'accordion'
  | 'harmonica'
  // Strings
  | 'guitar'
  | 'banjo'
  | 'violin'
  | 'cello'
  | 'bass'
  | 'harp'
  // Wind and brass
  | 'brass'
  | 'trumpet'
  | 'sax'
  | 'flute'
  | 'panflute'
  | 'reed'
  // Percussion
  | 'drums'
  | 'snare'
  | 'hihat'
  | 'cymbal'
  | 'timpani'
  | 'conga'
  | 'tambourine'
  | 'maracas'
  | 'xylophone'
  | 'bell'
  | 'gong'
  // Voice and sound
  | 'voice'
  | 'choir'
  | 'mic'
  | 'headphones'
  | 'speaker'
  // Synth and waveforms
  | 'sine'
  | 'square'
  | 'saw'
  | 'tri'
  | 'pulse'
  | 'noise'
  | 'envelope'
  | 'knob'
  | 'pad'
  | 'steps'
  | 'bolt'
  // Atmosphere
  | 'cloud'
  | 'sparkle'
  | 'drop'
  | 'waves'
  | 'moon'
  | 'sun'
  | 'planet'
  // Notation
  | 'note'
  | 'notes'
  | 'treble'
  | 'bassClef'
  | 'metronome'
  | 'vinyl'
  // Geometric
  | 'circle'
  | 'ring'
  | 'box'
  | 'triangle'
  | 'diamond'
  | 'hexagon'
  | 'star'
  | 'cross'
  // Studio (the instruments a DAW like Logic gives its tracks)
  | 'epiano'
  | 'electricGuitar'
  | 'electricBass'
  | 'ukulele'
  | 'mandolin'
  | 'sitar'
  | 'stringSection'
  | 'trombone'
  | 'frenchHorn'
  | 'tuba'
  | 'clarinet'
  | 'bagpipes'
  | 'drumMachine'
  | 'sampler'
  | 'kick'
  | 'cowbell'
  | 'shaker'
  | 'marimba'
  | 'steelDrum'
  | 'modular'
  | 'amp'
  | 'turntable'
  | 'loop'
  // Minimal
  | 'dot'
  | 'dots'
  | 'bars'
  | 'line'
  | 'blank';

type IconFn = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number) => void;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function stroke(ctx: CanvasRenderingContext2D, build: () => void): void {
  ctx.beginPath();
  build();
  ctx.stroke();
}

function polygon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotation = -Math.PI / 2,
): void {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = rotation + (i * Math.PI * 2) / sides;
    const px = cx + Math.cos(angle) * radius;
    const py = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  stroke(ctx, () => {
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  });
}

/** Traces `f(t)` across the box, where t and the result are both 0..1. */
function curve(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  steps: number,
  f: (t: number) => number,
): void {
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = x + t * s;
    const py = y + s * f(t);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Keys and strings
// ---------------------------------------------------------------------------

const piano: IconFn = (ctx, x, y, s) => {
  const h = s * 0.6;
  const top = y + (s - h) / 2;
  ctx.strokeRect(x + s * 0.04, top, s * 0.92, h);
  for (let i = 1; i < 4; i++) {
    const kx = x + s * 0.04 + (s * 0.92 * i) / 4;
    stroke(ctx, () => {
      ctx.moveTo(kx, top);
      ctx.lineTo(kx, top + h * 0.62);
    });
  }
};

const organ: IconFn = (ctx, x, y, s) => {
  for (let i = 0; i < 4; i++) {
    const px = x + s * (0.14 + i * 0.24);
    const top = y + s * (0.12 + (i % 2) * 0.2);
    stroke(ctx, () => {
      ctx.moveTo(px, top);
      ctx.lineTo(px, y + s * 0.9);
    });
  }
};

const guitar: IconFn = (ctx, x, y, s) => {
  const cx = x + s * 0.5;
  stroke(ctx, () => {
    ctx.moveTo(cx, y + s * 0.02);
    ctx.lineTo(cx, y + s * 0.42);
  });
  stroke(ctx, () => ctx.ellipse(cx, y + s * 0.68, s * 0.34, s * 0.28, 0, 0, Math.PI * 2));
  stroke(ctx, () => ctx.arc(cx, y + s * 0.62, s * 0.09, 0, Math.PI * 2));
};

/** Shared string-instrument silhouette; `neck` sets how much is fingerboard. */
function stringed(neck: number): IconFn {
  return (ctx, x, y, s) => {
    const cx = x + s * 0.5;
    const top = y + s * neck;
    const bottom = y + s;
    const h = bottom - top;
    const w = s * 0.3;

    // Fingerboard.
    stroke(ctx, () => {
      ctx.moveTo(cx, y + s * 0.02);
      ctx.lineTo(cx, top);
    });

    // One waisted outline: upper bout, waist, lower bout, then mirrored. Two
    // separate ellipses read as a lollipop once enlarged to watermark size.
    stroke(ctx, () => {
      ctx.moveTo(cx, top);
      ctx.bezierCurveTo(cx - w, top + h * 0.04, cx - w * 0.98, top + h * 0.3, cx - w * 0.56, top + h * 0.5);
      ctx.bezierCurveTo(cx - w * 1.2, top + h * 0.72, cx - w * 1.1, bottom, cx, bottom);
      ctx.bezierCurveTo(cx + w * 1.1, bottom, cx + w * 1.2, top + h * 0.72, cx + w * 0.56, top + h * 0.5);
      ctx.bezierCurveTo(cx + w * 0.98, top + h * 0.3, cx + w, top + h * 0.04, cx, top);
    });
  };
}

const bass: IconFn = (ctx, x, y, s) => {
  stringed(0.22)(ctx, x, y, s);
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.5, y + s * 0.05);
    ctx.lineTo(x + s * 0.74, y + s * 0.05);
  });
};

const harp: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.12, y + s * 0.94);
    ctx.lineTo(x + s * 0.12, y + s * 0.1);
    ctx.quadraticCurveTo(x + s * 0.92, y + s * 0.16, x + s * 0.86, y + s * 0.94);
  });
  for (let i = 1; i < 4; i++) {
    const px = x + s * (0.12 + i * 0.2);
    stroke(ctx, () => {
      ctx.moveTo(px, y + s * (0.14 + i * 0.06));
      ctx.lineTo(px, y + s * 0.94);
    });
  }
};

// ---------------------------------------------------------------------------
// Wind and brass
// ---------------------------------------------------------------------------

const brass: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => ctx.arc(x + s * 0.36, y + s * 0.5, s * 0.3, Math.PI * 0.35, Math.PI * 1.9));
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.6, y + s * 0.72);
    ctx.lineTo(x + s * 0.96, y + s * 0.9);
    ctx.lineTo(x + s * 0.96, y + s * 0.34);
    ctx.lineTo(x + s * 0.64, y + s * 0.54);
  });
};

const trumpet: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.04, y + s * 0.5);
    ctx.lineTo(x + s * 0.66, y + s * 0.5);
    ctx.lineTo(x + s * 0.96, y + s * 0.24);
    ctx.lineTo(x + s * 0.96, y + s * 0.76);
    ctx.lineTo(x + s * 0.66, y + s * 0.5);
  });
  for (let i = 0; i < 3; i++) {
    const px = x + s * (0.24 + i * 0.14);
    stroke(ctx, () => {
      ctx.moveTo(px, y + s * 0.5);
      ctx.lineTo(px, y + s * 0.28);
    });
  }
};

const flute: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.04, y + s * 0.5);
    ctx.lineTo(x + s * 0.96, y + s * 0.5);
  });
  for (let i = 0; i < 4; i++) {
    stroke(ctx, () => ctx.arc(x + s * (0.28 + i * 0.18), y + s * 0.5, s * 0.07, 0, Math.PI * 2));
  }
};

const reed: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.2, y + s * 0.04);
    ctx.lineTo(x + s * 0.2, y + s * 0.76);
    ctx.quadraticCurveTo(x + s * 0.2, y + s * 0.96, x + s * 0.5, y + s * 0.96);
  });
  for (let i = 0; i < 3; i++) {
    stroke(ctx, () => ctx.arc(x + s * 0.2, y + s * (0.28 + i * 0.18), s * 0.07, 0, Math.PI * 2));
  }
};

// ---------------------------------------------------------------------------
// Percussion
// ---------------------------------------------------------------------------

const drums: IconFn = (ctx, x, y, s) => {
  const cx = x + s * 0.5;
  const cy = y + s * 0.62;
  const r = s * 0.32;
  stroke(ctx, () => ctx.arc(cx, cy, r, 0, Math.PI * 2));
  stroke(ctx, () => ctx.arc(cx, cy, r * 0.32, 0, Math.PI * 2));
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.06, y + s * 0.1);
    ctx.lineTo(x + s * 0.4, y + s * 0.42);
    ctx.moveTo(x + s * 0.94, y + s * 0.1);
    ctx.lineTo(x + s * 0.6, y + s * 0.42);
  });
};

const snare: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => ctx.ellipse(x + s * 0.5, y + s * 0.28, s * 0.42, s * 0.14, 0, 0, Math.PI * 2));
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.08, y + s * 0.28);
    ctx.lineTo(x + s * 0.08, y + s * 0.72);
    ctx.moveTo(x + s * 0.92, y + s * 0.28);
    ctx.lineTo(x + s * 0.92, y + s * 0.72);
  });
  stroke(ctx, () => ctx.ellipse(x + s * 0.5, y + s * 0.72, s * 0.42, s * 0.14, 0, 0, Math.PI));
};

const cymbal: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => ctx.ellipse(x + s * 0.5, y + s * 0.42, s * 0.46, s * 0.12, 0, 0, Math.PI * 2));
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.5, y + s * 0.42);
    ctx.lineTo(x + s * 0.5, y + s * 0.94);
  });
};

const timpani: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => ctx.ellipse(x + s * 0.5, y + s * 0.3, s * 0.44, s * 0.14, 0, 0, Math.PI * 2));
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.06, y + s * 0.3);
    ctx.lineTo(x + s * 0.22, y + s * 0.92);
    ctx.lineTo(x + s * 0.78, y + s * 0.92);
    ctx.lineTo(x + s * 0.94, y + s * 0.3);
  });
};

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

const voice: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => ctx.arc(x + s * 0.5, y + s * 0.28, s * 0.2, 0, Math.PI * 2));
  stroke(ctx, () => ctx.arc(x + s * 0.5, y + s * 1.0, s * 0.42, Math.PI * 1.17, Math.PI * 1.83));
};

const choir: IconFn = (ctx, x, y, s) => {
  voice(ctx, x - s * 0.1, y + s * 0.1, s * 0.74);
  voice(ctx, x + s * 0.36, y + s * 0.1, s * 0.74);
};

const mic: IconFn = (ctx, x, y, s) => {
  const cx = x + s * 0.5;
  stroke(ctx, () => {
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(cx - s * 0.16, y + s * 0.06, s * 0.32, s * 0.46, s * 0.16);
    } else {
      ctx.rect(cx - s * 0.16, y + s * 0.06, s * 0.32, s * 0.46);
    }
  });
  stroke(ctx, () => ctx.arc(cx, y + s * 0.5, s * 0.3, 0, Math.PI));
  stroke(ctx, () => {
    ctx.moveTo(cx, y + s * 0.8);
    ctx.lineTo(cx, y + s * 0.96);
  });
};

// ---------------------------------------------------------------------------
// Waveforms
// ---------------------------------------------------------------------------

const sine: IconFn = (ctx, x, y, s) =>
  curve(ctx, x, y, s, 22, (t) => 0.5 - Math.sin(t * Math.PI * 2) * 0.34);

const squareWave: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => {
    ctx.moveTo(x, y + s * 0.72);
    ctx.lineTo(x + s * 0.2, y + s * 0.72);
    ctx.lineTo(x + s * 0.2, y + s * 0.28);
    ctx.lineTo(x + s * 0.6, y + s * 0.28);
    ctx.lineTo(x + s * 0.6, y + s * 0.72);
    ctx.lineTo(x + s, y + s * 0.72);
  });
};

const saw: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => {
    ctx.moveTo(x, y + s * 0.74);
    ctx.lineTo(x + s * 0.44, y + s * 0.26);
    ctx.lineTo(x + s * 0.44, y + s * 0.74);
    ctx.lineTo(x + s * 0.9, y + s * 0.26);
    ctx.lineTo(x + s * 0.9, y + s * 0.74);
  });
};

const pulse: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => {
    ctx.moveTo(x, y + s * 0.7);
    ctx.lineTo(x + s * 0.32, y + s * 0.7);
    ctx.lineTo(x + s * 0.32, y + s * 0.24);
    ctx.lineTo(x + s * 0.46, y + s * 0.24);
    ctx.lineTo(x + s * 0.46, y + s * 0.7);
    ctx.lineTo(x + s, y + s * 0.7);
  });
};

const pad: IconFn = (ctx, x, y, s) => {
  curve(ctx, x, y, s, 22, (t) => 0.52 - Math.sin(t * Math.PI) * 0.32);
  stroke(ctx, () => {
    ctx.moveTo(x, y + s * 0.84);
    ctx.lineTo(x + s, y + s * 0.84);
  });
};

const steps: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => {
    for (let i = 0; i < 4; i++) {
      const px = x + (i * s) / 4;
      const py = y + s * (0.84 - i * 0.19);
      ctx.moveTo(px, py);
      ctx.lineTo(px + s / 4, py);
    }
  });
};

// ---------------------------------------------------------------------------
// Geometric and minimal
// ---------------------------------------------------------------------------

const circle: IconFn = (ctx, x, y, s) => {
  ctx.beginPath();
  ctx.arc(x + s * 0.5, y + s * 0.5, s * 0.34, 0, Math.PI * 2);
  ctx.fill();
};

const ring: IconFn = (ctx, x, y, s) =>
  stroke(ctx, () => ctx.arc(x + s * 0.5, y + s * 0.5, s * 0.34, 0, Math.PI * 2));

const box: IconFn = (ctx, x, y, s) => ctx.strokeRect(x + s * 0.16, y + s * 0.16, s * 0.68, s * 0.68);

const triangle: IconFn = (ctx, x, y, s) => polygon(ctx, x + s * 0.5, y + s * 0.54, s * 0.4, 3);
const diamond: IconFn = (ctx, x, y, s) => polygon(ctx, x + s * 0.5, y + s * 0.5, s * 0.42, 4);
const hexagon: IconFn = (ctx, x, y, s) => polygon(ctx, x + s * 0.5, y + s * 0.5, s * 0.4, 6, 0);

const star: IconFn = (ctx, x, y, s) => {
  const cx = x + s * 0.5;
  const cy = y + s * 0.52;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? s * 0.42 : s * 0.18;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
};

const cross: IconFn = (ctx, x, y, s) =>
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.5, y + s * 0.12);
    ctx.lineTo(x + s * 0.5, y + s * 0.88);
    ctx.moveTo(x + s * 0.12, y + s * 0.5);
    ctx.lineTo(x + s * 0.88, y + s * 0.5);
  });

const dot: IconFn = (ctx, x, y, s) => {
  ctx.beginPath();
  ctx.arc(x + s * 0.5, y + s * 0.5, s * 0.18, 0, Math.PI * 2);
  ctx.fill();
};

const dots: IconFn = (ctx, x, y, s) => {
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(x + s * (0.18 + i * 0.32), y + s * 0.5, s * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }
};

const bars: IconFn = (ctx, x, y, s) => {
  const heights = [0.4, 0.72, 0.54, 0.88];
  for (let i = 0; i < heights.length; i++) {
    const px = x + s * (0.14 + i * 0.24);
    stroke(ctx, () => {
      ctx.moveTo(px, y + s * 0.92);
      ctx.lineTo(px, y + s * (0.92 - heights[i]));
    });
  }
};

const line: IconFn = (ctx, x, y, s) =>
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.08, y + s * 0.5);
    ctx.lineTo(x + s * 0.92, y + s * 0.5);
  });

const musicNote: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.42, y + s * 0.76);
    ctx.lineTo(x + s * 0.42, y + s * 0.1);
    ctx.lineTo(x + s * 0.86, y + s * 0.22);
    ctx.lineTo(x + s * 0.86, y + s * 0.4);
  });
  ctx.beginPath();
  ctx.ellipse(x + s * 0.28, y + s * 0.78, s * 0.17, s * 0.13, -0.3, 0, Math.PI * 2);
  ctx.fill();
};

const blank: IconFn = () => undefined;

// ---------------------------------------------------------------------------
// More keys and strings
// ---------------------------------------------------------------------------

/** Synth: a panel of knobs over a strip of keys. */
const keyboard: IconFn = (ctx, x, y, s) => {
  const left = x + s * 0.04;
  const width = s * 0.92;
  ctx.strokeRect(left, y + s * 0.22, width, s * 0.56);
  stroke(ctx, () => {
    ctx.moveTo(left, y + s * 0.48);
    ctx.lineTo(left + width, y + s * 0.48);
  });
  for (let i = 0; i < 3; i++) {
    stroke(ctx, () => ctx.arc(x + s * (0.2 + i * 0.16), y + s * 0.35, s * 0.045, 0, Math.PI * 2));
  }
  for (let i = 1; i < 6; i++) {
    const kx = left + (width * i) / 6;
    stroke(ctx, () => {
      ctx.moveTo(kx, y + s * 0.48);
      ctx.lineTo(kx, y + s * 0.78);
    });
  }
};

const accordion: IconFn = (ctx, x, y, s) => {
  ctx.strokeRect(x + s * 0.06, y + s * 0.2, s * 0.16, s * 0.6);
  ctx.strokeRect(x + s * 0.78, y + s * 0.2, s * 0.16, s * 0.6);
  // Bellows: a zigzag top and bottom with a fold line at every corner.
  const folds = 6;
  const fold = (i: number) => x + s * (0.22 + (0.56 * i) / folds);
  const inset = (i: number) => (i % 2 ? s * 0.07 : 0);
  stroke(ctx, () => {
    for (let i = 0; i <= folds; i++) {
      if (i === 0) ctx.moveTo(fold(i), y + s * 0.2 + inset(i));
      else ctx.lineTo(fold(i), y + s * 0.2 + inset(i));
    }
    for (let i = 0; i <= folds; i++) {
      if (i === 0) ctx.moveTo(fold(i), y + s * 0.8 - inset(i));
      else ctx.lineTo(fold(i), y + s * 0.8 - inset(i));
    }
    for (let i = 1; i < folds; i++) {
      ctx.moveTo(fold(i), y + s * 0.2 + inset(i));
      ctx.lineTo(fold(i), y + s * 0.8 - inset(i));
    }
  });
};

const harmonica: IconFn = (ctx, x, y, s) => {
  roundedRect(ctx, x + s * 0.06, y + s * 0.32, s * 0.88, s * 0.36, s * 0.06);
  for (let i = 0; i < 5; i++) {
    ctx.strokeRect(x + s * (0.15 + i * 0.15), y + s * 0.45, s * 0.08, s * 0.1);
  }
};

const banjo: IconFn = (ctx, x, y, s) => {
  const cx = x + s * 0.5;
  stroke(ctx, () => ctx.arc(cx, y + s * 0.7, s * 0.26, 0, Math.PI * 2));
  stroke(ctx, () => ctx.arc(cx, y + s * 0.7, s * 0.17, 0, Math.PI * 2));
  stroke(ctx, () => {
    ctx.moveTo(cx, y + s * 0.44);
    ctx.lineTo(cx, y + s * 0.06);
    ctx.moveTo(cx - s * 0.08, y + s * 0.08);
    ctx.lineTo(cx + s * 0.08, y + s * 0.04);
  });
};

// ---------------------------------------------------------------------------
// More wind and brass
// ---------------------------------------------------------------------------

const sax: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.3, y + s * 0.04);
    ctx.lineTo(x + s * 0.42, y + s * 0.14);
    ctx.lineTo(x + s * 0.42, y + s * 0.66);
    ctx.quadraticCurveTo(x + s * 0.42, y + s * 0.94, x + s * 0.62, y + s * 0.94);
    ctx.quadraticCurveTo(x + s * 0.8, y + s * 0.94, x + s * 0.8, y + s * 0.6);
    // Flared bell.
    ctx.lineTo(x + s * 0.72, y + s * 0.5);
    ctx.lineTo(x + s * 0.94, y + s * 0.5);
    ctx.lineTo(x + s * 0.86, y + s * 0.6);
  });
  for (let i = 0; i < 3; i++) {
    stroke(ctx, () => ctx.arc(x + s * 0.53, y + s * (0.3 + i * 0.13), s * 0.04, 0, Math.PI * 2));
  }
};

const panflute: IconFn = (ctx, x, y, s) => {
  for (let i = 0; i < 5; i++) {
    const px = x + s * (0.14 + i * 0.18);
    stroke(ctx, () => {
      ctx.moveTo(px, y + s * 0.1);
      ctx.lineTo(px, y + s * (0.9 - i * 0.12));
    });
  }
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.06, y + s * 0.3);
    ctx.lineTo(x + s * 0.94, y + s * 0.3);
  });
};

// ---------------------------------------------------------------------------
// More percussion
// ---------------------------------------------------------------------------

const hihat: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => ctx.ellipse(x + s * 0.5, y + s * 0.24, s * 0.42, s * 0.08, 0, 0, Math.PI * 2));
  stroke(ctx, () => ctx.ellipse(x + s * 0.5, y + s * 0.38, s * 0.42, s * 0.08, 0, 0, Math.PI * 2));
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.5, y + s * 0.46);
    ctx.lineTo(x + s * 0.5, y + s * 0.84);
    ctx.lineTo(x + s * 0.28, y + s * 0.96);
    ctx.moveTo(x + s * 0.5, y + s * 0.84);
    ctx.lineTo(x + s * 0.72, y + s * 0.96);
  });
};

const conga: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => ctx.ellipse(x + s * 0.5, y + s * 0.14, s * 0.22, s * 0.07, 0, 0, Math.PI * 2));
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.28, y + s * 0.14);
    ctx.bezierCurveTo(x + s * 0.18, y + s * 0.42, x + s * 0.2, y + s * 0.7, x + s * 0.34, y + s * 0.94);
    ctx.lineTo(x + s * 0.66, y + s * 0.94);
    ctx.bezierCurveTo(x + s * 0.8, y + s * 0.7, x + s * 0.82, y + s * 0.42, x + s * 0.72, y + s * 0.14);
  });
};

const tambourine: IconFn = (ctx, x, y, s) => {
  const cx = x + s * 0.5;
  const cy = y + s * 0.5;
  stroke(ctx, () => ctx.arc(cx, cy, s * 0.36, 0, Math.PI * 2));
  for (let i = 0; i < 5; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / 5;
    const jx = cx + Math.cos(angle) * s * 0.36;
    const jy = cy + Math.sin(angle) * s * 0.36;
    stroke(ctx, () => ctx.arc(jx, jy, s * 0.07, 0, Math.PI * 2));
  }
};

const maracas: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => ctx.ellipse(x + s * 0.32, y + s * 0.3, s * 0.15, s * 0.2, -0.45, 0, Math.PI * 2));
  stroke(ctx, () => ctx.ellipse(x + s * 0.68, y + s * 0.3, s * 0.15, s * 0.2, 0.45, 0, Math.PI * 2));
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.4, y + s * 0.47);
    ctx.lineTo(x + s * 0.58, y + s * 0.94);
    ctx.moveTo(x + s * 0.6, y + s * 0.47);
    ctx.lineTo(x + s * 0.42, y + s * 0.94);
  });
};

/** Marimba, xylophone, vibraphone: graduated bars. */
const xylophone: IconFn = (ctx, x, y, s) => {
  for (let i = 0; i < 5; i++) {
    const h = s * (0.8 - i * 0.11);
    ctx.strokeRect(x + s * (0.07 + i * 0.18), y + s * 0.5 - h / 2, s * 0.12, h);
  }
};

const bell: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.14, y + s * 0.76);
    ctx.quadraticCurveTo(x + s * 0.26, y + s * 0.66, x + s * 0.26, y + s * 0.46);
    ctx.bezierCurveTo(x + s * 0.26, y + s * 0.16, x + s * 0.74, y + s * 0.16, x + s * 0.74, y + s * 0.46);
    ctx.quadraticCurveTo(x + s * 0.74, y + s * 0.66, x + s * 0.86, y + s * 0.76);
    ctx.closePath();
  });
  stroke(ctx, () => ctx.arc(x + s * 0.5, y + s * 0.86, s * 0.07, 0, Math.PI * 2));
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.5, y + s * 0.24);
    ctx.lineTo(x + s * 0.5, y + s * 0.1);
  });
};

const gong: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.1, y + s * 0.96);
    ctx.lineTo(x + s * 0.1, y + s * 0.1);
    ctx.lineTo(x + s * 0.9, y + s * 0.1);
    ctx.lineTo(x + s * 0.9, y + s * 0.96);
    ctx.moveTo(x + s * 0.4, y + s * 0.1);
    ctx.lineTo(x + s * 0.44, y + s * 0.28);
    ctx.moveTo(x + s * 0.6, y + s * 0.1);
    ctx.lineTo(x + s * 0.56, y + s * 0.28);
  });
  stroke(ctx, () => ctx.arc(x + s * 0.5, y + s * 0.54, s * 0.27, 0, Math.PI * 2));
  stroke(ctx, () => ctx.arc(x + s * 0.5, y + s * 0.54, s * 0.08, 0, Math.PI * 2));
};

// ---------------------------------------------------------------------------
// Voice and sound
// ---------------------------------------------------------------------------

const headphones: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => ctx.arc(x + s * 0.5, y + s * 0.56, s * 0.36, Math.PI, Math.PI * 2));
  roundedRect(ctx, x + s * 0.09, y + s * 0.52, s * 0.16, s * 0.34, s * 0.06);
  roundedRect(ctx, x + s * 0.75, y + s * 0.52, s * 0.16, s * 0.34, s * 0.06);
};

const speaker: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.08, y + s * 0.38);
    ctx.lineTo(x + s * 0.26, y + s * 0.38);
    ctx.lineTo(x + s * 0.48, y + s * 0.18);
    ctx.lineTo(x + s * 0.48, y + s * 0.82);
    ctx.lineTo(x + s * 0.26, y + s * 0.62);
    ctx.lineTo(x + s * 0.08, y + s * 0.62);
    ctx.closePath();
  });
  stroke(ctx, () => ctx.arc(x + s * 0.5, y + s * 0.5, s * 0.18, -0.75, 0.75));
  stroke(ctx, () => ctx.arc(x + s * 0.5, y + s * 0.5, s * 0.34, -0.75, 0.75));
};

// ---------------------------------------------------------------------------
// More synth and waveforms
// ---------------------------------------------------------------------------

const tri: IconFn = (ctx, x, y, s) =>
  stroke(ctx, () => {
    ctx.moveTo(x, y + s * 0.5);
    ctx.lineTo(x + s * 0.17, y + s * 0.24);
    ctx.lineTo(x + s * 0.5, y + s * 0.76);
    ctx.lineTo(x + s * 0.83, y + s * 0.24);
    ctx.lineTo(x + s, y + s * 0.5);
  });

const NOISE = [0.5, 0.3, 0.64, 0.2, 0.72, 0.38, 0.8, 0.26, 0.58, 0.34, 0.68, 0.44, 0.5];
const noise: IconFn = (ctx, x, y, s) =>
  stroke(ctx, () => {
    NOISE.forEach((value, i) => {
      const px = x + (s * i) / (NOISE.length - 1);
      if (i === 0) ctx.moveTo(px, y + s * value);
      else ctx.lineTo(px, y + s * value);
    });
  });

/** Attack, decay, sustain, release. */
const envelope: IconFn = (ctx, x, y, s) =>
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.04, y + s * 0.84);
    ctx.lineTo(x + s * 0.24, y + s * 0.16);
    ctx.lineTo(x + s * 0.42, y + s * 0.46);
    ctx.lineTo(x + s * 0.7, y + s * 0.46);
    ctx.lineTo(x + s * 0.96, y + s * 0.84);
  });

const knob: IconFn = (ctx, x, y, s) => {
  const cx = x + s * 0.5;
  const cy = y + s * 0.54;
  stroke(ctx, () => ctx.arc(cx, cy, s * 0.28, 0, Math.PI * 2));
  stroke(ctx, () => {
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(-2.3) * s * 0.22, cy + Math.sin(-2.3) * s * 0.22);
    for (let i = 0; i < 5; i++) {
      const angle = Math.PI * 0.75 + (i * Math.PI * 1.5) / 4;
      ctx.moveTo(cx + Math.cos(angle) * s * 0.36, cy + Math.sin(angle) * s * 0.36);
      ctx.lineTo(cx + Math.cos(angle) * s * 0.44, cy + Math.sin(angle) * s * 0.44);
    }
  });
};

const bolt: IconFn = (ctx, x, y, s) =>
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.6, y + s * 0.04);
    ctx.lineTo(x + s * 0.24, y + s * 0.56);
    ctx.lineTo(x + s * 0.48, y + s * 0.56);
    ctx.lineTo(x + s * 0.4, y + s * 0.96);
    ctx.lineTo(x + s * 0.76, y + s * 0.42);
    ctx.lineTo(x + s * 0.52, y + s * 0.42);
    ctx.closePath();
  });

// ---------------------------------------------------------------------------
// Atmosphere
// ---------------------------------------------------------------------------

const cloud: IconFn = (ctx, x, y, s) =>
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.24, y + s * 0.74);
    ctx.arc(x + s * 0.25, y + s * 0.58, s * 0.16, Math.PI * 0.5, Math.PI * 1.45);
    ctx.arc(x + s * 0.5, y + s * 0.46, s * 0.22, Math.PI * 1.1, Math.PI * 1.9);
    ctx.arc(x + s * 0.75, y + s * 0.58, s * 0.16, Math.PI * 1.55, Math.PI * 0.5);
    ctx.closePath();
  });

const sparkle: IconFn = (ctx, x, y, s) => {
  const four = (cx: number, cy: number, r: number) =>
    stroke(ctx, () => {
      const w = r * 0.24;
      ctx.moveTo(cx, cy - r);
      ctx.quadraticCurveTo(cx + w, cy - w, cx + r, cy);
      ctx.quadraticCurveTo(cx + w, cy + w, cx, cy + r);
      ctx.quadraticCurveTo(cx - w, cy + w, cx - r, cy);
      ctx.quadraticCurveTo(cx - w, cy - w, cx, cy - r);
    });
  four(x + s * 0.42, y + s * 0.56, s * 0.36);
  four(x + s * 0.8, y + s * 0.2, s * 0.14);
};

const drop: IconFn = (ctx, x, y, s) =>
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.5, y + s * 0.06);
    ctx.bezierCurveTo(x + s * 0.6, y + s * 0.3, x + s * 0.8, y + s * 0.44, x + s * 0.8, y + s * 0.64);
    ctx.arc(x + s * 0.5, y + s * 0.64, s * 0.3, 0, Math.PI);
    ctx.bezierCurveTo(x + s * 0.2, y + s * 0.44, x + s * 0.4, y + s * 0.3, x + s * 0.5, y + s * 0.06);
  });

const waves: IconFn = (ctx, x, y, s) => {
  for (let i = 0; i < 3; i++) {
    const base = 0.3 + i * 0.2;
    curve(ctx, x, y, s, 24, (t) => base - Math.sin(t * Math.PI * 3) * 0.06);
  }
};

const moon: IconFn = (ctx, x, y, s) =>
  stroke(ctx, () => {
    ctx.arc(x + s * 0.5, y + s * 0.5, s * 0.38, -Math.PI * 0.35, Math.PI * 0.35, true);
    ctx.arc(x + s * 0.68, y + s * 0.5, s * 0.34, Math.PI * 0.508, Math.PI * 1.492, false);
    ctx.closePath();
  });

const sun: IconFn = (ctx, x, y, s) => {
  const cx = x + s * 0.5;
  const cy = y + s * 0.5;
  stroke(ctx, () => ctx.arc(cx, cy, s * 0.18, 0, Math.PI * 2));
  stroke(ctx, () => {
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      ctx.moveTo(cx + Math.cos(angle) * s * 0.29, cy + Math.sin(angle) * s * 0.29);
      ctx.lineTo(cx + Math.cos(angle) * s * 0.43, cy + Math.sin(angle) * s * 0.43);
    }
  });
};

const planet: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => ctx.arc(x + s * 0.5, y + s * 0.5, s * 0.24, 0, Math.PI * 2));
  stroke(ctx, () => ctx.ellipse(x + s * 0.5, y + s * 0.5, s * 0.46, s * 0.12, -0.35, 0, Math.PI * 2));
};

// ---------------------------------------------------------------------------
// Notation
// ---------------------------------------------------------------------------

/** Two beamed eighth notes. */
const notes: IconFn = (ctx, x, y, s) => {
  ctx.beginPath();
  ctx.ellipse(x + s * 0.27, y + s * 0.8, s * 0.14, s * 0.1, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + s * 0.71, y + s * 0.72, s * 0.14, s * 0.1, -0.35, 0, Math.PI * 2);
  ctx.fill();
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.39, y + s * 0.76);
    ctx.lineTo(x + s * 0.39, y + s * 0.2);
    ctx.moveTo(x + s * 0.83, y + s * 0.68);
    ctx.lineTo(x + s * 0.83, y + s * 0.12);
  });
  ctx.beginPath();
  ctx.moveTo(x + s * 0.39, y + s * 0.2);
  ctx.lineTo(x + s * 0.83, y + s * 0.12);
  ctx.lineTo(x + s * 0.83, y + s * 0.22);
  ctx.lineTo(x + s * 0.39, y + s * 0.3);
  ctx.closePath();
  ctx.fill();
};

/** A simplified G clef: spiral, stem and upper loop. */
const treble: IconFn = (ctx, x, y, s) => {
  const px = (v: number) => x + s * v;
  const py = (v: number) => y + s * v;
  stroke(ctx, () => {
    // Spiral around the G line, ending in the outer bowl.
    ctx.moveTo(px(0.56), py(0.62));
    ctx.bezierCurveTo(px(0.42), py(0.56), px(0.4), py(0.74), px(0.52), py(0.76));
    ctx.bezierCurveTo(px(0.68), py(0.78), px(0.74), py(0.58), px(0.6), py(0.5));
    ctx.bezierCurveTo(px(0.44), py(0.42), px(0.26), py(0.54), px(0.28), py(0.7));
    ctx.bezierCurveTo(px(0.3), py(0.86), px(0.5), py(0.92), px(0.62), py(0.86));
    // Stem up into the top loop.
    ctx.moveTo(px(0.56), py(0.62));
    ctx.lineTo(px(0.48), py(0.16));
    ctx.bezierCurveTo(px(0.46), py(0.04), px(0.62), py(0.02), px(0.6), py(0.14));
    ctx.bezierCurveTo(px(0.58), py(0.26), px(0.4), py(0.34), px(0.36), py(0.46));
    // Tail.
    ctx.moveTo(px(0.56), py(0.62));
    ctx.lineTo(px(0.6), py(0.92));
    ctx.quadraticCurveTo(px(0.6), py(0.99), px(0.52), py(0.97));
  });
  ctx.beginPath();
  ctx.arc(px(0.48), py(0.95), s * 0.05, 0, Math.PI * 2);
  ctx.fill();
};

/** F clef: a curl and two dots. */
const bassClef: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.2, y + s * 0.38);
    ctx.bezierCurveTo(x + s * 0.2, y + s * 0.12, x + s * 0.66, y + s * 0.1, x + s * 0.66, y + s * 0.38);
    ctx.bezierCurveTo(x + s * 0.66, y + s * 0.62, x + s * 0.44, y + s * 0.8, x + s * 0.16, y + s * 0.92);
  });
  for (const [cx, cy, r] of [
    [0.24, 0.38, 0.07],
    [0.84, 0.28, 0.05],
    [0.84, 0.5, 0.05],
  ]) {
    ctx.beginPath();
    ctx.arc(x + s * cx, y + s * cy, s * r, 0, Math.PI * 2);
    ctx.fill();
  }
};

const metronome: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.36, y + s * 0.06);
    ctx.lineTo(x + s * 0.64, y + s * 0.06);
    ctx.lineTo(x + s * 0.86, y + s * 0.94);
    ctx.lineTo(x + s * 0.14, y + s * 0.94);
    ctx.closePath();
    ctx.moveTo(x + s * 0.22, y + s * 0.74);
    ctx.lineTo(x + s * 0.78, y + s * 0.74);
    ctx.moveTo(x + s * 0.5, y + s * 0.74);
    ctx.lineTo(x + s * 0.74, y + s * 0.16);
  });
  ctx.strokeRect(x + s * 0.56, y + s * 0.4, s * 0.1, s * 0.07);
};

const vinyl: IconFn = (ctx, x, y, s) => {
  const cx = x + s * 0.5;
  const cy = y + s * 0.5;
  stroke(ctx, () => ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2));
  stroke(ctx, () => ctx.arc(cx, cy, s * 0.29, -0.4, Math.PI * 0.6));
  stroke(ctx, () => ctx.arc(cx, cy, s * 0.13, 0, Math.PI * 2));
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.035, 0, Math.PI * 2);
  ctx.fill();
};

// ---------------------------------------------------------------------------
// Studio: the instruments a DAW's track icons cover
// ---------------------------------------------------------------------------

/** Electric piano: a flat case on two legs, keys along the front. */
const epiano: IconFn = (ctx, x, y, s) => {
  ctx.strokeRect(x + s * 0.04, y + s * 0.3, s * 0.92, s * 0.26);
  for (let i = 1; i < 6; i++) {
    const kx = x + s * 0.04 + (s * 0.92 * i) / 6;
    stroke(ctx, () => {
      ctx.moveTo(kx, y + s * 0.42);
      ctx.lineTo(kx, y + s * 0.56);
    });
  }
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.04, y + s * 0.42);
    ctx.lineTo(x + s * 0.96, y + s * 0.42);
    ctx.moveTo(x + s * 0.16, y + s * 0.56);
    ctx.lineTo(x + s * 0.1, y + s * 0.94);
    ctx.moveTo(x + s * 0.84, y + s * 0.56);
    ctx.lineTo(x + s * 0.9, y + s * 0.94);
  });
};

/** A solid-body electric: double cutaway, long neck, two pickups. */
function solidBody(neckTop: number, tuners: number): IconFn {
  return (ctx, x, y, s) => {
    const cx = x + s * 0.5;
    stroke(ctx, () => {
      ctx.moveTo(cx, y + s * neckTop);
      ctx.lineTo(cx, y + s * 0.5);
    });
    for (let i = 0; i < tuners; i++) {
      const ty = y + s * (neckTop + 0.03 + i * 0.05);
      stroke(ctx, () => {
        ctx.moveTo(cx, ty);
        ctx.lineTo(cx + s * 0.07, ty);
      });
    }
    stroke(ctx, () => {
      ctx.moveTo(cx - s * 0.08, y + s * 0.5);
      ctx.quadraticCurveTo(cx - s * 0.2, y + s * 0.36, cx - s * 0.26, y + s * 0.5);
      ctx.bezierCurveTo(cx - s * 0.4, y + s * 0.7, cx - s * 0.3, y + s * 0.98, cx, y + s * 0.96);
      ctx.bezierCurveTo(cx + s * 0.3, y + s * 0.98, cx + s * 0.36, y + s * 0.72, cx + s * 0.24, y + s * 0.56);
      ctx.quadraticCurveTo(cx + s * 0.3, y + s * 0.36, cx + s * 0.08, y + s * 0.5);
    });
    stroke(ctx, () => {
      ctx.moveTo(cx - s * 0.12, y + s * 0.66);
      ctx.lineTo(cx + s * 0.12, y + s * 0.66);
      ctx.moveTo(cx - s * 0.12, y + s * 0.78);
      ctx.lineTo(cx + s * 0.12, y + s * 0.78);
    });
  };
}

const ukulele: IconFn = (ctx, x, y, s) => {
  const cx = x + s * 0.5;
  stroke(ctx, () => {
    ctx.moveTo(cx, y + s * 0.12);
    ctx.lineTo(cx, y + s * 0.5);
  });
  ctx.strokeRect(cx - s * 0.06, y + s * 0.04, s * 0.12, s * 0.1);
  stroke(ctx, () => ctx.ellipse(cx, y + s * 0.6, s * 0.17, s * 0.13, 0, 0, Math.PI * 2));
  stroke(ctx, () => ctx.ellipse(cx, y + s * 0.8, s * 0.22, s * 0.15, 0, 0, Math.PI * 2));
  stroke(ctx, () => ctx.arc(cx, y + s * 0.72, s * 0.05, 0, Math.PI * 2));
};

/** Mandolin: a teardrop body on a short neck. */
const mandolin: IconFn = (ctx, x, y, s) => {
  const cx = x + s * 0.5;
  stroke(ctx, () => {
    ctx.moveTo(cx, y + s * 0.04);
    ctx.lineTo(cx, y + s * 0.44);
  });
  stroke(ctx, () => {
    ctx.moveTo(cx, y + s * 0.4);
    ctx.bezierCurveTo(cx + s * 0.42, y + s * 0.56, cx + s * 0.34, y + s * 0.96, cx, y + s * 0.96);
    ctx.bezierCurveTo(cx - s * 0.34, y + s * 0.96, cx - s * 0.42, y + s * 0.56, cx, y + s * 0.4);
  });
  stroke(ctx, () => ctx.ellipse(cx, y + s * 0.66, s * 0.06, s * 0.09, 0, 0, Math.PI * 2));
};

/** Sitar: a round gourd and a very long neck with a second gourd near the top. */
const sitar: IconFn = (ctx, x, y, s) => {
  const cx = x + s * 0.5;
  stroke(ctx, () => {
    ctx.moveTo(cx - s * 0.05, y + s * 0.04);
    ctx.lineTo(cx - s * 0.05, y + s * 0.62);
    ctx.moveTo(cx + s * 0.05, y + s * 0.04);
    ctx.lineTo(cx + s * 0.05, y + s * 0.62);
  });
  stroke(ctx, () => ctx.arc(cx, y + s * 0.78, s * 0.19, 0, Math.PI * 2));
  stroke(ctx, () => ctx.arc(cx + s * 0.14, y + s * 0.18, s * 0.08, 0, Math.PI * 2));
};

/** A string section: a violin with its bow across it. */
const stringSection: IconFn = (ctx, x, y, s) => {
  stringed(0.3)(ctx, x - s * 0.1, y + s * 0.04, s * 0.9);
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.12, y + s * 0.9);
    ctx.lineTo(x + s * 0.94, y + s * 0.12);
    ctx.moveTo(x + s * 0.94, y + s * 0.12);
    ctx.lineTo(x + s * 0.94, y + s * 0.22);
  });
};

/** Trombone: the long slide, the bell, and the loop that joins them. */
const trombone: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.04, y + s * 0.4);
    ctx.lineTo(x + s * 0.78, y + s * 0.4);
    ctx.quadraticCurveTo(x + s * 0.96, y + s * 0.4, x + s * 0.96, y + s * 0.5);
    ctx.quadraticCurveTo(x + s * 0.96, y + s * 0.6, x + s * 0.78, y + s * 0.6);
    ctx.lineTo(x + s * 0.32, y + s * 0.6);
  });
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.32, y + s * 0.6);
    ctx.lineTo(x + s * 0.06, y + s * 0.74);
    ctx.lineTo(x + s * 0.06, y + s * 0.46);
    ctx.closePath();
  });
};

/** French horn: a coiled tube opening into a wide bell. */
const frenchHorn: IconFn = (ctx, x, y, s) => {
  // The coil, with the mouthpiece pipe leaving it at the top.
  stroke(ctx, () => ctx.arc(x + s * 0.36, y + s * 0.42, s * 0.26, 0, Math.PI * 2));
  stroke(ctx, () => ctx.arc(x + s * 0.36, y + s * 0.42, s * 0.12, 0, Math.PI * 2));
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.36, y + s * 0.16);
    ctx.lineTo(x + s * 0.12, y + s * 0.06);
  });
  // A wide bell flaring out to the lower right.
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.54, y + s * 0.6);
    ctx.quadraticCurveTo(x + s * 0.66, y + s * 0.66, x + s * 0.7, y + s * 0.96);
    ctx.moveTo(x + s * 0.6, y + s * 0.52);
    ctx.quadraticCurveTo(x + s * 0.74, y + s * 0.56, x + s * 0.98, y + s * 0.6);
  });
  stroke(ctx, () => ctx.ellipse(x + s * 0.84, y + s * 0.78, s * 0.2, s * 0.13, -Math.PI / 4, 0, Math.PI * 2));
};

/** Tuba: a tall body with its bell facing up. */
const tuba: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.24, y + s * 0.06);
    ctx.lineTo(x + s * 0.76, y + s * 0.06);
    ctx.lineTo(x + s * 0.62, y + s * 0.24);
    ctx.lineTo(x + s * 0.62, y + s * 0.82);
    ctx.quadraticCurveTo(x + s * 0.62, y + s * 0.96, x + s * 0.46, y + s * 0.96);
    ctx.quadraticCurveTo(x + s * 0.3, y + s * 0.96, x + s * 0.3, y + s * 0.8);
    ctx.lineTo(x + s * 0.38, y + s * 0.24);
    ctx.closePath();
  });
  stroke(ctx, () => ctx.arc(x + s * 0.2, y + s * 0.58, s * 0.1, 0, Math.PI * 2));
};

/** Clarinet: a straight dark tube with keys and a small flared bell. */
const clarinet: IconFn = (ctx, x, y, s) => {
  const cx = x + s * 0.5;
  stroke(ctx, () => {
    ctx.moveTo(cx - s * 0.04, y + s * 0.04);
    ctx.lineTo(cx - s * 0.05, y + s * 0.8);
    ctx.lineTo(cx - s * 0.14, y + s * 0.96);
    ctx.lineTo(cx + s * 0.14, y + s * 0.96);
    ctx.lineTo(cx + s * 0.05, y + s * 0.8);
    ctx.lineTo(cx + s * 0.04, y + s * 0.04);
  });
  for (let i = 0; i < 4; i++) {
    stroke(ctx, () => ctx.arc(cx, y + s * (0.26 + i * 0.13), s * 0.025, 0, Math.PI * 2));
  }
};

/** Bagpipes: a bag with drones standing up from it. */
const bagpipes: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => ctx.ellipse(x + s * 0.42, y + s * 0.66, s * 0.3, s * 0.22, -0.3, 0, Math.PI * 2));
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.36, y + s * 0.46);
    ctx.lineTo(x + s * 0.3, y + s * 0.06);
    ctx.moveTo(x + s * 0.5, y + s * 0.45);
    ctx.lineTo(x + s * 0.54, y + s * 0.12);
    ctx.moveTo(x + s * 0.64, y + s * 0.5);
    ctx.lineTo(x + s * 0.8, y + s * 0.2);
    ctx.moveTo(x + s * 0.6, y + s * 0.84);
    ctx.lineTo(x + s * 0.72, y + s * 0.98);
  });
};

/** Drum machine: a row of step buttons under two knobs. */
const drumMachine: IconFn = (ctx, x, y, s) => {
  ctx.strokeRect(x + s * 0.04, y + s * 0.2, s * 0.92, s * 0.6);
  stroke(ctx, () => ctx.arc(x + s * 0.22, y + s * 0.38, s * 0.07, 0, Math.PI * 2));
  stroke(ctx, () => ctx.arc(x + s * 0.42, y + s * 0.38, s * 0.07, 0, Math.PI * 2));
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.58, y + s * 0.34);
    ctx.lineTo(x + s * 0.86, y + s * 0.34);
  });
  for (let i = 0; i < 6; i++) ctx.strokeRect(x + s * (0.11 + i * 0.13), y + s * 0.6, s * 0.08, s * 0.08);
};

/** Sampler: a screen over a grid of pads. */
const sampler: IconFn = (ctx, x, y, s) => {
  roundedRect(ctx, x + s * 0.1, y + s * 0.04, s * 0.8, s * 0.92, s * 0.06);
  ctx.strokeRect(x + s * 0.22, y + s * 0.13, s * 0.56, s * 0.18);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) ctx.strokeRect(x + s * (0.22 + c * 0.2), y + s * (0.42 + r * 0.17), s * 0.15, s * 0.13);
  }
};

/** Kick drum from the front: the head, a port and the pedal. */
const kick: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => ctx.arc(x + s * 0.5, y + s * 0.46, s * 0.4, 0, Math.PI * 2));
  stroke(ctx, () => ctx.arc(x + s * 0.5, y + s * 0.46, s * 0.12, 0, Math.PI * 2));
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.5, y + s * 0.86);
    ctx.lineTo(x + s * 0.5, y + s * 0.98);
    ctx.moveTo(x + s * 0.36, y + s * 0.98);
    ctx.lineTo(x + s * 0.64, y + s * 0.98);
  });
};

const cowbell: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.36, y + s * 0.2);
    ctx.lineTo(x + s * 0.64, y + s * 0.2);
    ctx.lineTo(x + s * 0.8, y + s * 0.88);
    ctx.lineTo(x + s * 0.2, y + s * 0.88);
    ctx.closePath();
  });
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.5, y + s * 0.2);
    ctx.lineTo(x + s * 0.5, y + s * 0.06);
  });
};

/** Shaker: an egg, with motion lines. */
const shaker: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => ctx.ellipse(x + s * 0.44, y + s * 0.56, s * 0.22, s * 0.3, -0.4, 0, Math.PI * 2));
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.76, y + s * 0.14);
    ctx.lineTo(x + s * 0.9, y + s * 0.06);
    ctx.moveTo(x + s * 0.82, y + s * 0.3);
    ctx.lineTo(x + s * 0.96, y + s * 0.26);
  });
};

/** Marimba: graded bars over resonator tubes. */
const marimba: IconFn = (ctx, x, y, s) => {
  for (let i = 0; i < 5; i++) {
    const bx = x + s * (0.08 + i * 0.18);
    const top = y + s * (0.12 + i * 0.06);
    ctx.strokeRect(bx, top, s * 0.13, s * 0.26);
    stroke(ctx, () => {
      ctx.moveTo(bx + s * 0.065, top + s * 0.26);
      ctx.lineTo(bx + s * 0.065, y + s * (0.94 - i * 0.06));
    });
  }
};

/** Steel drum: a shallow pan with dented note areas. */
const steelDrum: IconFn = (ctx, x, y, s) => {
  stroke(ctx, () => ctx.ellipse(x + s * 0.5, y + s * 0.36, s * 0.44, s * 0.2, 0, 0, Math.PI * 2));
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.06, y + s * 0.36);
    ctx.lineTo(x + s * 0.1, y + s * 0.72);
    ctx.quadraticCurveTo(x + s * 0.5, y + s * 0.92, x + s * 0.9, y + s * 0.72);
    ctx.lineTo(x + s * 0.94, y + s * 0.36);
  });
  stroke(ctx, () => ctx.arc(x + s * 0.36, y + s * 0.34, s * 0.07, 0, Math.PI * 2));
  stroke(ctx, () => ctx.arc(x + s * 0.62, y + s * 0.34, s * 0.09, 0, Math.PI * 2));
};

/** Modular synth: two modules joined by a drooping patch cable. */
const modular: IconFn = (ctx, x, y, s) => {
  ctx.strokeRect(x + s * 0.06, y + s * 0.1, s * 0.38, s * 0.8);
  ctx.strokeRect(x + s * 0.56, y + s * 0.1, s * 0.38, s * 0.8);
  stroke(ctx, () => ctx.arc(x + s * 0.25, y + s * 0.28, s * 0.07, 0, Math.PI * 2));
  stroke(ctx, () => ctx.arc(x + s * 0.75, y + s * 0.28, s * 0.07, 0, Math.PI * 2));
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.25, y + s * 0.66);
    ctx.bezierCurveTo(x + s * 0.3, y + s * 1.0, x + s * 0.7, y + s * 1.0, x + s * 0.75, y + s * 0.66);
  });
};

/** Guitar amp: a cabinet with a speaker grille and a row of knobs. */
const amp: IconFn = (ctx, x, y, s) => {
  roundedRect(ctx, x + s * 0.06, y + s * 0.12, s * 0.88, s * 0.76, s * 0.06);
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.06, y + s * 0.3);
    ctx.lineTo(x + s * 0.94, y + s * 0.3);
  });
  for (let i = 0; i < 4; i++) stroke(ctx, () => ctx.arc(x + s * (0.22 + i * 0.16), y + s * 0.21, s * 0.035, 0, Math.PI * 2));
  stroke(ctx, () => ctx.arc(x + s * 0.5, y + s * 0.6, s * 0.2, 0, Math.PI * 2));
};

/** Turntable: platter, spindle and tone arm. */
const turntable: IconFn = (ctx, x, y, s) => {
  ctx.strokeRect(x + s * 0.04, y + s * 0.14, s * 0.92, s * 0.72);
  stroke(ctx, () => ctx.arc(x + s * 0.4, y + s * 0.5, s * 0.27, 0, Math.PI * 2));
  stroke(ctx, () => ctx.arc(x + s * 0.4, y + s * 0.5, s * 0.03, 0, Math.PI * 2));
  stroke(ctx, () => {
    ctx.moveTo(x + s * 0.84, y + s * 0.24);
    ctx.lineTo(x + s * 0.84, y + s * 0.62);
    ctx.lineTo(x + s * 0.6, y + s * 0.74);
  });
};

/** Loop: two arrows chasing each other round. */
const loop: IconFn = (ctx, x, y, s) => {
  const cx = x + s * 0.5;
  const cy = y + s * 0.5;
  const r = s * 0.34;
  stroke(ctx, () => ctx.arc(cx, cy, r, Math.PI * 0.15, Math.PI * 0.95));
  stroke(ctx, () => ctx.arc(cx, cy, r, Math.PI * 1.15, Math.PI * 1.95));
  for (const a of [Math.PI * 0.95, Math.PI * 1.95]) {
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    const d = s * 0.12;
    stroke(ctx, () => {
      ctx.moveTo(px + Math.cos(a - 0.9) * d, py + Math.sin(a - 0.9) * d);
      ctx.lineTo(px, py);
      ctx.lineTo(px + Math.cos(a + 0.9 + Math.PI) * d, py + Math.sin(a + 0.9 + Math.PI) * d);
    });
  }
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const ICONS: Record<IconName, IconFn> = {
  piano,
  keyboard,
  organ,
  accordion,
  harmonica,
  guitar,
  banjo,
  violin: stringed(0.3),
  cello: stringed(0.24),
  bass,
  harp,
  brass,
  trumpet,
  sax,
  flute,
  panflute,
  reed,
  drums,
  snare,
  hihat,
  cymbal,
  timpani,
  conga,
  tambourine,
  maracas,
  xylophone,
  bell,
  gong,
  voice,
  choir,
  mic,
  headphones,
  speaker,
  sine,
  square: squareWave,
  saw,
  tri,
  pulse,
  noise,
  envelope,
  knob,
  pad,
  steps,
  bolt,
  cloud,
  sparkle,
  drop,
  waves,
  moon,
  sun,
  planet,
  note: musicNote,
  notes,
  treble,
  bassClef,
  metronome,
  vinyl,
  circle,
  ring,
  box,
  triangle,
  diamond,
  hexagon,
  star,
  cross,
  epiano,
  electricGuitar: solidBody(0.04, 3),
  electricBass: solidBody(0.02, 2),
  ukulele,
  mandolin,
  sitar,
  stringSection,
  trombone,
  frenchHorn,
  tuba,
  clarinet,
  bagpipes,
  drumMachine,
  sampler,
  kick,
  cowbell,
  shaker,
  marimba,
  steelDrum,
  modular,
  amp,
  turntable,
  loop,
  dot,
  dots,
  bars,
  line,
  blank,
};

/** Display order and labels for the per-track icon picker. */
export const ICON_GROUPS: Array<{ label: string; icons: IconName[] }> = [
  { label: 'Keys', icons: ['piano', 'keyboard', 'organ', 'accordion', 'harmonica'] },
  { label: 'Strings', icons: ['guitar', 'banjo', 'violin', 'cello', 'bass', 'harp'] },
  { label: 'Wind & brass', icons: ['brass', 'trumpet', 'sax', 'flute', 'panflute', 'reed'] },
  {
    label: 'Percussion',
    icons: ['drums', 'snare', 'hihat', 'cymbal', 'timpani', 'conga', 'tambourine', 'maracas', 'xylophone', 'bell', 'gong'],
  },
  { label: 'Voice & sound', icons: ['voice', 'choir', 'mic', 'headphones', 'speaker'] },
  {
    label: 'Synth & waveforms',
    icons: ['sine', 'square', 'saw', 'tri', 'pulse', 'noise', 'envelope', 'knob', 'pad', 'steps', 'bolt'],
  },
  { label: 'Atmosphere', icons: ['cloud', 'sparkle', 'drop', 'waves', 'moon', 'sun', 'planet'] },
  { label: 'Notation', icons: ['note', 'notes', 'treble', 'bassClef', 'metronome', 'vinyl'] },
  {
    label: 'Studio',
    icons: [
      'epiano', 'electricGuitar', 'electricBass', 'amp', 'ukulele', 'mandolin', 'sitar', 'stringSection',
      'trombone', 'frenchHorn', 'tuba', 'clarinet', 'bagpipes', 'kick', 'cowbell', 'shaker', 'marimba',
      'steelDrum', 'drumMachine', 'sampler', 'modular', 'turntable', 'loop',
    ],
  },
  { label: 'Shapes', icons: ['circle', 'ring', 'box', 'triangle', 'diamond', 'hexagon', 'star', 'cross'] },
  { label: 'Minimal', icons: ['dot', 'dots', 'bars', 'line', 'blank'] },
];

export const ALL_ICON_NAMES: IconName[] = ICON_GROUPS.flatMap((group) => group.icons);

// ---------------------------------------------------------------------------
// Icon sets
// ---------------------------------------------------------------------------

export interface IconSet {
  id: string;
  name: string;
  description: string;
  byFamily: Record<InstrumentFamily, IconName>;
}

function set(
  id: string,
  name: string,
  description: string,
  byFamily: Record<InstrumentFamily, IconName>,
): IconSet {
  return { id, name, description, byFamily };
}

export const ICON_SETS: IconSet[] = [
  set('instruments', 'Instruments', 'Literal instrument silhouettes, matched to the exact instrument.', {
    piano: 'piano',
    organ: 'organ',
    guitar: 'guitar',
    strings: 'violin',
    violin: 'violin',
    viola: 'violin',
    cello: 'cello',
    bass: 'bass',
    brass: 'brass',
    woodwinds: 'reed',
    choir: 'choir',
    voice: 'mic',
    drums: 'drums',
    percussion: 'xylophone',
    synth: 'saw',
    pad: 'cloud',
    arpeggio: 'steps',
    unknown: 'note',
  }),
  set('waveform', 'Waveform', 'Signal shapes instead of instruments.', {
    piano: 'pulse',
    organ: 'square',
    guitar: 'saw',
    strings: 'sine',
    violin: 'sine',
    viola: 'sine',
    cello: 'pad',
    bass: 'pad',
    brass: 'saw',
    woodwinds: 'sine',
    choir: 'pad',
    voice: 'sine',
    drums: 'bars',
    percussion: 'bars',
    synth: 'square',
    pad: 'pad',
    arpeggio: 'steps',
    unknown: 'line',
  }),
  set('geometric', 'Geometric', 'One shape per section. Reads at any size.', {
    piano: 'box',
    organ: 'box',
    guitar: 'hexagon',
    strings: 'triangle',
    violin: 'triangle',
    viola: 'triangle',
    cello: 'diamond',
    bass: 'diamond',
    brass: 'star',
    woodwinds: 'hexagon',
    choir: 'ring',
    voice: 'ring',
    drums: 'cross',
    percussion: 'cross',
    synth: 'circle',
    pad: 'ring',
    arpeggio: 'star',
    unknown: 'dot',
  }),
  set('minimal', 'Minimal', 'Dots and bars only. Nearly invisible.', {
    piano: 'dots',
    organ: 'dots',
    guitar: 'dots',
    strings: 'line',
    violin: 'line',
    viola: 'line',
    cello: 'line',
    bass: 'line',
    brass: 'dot',
    woodwinds: 'dot',
    choir: 'dot',
    voice: 'dot',
    drums: 'bars',
    percussion: 'bars',
    synth: 'dots',
    pad: 'line',
    arpeggio: 'bars',
    unknown: 'dot',
  }),
  set('none', 'None', 'No icons at all.', {
    piano: 'blank',
    organ: 'blank',
    guitar: 'blank',
    strings: 'blank',
    violin: 'blank',
    viola: 'blank',
    cello: 'blank',
    bass: 'blank',
    brass: 'blank',
    woodwinds: 'blank',
    choir: 'blank',
    voice: 'blank',
    drums: 'blank',
    percussion: 'blank',
    synth: 'blank',
    pad: 'blank',
    arpeggio: 'blank',
    unknown: 'blank',
  }),
];

export function iconSetById(id: string): IconSet {
  return ICON_SETS.find((candidate) => candidate.id === id) ?? ICON_SETS[0];
}

/**
 * The literal glyph for each General MIDI program, in blocks of eight as the
 * standard groups them. Used by the Instruments set when a file names the
 * exact instrument, so a marimba gets mallet bars and an accordion its
 * bellows instead of their whole family sharing one shape.
 */
const PROGRAM_ICONS: readonly IconName[] = [
  // Piano: grand ×3, honky-tonk, two electric pianos, harpsichord, clavinet
  'piano', 'piano', 'piano', 'piano', 'epiano', 'epiano', 'piano', 'epiano',
  // Chromatic percussion: celesta, glockenspiel, music box, vibraphone, marimba, xylophone, tubular bells, dulcimer
  'bell', 'bell', 'bell', 'marimba', 'marimba', 'xylophone', 'bell', 'xylophone',
  // Organ: four organs, reed organ, accordion, harmonica, tango accordion
  'organ', 'organ', 'organ', 'organ', 'organ', 'accordion', 'harmonica', 'accordion',
  // Guitar: nylon, steel, jazz, clean, muted, overdriven, distortion, harmonics
  'guitar', 'guitar', 'electricGuitar', 'electricGuitar', 'electricGuitar', 'amp', 'amp', 'electricGuitar',
  // Bass: four acoustic/electric, two slap, two synth
  'bass', 'electricBass', 'electricBass', 'electricBass', 'electricBass', 'electricBass', 'square', 'saw',
  // Strings: violin, viola, cello, contrabass, tremolo, pizzicato, harp, timpani
  'violin', 'violin', 'cello', 'bass', 'violin', 'violin', 'harp', 'timpani',
  // Ensemble: two string sections, two synth strings, choir, oohs, synth voice, orchestra hit
  'stringSection', 'stringSection', 'pad', 'pad', 'choir', 'choir', 'choir', 'bolt',
  // Brass: trumpet, trombone, tuba, muted trumpet, horn, section, two synth brass
  'trumpet', 'trombone', 'tuba', 'trumpet', 'frenchHorn', 'brass', 'saw', 'saw',
  // Reed: four saxophones, oboe, english horn, bassoon, clarinet
  'sax', 'sax', 'sax', 'sax', 'reed', 'reed', 'reed', 'clarinet',
  // Pipe: piccolo, flute, recorder, pan flute, bottle, shakuhachi, whistle, ocarina
  'flute', 'flute', 'flute', 'panflute', 'flute', 'flute', 'flute', 'flute',
  // Synth lead: square, sawtooth, calliope, chiff, charang, voice, fifths, bass + lead
  'square', 'saw', 'pulse', 'tri', 'bolt', 'mic', 'saw', 'saw',
  // Synth pad: new age, warm, polysynth, choir, bowed, metallic, halo, sweep
  'sparkle', 'cloud', 'keyboard', 'choir', 'cloud', 'cloud', 'moon', 'waves',
  // Synth effects: rain, soundtrack, crystal, atmosphere, brightness, goblins, echoes, sci-fi
  'drop', 'speaker', 'sparkle', 'cloud', 'sun', 'moon', 'speaker', 'planet',
  // Ethnic: sitar, banjo, shamisen, koto, kalimba, bagpipe, fiddle, shanai
  'sitar', 'banjo', 'banjo', 'harp', 'xylophone', 'bagpipes', 'violin', 'reed',
  // Percussive: tinkle bell, agogo, steel drums, woodblock, taiko, melodic tom, synth drum, reverse cymbal
  'bell', 'cowbell', 'steelDrum', 'snare', 'drums', 'drums', 'drumMachine', 'cymbal',
  // Sound effects: fret noise, breath, seashore, bird, telephone, helicopter, applause, gunshot
  'guitar', 'noise', 'waves', 'sparkle', 'speaker', 'noise', 'noise', 'bolt',
];

/** What a track says about its instrument, for choosing a glyph. */
export interface IconSubject {
  family: InstrumentFamily;
  /** General MIDI program, when the file sets one for the track's channel. */
  programNumber?: number;
  isPercussion: boolean;
}

/**
 * A track's explicit icon wins. Otherwise the active set decides: the
 * Instruments set uses the exact General MIDI instrument when the file names
 * one, and every set falls back to the instrument family.
 */
export function resolveIcon(subject: IconSubject, override: IconName | null, setId: string): IconName {
  if (override) return override;
  const iconSet = iconSetById(setId);
  if (iconSet.id === 'instruments') {
    if (subject.isPercussion) return 'drums';
    const program = subject.programNumber;
    if (program !== undefined && program >= 0 && program < PROGRAM_ICONS.length) return PROGRAM_ICONS[program];
  }
  return iconSet.byFamily[subject.family];
}

export function drawIcon(
  ctx: CanvasRenderingContext2D,
  name: IconName,
  x: number,
  y: number,
  size: number,
): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fillStyle = ctx.strokeStyle;
  ICONS[name](ctx, x, y, size);
  ctx.restore();
}
