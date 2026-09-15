import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import { Filter, LocateFixed, X } from 'lucide-react';

import { RENTAL_PRICE_BANDS } from '../assets/rental-core.js';
import { useRentalData } from './hooks/useRentalData';
import type {
    RentalFacets,
    RentalCity,
    RentalFilters,
    RentalGroup,
    RentalMapBounds,
    RentalPriceBand
} from './types/rental';

const RentalMap = lazy(async () => {
    const module = await import('./components/RentalMap');
    return { default: module.RentalMap };
});

const PRICE_FILTER_MAXIMUM = 200_000;
const SIZE_FILTER_MAXIMUM = 10_000;
const PRICE_PRESETS = [47_000, 60_000, 80_000, 100_000] as const;
const AUTO_DISMISS_DELAY = 5_000;

function groupInBounds(group: RentalGroup, bounds: RentalMapBounds | null) {
    if (!bounds) return true;
    const latitudeMatches = group.latitude >= bounds.south && group.latitude <= bounds.north;
    const longitudeMatches = bounds.west <= bounds.east
        ? group.longitude >= bounds.west && group.longitude <= bounds.east
        : group.longitude >= bounds.west || group.longitude <= bounds.east;
    return latitudeMatches && longitudeMatches;
}

function formatCompactPrice(value: number) {
    if (value >= 1_000_000) return `AED ${(value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0)}M`;
    return `AED ${Math.round(value / 1_000)}K`;
}

function formatSize(value: number) {
    return `${value.toLocaleString('en-AE')} sqft`;
}

function formatRange(
    minimum: number | null,
    maximum: number | null,
    floor: number,
    formatValue: (value: number) => string
) {
    if (minimum === null && maximum === null) return 'Any';
    if (maximum === null) return `${formatValue(minimum ?? floor)}+`;
    return `${formatValue(minimum ?? floor)} – ${formatValue(maximum)}`;
}

function RangeSlider({
    label,
    minimum,
    maximum,
    step,
    minValue,
    maxValue,
    formatValue,
    onChange
}: {
    label: string;
    minimum: number;
    maximum: number;
    step: number;
    minValue: number | null;
    maxValue: number | null;
    formatValue: (value: number) => string;
    onChange: (patch: { minimum?: number | null; maximum?: number | null }) => void;
}) {
    const resolvedMinimum = minValue ?? minimum;
    const resolvedMaximum = maxValue ?? maximum;
    const span = maximum - minimum;
    const start = ((resolvedMinimum - minimum) / span) * 100;
    const end = ((resolvedMaximum - minimum) / span) * 100;
    const trackStyle = {
        '--range-start': `${start}%`,
        '--range-end': `${end}%`
    } as CSSProperties;

    return (
        <div className="filter-range" role="group" aria-label={label} style={trackStyle}>
            <div className="filter-range__track" aria-hidden="true" />
            <input
                className="filter-range__input filter-range__input--minimum"
                type="range"
                min={minimum}
                max={maximum}
                step={step}
                value={resolvedMinimum}
                aria-label={`Minimum ${label}`}
                aria-valuetext={minValue === null ? `No minimum, ${formatValue(minimum)}` : formatValue(minValue)}
                onChange={(event) => {
                    const value = Math.min(Number(event.target.value), resolvedMaximum);
                    onChange({ minimum: value === minimum ? null : value });
                }}
            />
            <input
                className="filter-range__input filter-range__input--maximum"
                type="range"
                min={minimum}
                max={maximum}
                step={step}
                value={resolvedMaximum}
                aria-label={`Maximum ${label}`}
                aria-valuetext={maxValue === null ? `No maximum, ${formatValue(maximum)} or more` : formatValue(maxValue)}
                onChange={(event) => {
                    const value = Math.max(Number(event.target.value), resolvedMinimum);
                    onChange({ maximum: value === maximum ? null : value });
                }}
            />
        </div>
    );
}

function bedroomLabel(value: number) {
    return value === 0 ? 'Studio' : `${value} bed${value === 1 ? '' : 's'}`;
}

function toggleSelection<T>(current: readonly T[] | null, value: T): readonly T[] | null {
    if (current === null) return [value];
    const next = new Set(current);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next.size ? [...next] : null;
}

