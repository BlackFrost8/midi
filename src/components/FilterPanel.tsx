import { memo, useEffect, useRef } from 'react';
import { FILTERS, applyFilter, type FilterId } from '../thumbnail/Filters';
import { filterColours } from '../thumbnail/Compose';
import type { ThumbnailDesign, ThumbnailOptions } from '../thumbnail/ThumbnailDesign';
import { Section, Slider, Toggle } from './controls';

interface Props {
  design: ThumbnailDesign;
  options: ThumbnailOptions;
  onOptions: (patch: Partial<ThumbnailOptions>) => void;
  /** A small, unfiltered copy of the current thumbnail. */
  snapshot: HTMLCanvasElement | null;
  snapshotVersion: number;
}

/** Whole-picture filters for the thumbnail, each previewed on the real picture (a section of the Thumb tab). */
export const FilterPanel = memo(function FilterPanel(props: Props) {
  const { design, options, onOptions } = props;
  const selected = options.filter === 'mspaint' ? 'pixel' : options.filter;
  const current = FILTERS.find((filter) => filter.id === selected) ?? FILTERS[0];

  return (
    <Section title="Filter">
        <p className="hint">
          Filters work on the whole thumbnail, your paint and shapes included. The title stays clean on top unless you turn
          on <b>Filter the title too</b>.
        </p>
        <div className="filter-grid">
          {FILTERS.map((filter) => (
            <button
              key={filter.id}
              className={`filter-card${selected === filter.id ? ' on' : ''}`}
              title={filter.hint}
              onClick={() => onOptions({ filter: filter.id })}
            >
              <FilterPreview
                id={filter.id}
                design={design}
                strength={options.filterStrength}
                mix={filter.id === selected ? (options.filterMix ?? 1) : 1}
                snapshot={props.snapshot}
                version={props.snapshotVersion}
              />
              <span>{filter.name}</span>
            </button>
          ))}
        </div>
        {selected !== 'none' && (
          <>
            <div className="thumb-words">{current.hint}</div>
            <Slider
              label={current.strength}
              value={options.filterStrength}
              min={0}
              max={1}
              step={0.05}
              format={(value) => `${Math.round(value * 100)}%`}
              onChange={(filterStrength) => onOptions({ filterStrength })}
            />
            <Slider
              label="Amount"
              value={options.filterMix ?? 1}
              min={0}
              max={1}
              step={0.05}
              format={(value) => `${Math.round(value * 100)}%`}
              onChange={(filterMix) => onOptions({ filterMix })}
            />
            <p className="hint">Amount blends the filter with the original picture, for a lighter touch.</p>
            <Toggle label="Filter the title too" checked={options.filterTitle} onChange={(filterTitle) => onOptions({ filterTitle })} />
          </>
        )}
    </Section>
  );
});

function FilterPreview(props: {
  id: FilterId;
  design: ThumbnailDesign;
  strength: number;
  mix: number;
  snapshot: HTMLCanvasElement | null;
  version: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { id, design, strength, mix, snapshot, version } = props;
  const colours = filterColours(design);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !snapshot || !snapshot.width) return;
    canvas.width = snapshot.width;
    canvas.height = snapshot.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(snapshot, 0, 0);
    applyFilter(canvas, { id, strength, mix, seed: design.seed, ...colours });
    // `version` changes whenever the snapshot is redrawn.
  }, [id, strength, mix, snapshot, version, design.seed, colours.dark, colours.light]);

  return <canvas ref={ref} className="filter-preview" />;
}
