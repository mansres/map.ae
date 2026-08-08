import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import { LocateFixed } from 'lucide-react';

import { RENTAL_PRICE_BANDS } from '../assets/rental-core.js';
import { useRentalData } from './hooks/useRentalData';
import type { RentalGroup, RentalMapBounds, RentalPriceBand } from './types/rental';

const RentalMap = lazy(async () => {
    const module = await import('./components/RentalMap');
    return { default: module.RentalMap };
});

function groupInBounds(group: RentalGroup, bounds: RentalMapBounds | null) {
    if (!bounds) return true;
    const latitudeMatches = group.latitude >= bounds.south && group.latitude <= bounds.north;
    const longitudeMatches = bounds.west <= bounds.east
        ? group.longitude >= bounds.west && group.longitude <= bounds.east
        : group.longitude >= bounds.west || group.longitude <= bounds.east;
    return latitudeMatches && longitudeMatches;
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

export function App() {
    const { city, listings, groups, status, failedPages, retry, refresh } = useRentalData();
    const [map, setMap] = useState<LeafletMap | null>(null);
    const [viewport, setViewport] = useState<RentalMapBounds | null>(null);

    const viewportGroups = useMemo(
        () => groups.filter((group) => groupInBounds(group, viewport)),
        [groups, viewport]
    );

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

            <PriceLegend bands={RENTAL_PRICE_BANDS} />

            <div className="map-actions" aria-label="Map actions">
                <button
                    className="locate-button"
                    type="button"
                    onClick={locateUser}
                    disabled={!map}
                    aria-label="Use my location"
                    title="Use my location"
                >
                    <LocateFixed size={20} />
                </button>
            </div>

            {status === 'loading' && !listings.length ? (
                <p className="map-status map-status--loading" role="status">Loading rentals…</p>
            ) : null}
            {status === 'error' && !listings.length ? (
                <section className="fatal-state" role="alert">
                    <h1>We couldn’t load rentals</h1>
                    <p>Check your connection, then try again.</p>
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