function PriceLegend({ bands }: { bands: readonly RentalPriceBand[] }) {
    return (
        <section className="price-legend" aria-label="Map marker price colors">
            <strong>Price on map</strong>
            <div className="price-legend__scale">
                {bands.map((band) => (
                    <span key={band.index} style={{ '--legend-color': band.color } as CSSProperties}>
                        <i aria-hidden="true" />
                        <small>{band.label}</small>
                    </span>
                ))}
                <span style={{ '--legend-color': '#64748b' } as CSSProperties}>
                    <i aria-hidden="true" />
                    <small>TBA</small>
                </span>
            </div>
        </section>
    );
}

function FilterDrawer({
    open,
    cities,
    cityId,
    filters,
    facets,
    resultCount,
    onChange,
    onCityChange,
    onReset,
    onInteraction,
    onClose
}: {
    open: boolean;
    cities: readonly RentalCity[];
    cityId: string;
    filters: RentalFilters;
    facets: RentalFacets;
    resultCount: number;
    onChange: (patch: Partial<RentalFilters>) => void;
    onCityChange: (cityId: string) => void;
    onReset: () => void;
    onInteraction: () => void;
    onClose: () => void;
}) {
    const bedroomOptions = useMemo(() => [...new Set([
        0,
        1,
        2,
        3,
        4,
        ...facets.bedrooms.map((facet) => facet.value)
    ])].sort((left, right) => left - right), [facets.bedrooms]);
    return (
        <>
            <div
                className={`filter-drawer-backdrop${open ? ' is-open' : ''}`}
                onClick={onClose}
                aria-hidden="true"
            />
            <aside
                id="filter-drawer"
                className={`filter-drawer${open ? ' is-open' : ''}`}
                role="dialog"
                aria-modal={open || undefined}
                aria-labelledby="filter-drawer-title"
                aria-hidden={!open}
                inert={!open}
                onPointerDownCapture={onInteraction}
                onTouchStartCapture={onInteraction}
                onKeyDownCapture={onInteraction}
                onFocusCapture={onInteraction}
                onWheelCapture={onInteraction}
                onScrollCapture={onInteraction}
            >
                <header className="filter-drawer__header">
                    <h2 id="filter-drawer-title">Rental Radar</h2>
                    <button type="button" className="filter-drawer__close" onClick={onClose} aria-label="Close filters">
                        <X size={20} />
                    </button>
                </header>

                <div className="filter-drawer__content">
                    <section className="filter-section" aria-labelledby="location-filter">
                        <div className="filter-section__heading">
                            <h3 id="location-filter">Location</h3>
                        </div>
                        <label className="filter-location-label">
                            <span>Emirate</span>
                            <select
                                className="filter-location-select"
                                value={cityId}
                                onChange={(event) => onCityChange(event.target.value)}
                            >
                                {cities.map((option) => (
                                    <option key={option.id} value={option.id}>{option.label}</option>
                                ))}
                            </select>
                        </label>
                    </section>

                    <section className="filter-section" aria-labelledby="yearly-rent-filter">
                        <div className="filter-section__heading">
                            <h3 id="yearly-rent-filter">Yearly rent</h3>
                            <strong>{formatRange(filters.minPrice, filters.maxPrice, 0, formatCompactPrice)}</strong>
                        </div>
                        <RangeSlider
                            label="yearly rent"
                            minimum={0}
                            maximum={PRICE_FILTER_MAXIMUM}
                            step={1_000}
                            minValue={filters.minPrice}
                            maxValue={filters.maxPrice}
                            formatValue={formatCompactPrice}
                            onChange={(patch) => onChange({
                                minPrice: patch.minimum === undefined ? filters.minPrice : patch.minimum,
                                maxPrice: patch.maximum === undefined ? filters.maxPrice : patch.maximum
                            })}
                        />
                        <div className="filter-price-limits" aria-hidden="true">
                            <span>AED 0</span>
                            <span>AED 200K+</span>
                        </div>
                        <div className="filter-option-grid" aria-label="Price presets">
                            {PRICE_PRESETS.map((value) => (
                                <button
                                    key={value}
                                    type="button"
                                    className="filter-option"
                                    aria-pressed={filters.minPrice === null && filters.maxPrice === value}
                                    onClick={() => onChange({ minPrice: null, maxPrice: value })}
                                >
                                    Up to {formatCompactPrice(value).replace('AED ', '')}
                                </button>
                            ))}
                            <button
                                type="button"
                                className="filter-option"
                                aria-pressed={filters.minPrice === null && filters.maxPrice === null}
                                onClick={() => onChange({ minPrice: null, maxPrice: null })}
                            >
                                Any price
                            </button>
                        </div>
                        <PriceLegend bands={RENTAL_PRICE_BANDS} />
                    </section>

                    <section className="filter-section" aria-labelledby="size-filter">
                        <div className="filter-section__heading">
                            <h3 id="size-filter">Size</h3>
                            <strong>{formatRange(filters.minSize, filters.maxSize, 0, formatSize)}</strong>
                        </div>
                        <RangeSlider
                            label="property size"
                            minimum={0}
                            maximum={SIZE_FILTER_MAXIMUM}
                            step={50}
                            minValue={filters.minSize}
                            maxValue={filters.maxSize}
                            formatValue={formatSize}
                            onChange={(patch) => onChange({
                                minSize: patch.minimum === undefined ? filters.minSize : patch.minimum,
                                maxSize: patch.maximum === undefined ? filters.maxSize : patch.maximum
                            })}
                        />
                        <div className="filter-price-limits" aria-hidden="true">
                            <span>0 sqft</span>
                            <span>10,000+ sqft</span>
                        </div>
                    </section>

                    <section className="filter-section" aria-labelledby="bedrooms-filter">
                        <div className="filter-section__heading">
                            <h3 id="bedrooms-filter">Bedrooms</h3>
                            <button type="button" onClick={() => onChange({ bedrooms: null })}>Any</button>
                        </div>
                        <div className="filter-option-grid">
                            {bedroomOptions.map((value) => {
                                const count = facets.bedrooms.find((facet) => facet.value === value)?.count;
                                return (
                                    <button
                                        key={value}
                                        type="button"
                                        className="filter-option"
                                        aria-pressed={filters.bedrooms?.includes(value) ?? false}
                                        onClick={() => onChange({ bedrooms: toggleSelection(filters.bedrooms, value) })}
                                    >
                                        {bedroomLabel(value)}{count === undefined ? '' : ` · ${count.toLocaleString('en-AE')}`}
                                    </button>
                                );
                            })}
                        </div>
                    </section>

                    <section className="filter-section" aria-labelledby="home-type-filter">
                        <div className="filter-section__heading">
                            <h3 id="home-type-filter">Home type</h3>
                            <button type="button" onClick={() => onChange({ propertyTypes: null })}>Any</button>
                        </div>
                        <div className="filter-option-grid">
                            {facets.propertyTypes.length ? facets.propertyTypes.map((facet) => (
                                <button
                                    key={facet.value}
                                    type="button"
                                    className="filter-option"
                                    aria-pressed={filters.propertyTypes?.includes(facet.value) ?? false}
                                    onClick={() => onChange({
                                        propertyTypes: toggleSelection(filters.propertyTypes, facet.value)
                                    })}
                                >
                                    {facet.value} · {facet.count.toLocaleString('en-AE')}
                                </button>
                            )) : <p className="filter-section__empty">Home types appear as listings load.</p>}
                        </div>
                    </section>
                </div>

                <footer className="filter-drawer__footer">
                    <button type="button" className="filter-drawer__reset" onClick={onReset}>Reset</button>
                    <button type="button" className="filter-drawer__apply" onClick={onClose}>
                        Show {resultCount.toLocaleString('en-AE')} rentals
                    </button>
                </footer>
            </aside>
        </>
    );
}

