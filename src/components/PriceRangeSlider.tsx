import { useId, useMemo } from 'react';
import type { CSSProperties } from 'react';

type PricePreset = {
    label: string;
    minimum: number;
    maximum: number;
};

type PriceRangeSliderProps = {
    minimum: number;
    maximum: number;
    valueMinimum: number;
    valueMaximum: number;
    step?: number;
    presets?: readonly PricePreset[];
    onChange: (minimum: number, maximum: number) => void;
};

function formatPrice(value: number) {
    if (value >= 1_000_000) return `AED ${(value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0)}M`;
    if (value >= 1_000) return `AED ${Math.round(value / 1_000)}K`;
    return `AED ${Math.round(value)}`;
}

function clamp(value: number, minimum: number, maximum: number) {
    return Math.min(maximum, Math.max(minimum, value));
}

export function PriceRangeSlider({
    minimum,
    maximum,
    valueMinimum,
    valueMaximum,
    step = 1_000,
    presets = [],
    onChange
}: PriceRangeSliderProps) {
    const id = useId();
    const lower = clamp(valueMinimum, minimum, maximum);
    const upper = clamp(valueMaximum, lower, maximum);
    const span = Math.max(1, maximum - minimum);
    const lowerPercent = ((lower - minimum) / span) * 100;
    const upperPercent = ((upper - minimum) / span) * 100;
    const style = {
        '--price-start': `${lowerPercent}%`,
        '--price-end': `${upperPercent}%`
    } as CSSProperties;
    const activePreset = useMemo(() => presets.find((preset) => (
        clamp(preset.minimum, minimum, maximum) === lower
        && clamp(preset.maximum, minimum, maximum) === upper
    ))?.label ?? null, [lower, maximum, minimum, presets, upper]);

    return (
        <div className="price-range-slider" style={style}>
            <div className="price-range-slider__values" aria-hidden="true">
                <strong>{formatPrice(lower)}</strong>
                <span>to</span>
                <strong>{formatPrice(upper)}</strong>
            </div>
            <div className="price-range-slider__control">
                <div className="price-range-slider__track" aria-hidden="true" />
                <input
                    id={`${id}-minimum`}
                    className="price-range-slider__input price-range-slider__input--minimum"
                    type="range"
                    min={minimum}
                    max={maximum}
                    step={step}
                    value={lower}
                    aria-label="Minimum yearly rent"
                    aria-valuetext={formatPrice(lower)}
                    onChange={(event) => {
                        const next = Math.min(Number(event.target.value), upper - step);
                        onChange(clamp(next, minimum, maximum), upper);
                    }}
                />
                <input
                    id={`${id}-maximum`}
                    className="price-range-slider__input price-range-slider__input--maximum"
                    type="range"
                    min={minimum}
                    max={maximum}
                    step={step}
                    value={upper}
                    aria-label="Maximum yearly rent"
                    aria-valuetext={formatPrice(upper)}
                    onChange={(event) => {
                        const next = Math.max(Number(event.target.value), lower + step);
                        onChange(lower, clamp(next, minimum, maximum));
                    }}
                />
            </div>
            <div className="price-range-slider__limits" aria-hidden="true">
                <span>{formatPrice(minimum)}</span>
                <span>{formatPrice(maximum)}+</span>
            </div>
            {presets.length ? (
                <div className="price-range-slider__presets" aria-label="Price presets">
                    {presets.map((preset) => (
                        <button
                            key={preset.label}
                            type="button"
                            aria-pressed={activePreset === preset.label}
                            onClick={() => onChange(
                                clamp(preset.minimum, minimum, maximum),
                                clamp(preset.maximum, minimum, maximum)
                            )}
                        >
                            {preset.label}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