export function App() {
    const {
        cities,
        cityId,
        city,
        setCityId,
        listings,
        groups,
        facets,
        filters,
        setFilters,
        resetFilters,
        status,
        failedPages,
        retry,
        refresh
    } = useRentalData();
    const [map, setMap] = useState<LeafletMap | null>(null);
    const [viewport, setViewport] = useState<RentalMapBounds | null>(null);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const autoWelcomeHandledRef = useRef(false);
    const autoDismissActiveRef = useRef(false);
    const autoDismissTimeoutRef = useRef<number | null>(null);

    const clearAutoDismiss = useCallback(() => {
        if (autoDismissTimeoutRef.current === null) return;
        window.clearTimeout(autoDismissTimeoutRef.current);
        autoDismissTimeoutRef.current = null;
    }, []);

    const cancelAutoDismiss = useCallback(() => {
        autoDismissActiveRef.current = false;
        clearAutoDismiss();
    }, [clearAutoDismiss]);

    const closeFilterDrawer = useCallback(() => {
        autoWelcomeHandledRef.current = true;
        cancelAutoDismiss();
        setFiltersOpen(false);
    }, [cancelAutoDismiss]);

    const openFilterDrawer = useCallback(() => {
        autoWelcomeHandledRef.current = true;
        cancelAutoDismiss();
        setFiltersOpen(true);
    }, [cancelAutoDismiss]);

    const handleFilterDrawerInteraction = useCallback(() => {
        cancelAutoDismiss();
    }, [cancelAutoDismiss]);

    const viewportGroups = useMemo(
        () => groups.filter((group) => groupInBounds(group, viewport)),
        [groups, viewport]
    );
    const resultCount = useMemo(
        () => groups.reduce((total, group) => total + group.count, 0),
        [groups]
    );
    const activeFilterCount = Number(filters.minPrice !== null || filters.maxPrice !== null)
        + Number(filters.minSize !== null || filters.maxSize !== null)
        + Number(filters.bedrooms !== null)
        + Number(filters.propertyTypes !== null);

    useEffect(() => {
        setViewport(null);
    }, [city.id]);

    useEffect(() => {
        if (!filtersOpen) return undefined;
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') closeFilterDrawer();
        };
        document.addEventListener('keydown', closeOnEscape);
        return () => document.removeEventListener('keydown', closeOnEscape);
    }, [closeFilterDrawer, filtersOpen]);

    useEffect(() => {
        if (status !== 'ready' || !map || autoWelcomeHandledRef.current) return;
        autoWelcomeHandledRef.current = true;
        autoDismissActiveRef.current = true;
        setFiltersOpen(true);
    }, [map, status]);

    useEffect(() => {
        if (!filtersOpen || !autoDismissActiveRef.current) return undefined;

        const timeout = window.setTimeout(() => {
            if (autoDismissTimeoutRef.current !== timeout || !autoDismissActiveRef.current) return;
            autoDismissTimeoutRef.current = null;
            autoDismissActiveRef.current = false;
            setFiltersOpen(false);
        }, AUTO_DISMISS_DELAY);
        autoDismissTimeoutRef.current = timeout;

        return () => {
            if (autoDismissTimeoutRef.current !== timeout) return;
            window.clearTimeout(timeout);
            autoDismissTimeoutRef.current = null;
        };
    }, [filtersOpen]);

    const handleViewportChange = useCallback((bounds: RentalMapBounds) => {
        setViewport(bounds);
    }, []);

    const locateUser = useCallback(() => {
        if (!map || !navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
            ({ coords }) => map.flyTo(
                [coords.latitude, coords.longitude],
                Math.max(map.getZoom(), 13),
                { animate: true, duration: 0.5 }
            ),
            () => undefined,
            { enableHighAccuracy: false, timeout: 8_000, maximumAge: 60_000 }
        );
    }, [map]);

    return (
        <main className="app-shell">
            <Suspense fallback={<div className="map-loading" role="status" aria-label="Loading map" />}>
                <RentalMap
                    city={city}
                    groups={viewportGroups}
                    onViewportChange={handleViewportChange}
                    onMapReady={setMap}
                />
            </Suspense>

            <div className="map-actions" aria-label="Map actions">
                <button
                    className="map-action-button"
                    type="button"
                    onClick={locateUser}
                    disabled={!map}
                    aria-label="Use my location"
                    title="Use my location"
                >
                    <LocateFixed size={20} />
                </button>
                <button
                    className="map-action-button filter-button"
                    type="button"
                    onClick={openFilterDrawer}
                    aria-label="Open filters"
                    aria-controls="filter-drawer"
                    aria-expanded={filtersOpen}
                    title="Filters"
                >
                    <Filter size={20} />
                    {activeFilterCount ? <span className="filter-button__count">{activeFilterCount}</span> : null}
                </button>
            </div>

            <FilterDrawer
                open={filtersOpen}
                cities={cities}
                cityId={cityId}
                filters={filters}
                facets={facets}
                resultCount={resultCount}
                onChange={setFilters}
                onCityChange={setCityId}
                onReset={resetFilters}
                onInteraction={handleFilterDrawerInteraction}
                onClose={closeFilterDrawer}
            />

            {status === 'loading' && !listings.length ? (
                <p className="map-status map-status--loading" role="status">Loading rentals…</p>
            ) : null}
            {status === 'error' && !listings.length ? (
                <section className="fatal-state" role="alert">
                    <h1>We couldn’t load rentals</h1>
                    <p>The rental service is temporarily unavailable. Please try again.</p>
                    <button type="button" onClick={refresh}>Retry loading</button>
                </section>
            ) : null}
            {status === 'partial' && failedPages.length ? (
                <p className="map-status" role="status">
                    Some listings are still unavailable. <button type="button" onClick={retry}>Retry</button>
                </p>
            ) : null}
        </main>
    );
}
