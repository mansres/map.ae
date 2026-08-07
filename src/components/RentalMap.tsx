import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Map as LeafletMap, Marker as LeafletMarker } from 'leaflet';
import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';

import { percentagePriceBandIndex } from '../../assets/rental-core.js';
import type {
    RentalCity as City,
    RentalGroup,
    RentalMapBounds,
    RentalPriceScaleBand
} from '../types/rental';

type RentalMapProps = {
    city: City;
    groups: readonly RentalGroup[];
    selectedGroupKey: string | null;
    hoveredGroupKey: string | null;
    focusRequest: { key: string; id: number } | null;
    theme: 'light' | 'dark';
    priceScale: readonly RentalPriceScaleBand[];
    onSelectGroup: (key: string) => void;
    onHoverGroup: (key: string | null) => void;
    onShowCluster: (keys: readonly string[]) => void;
    onFocusHandled: (id: number) => void;
    onViewportChange: (bounds: RentalMapBounds, zoom: number) => void;
    onMapReady: (map: LeafletMap) => void;
};

type RentalLeafletMarker = LeafletMarker & { rentalGroup?: RentalGroup };

type ClusterSummary = {
    position: L.LatLng;
    bounds: L.LatLngBounds;
    groups: readonly RentalGroup[];
    listings: number;
    locations: number;
    minimum: number | null;
    maximum: number | null;
    average: number | null;
    communities: readonly string[];
    propertyTypes: readonly string[];
};

const UNKNOWN_PRICE_COLOR = '#64748b';

function compactPrice(value: number | null) {
    if (value === null || !Number.isFinite(value)) return 'Price TBA';
    if (value >= 1_000_000) return `AED ${(value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0)}M`;
    return `AED ${Math.round(value / 1000)}K`;
}

function formatPrice(value: number | null) {
    if (value === null || !Number.isFinite(value)) return 'Price on request';
    return new Intl.NumberFormat('en-AE', {
        style: 'currency',
        currency: 'AED',
        maximumFractionDigits: 0
    }).format(value);
}

function bedroomLabel(value: number) {
    return value === 0 ? 'Studio' : `${value} bed${value === 1 ? '' : 's'}`;
}

function priceColor(price: number | null, scale: readonly RentalPriceScaleBand[]) {
    if (!scale.length || price === null) return UNKNOWN_PRICE_COLOR;
    const index = percentagePriceBandIndex(price, scale[0].minimum, scale[scale.length - 1].maximum);
    return scale[index]?.color ?? UNKNOWN_PRICE_COLOR;
}

function markerIcon(group: RentalGroup, selected: boolean, hovered: boolean, scale: readonly RentalPriceScaleBand[]) {
    const color = priceColor(group.lowestPrice, scale);
    const count = group.count > 1
        ? `<span class="rr-marker__count">${group.count > 999 ? `${Math.round(group.count / 1000)}K` : group.count}</span>`
        : '';
    return L.divIcon({
        className: 'rr-marker-shell',
        html: `<span class="rr-marker${selected ? ' is-selected' : ''}${hovered ? ' is-hovered' : ''}" style="--marker-color:${color}"><span class="rr-marker__price">${compactPrice(group.lowestPrice)}</span>${count}</span>`,
        iconSize: [88, 44],
        iconAnchor: [44, 42],
        popupAnchor: [0, -38]
    });
}

function toBounds(bounds: L.LatLngBounds): RentalMapBounds {
    return {
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest()
    };
}

function ViewportEvents({ onViewportChange }: { onViewportChange: RentalMapProps['onViewportChange'] }) {
    const map = useMapEvents({
        moveend: () => onViewportChange(toBounds(map.getBounds()), map.getZoom())
    });

    useEffect(() => {
        onViewportChange(toBounds(map.getBounds()), map.getZoom());
    }, [map, onViewportChange]);

    return null;
}

function ViewportController({
    city,
    groups,
    focusRequest,
    onFocusHandled
}: {
    city: City;
    groups: readonly RentalGroup[];
    focusRequest: { key: string; id: number } | null;
    onFocusHandled: (id: number) => void;
}) {
    const map = useMap();
    const focusedGroup = focusRequest ? groups.find((group) => group.key === focusRequest.key) ?? null : null;

    useEffect(() => {
        map.flyTo(city.center, city.zoom, { animate: true, duration: 0.45 });
    }, [city.id, city.center, city.zoom, map]);

    useEffect(() => {
        if (!focusRequest) return;
        if (focusedGroup) {
            map.flyTo([focusedGroup.latitude, focusedGroup.longitude], Math.max(map.getZoom(), 14), {
                animate: true,
                duration: 0.35
            });
        }
        onFocusHandled(focusRequest.id);
    }, [focusRequest?.id, focusedGroup?.key, focusedGroup?.latitude, focusedGroup?.longitude, map, onFocusHandled]);

    return null;
}

function MapReference({ onMapReady }: { onMapReady: (map: LeafletMap) => void }) {
    const map = useMap();
    useEffect(() => onMapReady(map), [map, onMapReady]);
    return null;
}

function PopupContent({ group }: { group: RentalGroup }) {
    const listing = group.representative;
    const meta = [
        listing?.bedrooms !== null && listing?.bedrooms !== undefined ? bedroomLabel(listing.bedrooms) : null,
        listing?.bathrooms ? `${listing.bathrooms} bath${listing.bathrooms === 1 ? '' : 's'}` : null,
        listing?.size ? `${Math.round(listing.size).toLocaleString('en-AE')} sqft` : null
    ].filter(Boolean);

    return (
        <article className="popup-card">
            {group.imageUrl ? <img src={group.imageUrl} alt="" className="popup-card__image" loading="lazy" /> : null}
            <div className="popup-card__body">
                <p className="popup-card__eyebrow">{group.count} rental{group.count === 1 ? '' : 's'} here</p>
                <h2>{group.neighborhood || listing?.title || 'Rental location'}</h2>
                <strong>{group.lowestPrice === null ? 'Price on request' : `From ${formatPrice(group.lowestPrice)}`}</strong>
                {meta.length ? <p>{meta.join(' · ')}</p> : null}
                {listing?.listingUrl ? <a href={listing.listingUrl} target="_blank" rel="noopener noreferrer">View listing</a> : null}
            </div>
            {group.listings.length > 1 ? (
                <div className="popup-card__list" aria-label="Listings at this location">
                    {group.listings.slice(0, 6).map((child) => (
                        <div className="popup-card__listing" key={child.id}>
                            <span>{child.title}</span>
                            <strong>{formatPrice(child.price)}</strong>
                            {child.size ? <small>{Math.round(child.size).toLocaleString('en-AE')} sqft</small> : null}
                            {child.listingUrl ? <a href={child.listingUrl} target="_blank" rel="noopener noreferrer">View</a> : null}
                        </div>
                    ))}
                    {group.listings.length > 6 ? <p className="popup-card__more">+{group.listings.length - 6} more rentals</p> : null}
                </div>
            ) : null}
        </article>
    );
}

const RentalMarker = memo(function RentalMarker({
    group,
    selected,
    hovered,
    priceScale,
    onSelectGroup,
    onHoverGroup
}: {
    group: RentalGroup;
    selected: boolean;
    hovered: boolean;
    priceScale: readonly RentalPriceScaleBand[];
    onSelectGroup: (key: string) => void;
    onHoverGroup: (key: string | null) => void;
}) {
    const markerRef = useRef<RentalLeafletMarker | null>(null);

    useEffect(() => {
        if (selected) markerRef.current?.openPopup();
    }, [selected]);

    return (
        <Marker
            ref={(marker) => {
                markerRef.current = marker as RentalLeafletMarker | null;
                if (markerRef.current) markerRef.current.rentalGroup = group;
            }}
            position={[group.latitude, group.longitude]}
            icon={markerIcon(group, selected, hovered, priceScale)}
            keyboard
            riseOnHover
            riseOffset={500}
            title={`${group.neighborhood || 'Rental location'}, ${compactPrice(group.lowestPrice)}`}
            eventHandlers={{
                click: () => onSelectGroup(group.key),
                mouseover: () => onHoverGroup(group.key),
                mouseout: () => onHoverGroup(null)
            }}
        >
            <Popup minWidth={252} maxWidth={300} autoPanPadding={[28, 28]}>
                <PopupContent group={group} />
            </Popup>
        </Marker>
    );
});

function summarizeCluster(cluster: L.MarkerCluster): ClusterSummary | null {
    const groups = cluster.getAllChildMarkers()
        .map((marker) => (marker as RentalLeafletMarker).rentalGroup)
        .filter((group): group is RentalGroup => Boolean(group));
    if (!groups.length) return null;
    const prices = groups.flatMap((group) => group.listings)
        .map((listing) => listing.price)
        .filter((price): price is number => price !== null && Number.isFinite(price));
    const communities = [...new Set(groups.map((group) => group.neighborhood).filter((value): value is string => Boolean(value)))];
    const propertyTypes = [...new Set(groups.flatMap((group) => group.propertyTypes))];
    return {
        position: cluster.getLatLng(),
        bounds: cluster.getBounds(),
        groups,
        listings: groups.reduce((total, group) => total + group.count, 0),
        locations: groups.length,
        minimum: prices.length ? Math.min(...prices) : null,
        maximum: prices.length ? Math.max(...prices) : null,
        average: prices.length ? prices.reduce((total, price) => total + price, 0) / prices.length : null,
        communities: communities.slice(0, 4),
        propertyTypes: propertyTypes.slice(0, 4)
    };
}

function ClusterPreviewPopup({
    summary,
    onClose,
    onShowCluster
}: {
    summary: ClusterSummary;
    onClose: () => void;
    onShowCluster: (keys: readonly string[]) => void;
}) {
    const map = useMap();

    return (
        <Popup
            position={summary.position}
            minWidth={270}
            maxWidth={320}
            autoPanPadding={[32, 32]}
            eventHandlers={{ remove: onClose }}
        >
            <article className="cluster-preview">
                <p className="cluster-preview__eyebrow">Cluster preview</p>
                <h2>{summary.listings.toLocaleString('en-AE')} rentals</h2>
                <dl>
                    <div><dt>From</dt><dd>{formatPrice(summary.minimum)}</dd></div>
                    <div><dt>Up to</dt><dd>{formatPrice(summary.maximum)}</dd></div>
                    <div><dt>Average</dt><dd>{formatPrice(summary.average)}</dd></div>
                    <div><dt>Locations</dt><dd>{summary.locations.toLocaleString('en-AE')}</dd></div>
                </dl>
                {summary.communities.length ? <p><strong>Communities</strong> {summary.communities.join(', ')}</p> : null}
                {summary.propertyTypes.length ? <p><strong>Types</strong> {summary.propertyTypes.join(', ')}</p> : null}
                <div className="cluster-preview__actions">
                    <button type="button" onClick={() => {
                        onShowCluster(summary.groups.map((group) => group.key));
                        onClose();
                    }}>Show listings</button>
                    <button type="button" className="cluster-preview__zoom" onClick={() => {
                        map.fitBounds(summary.bounds, { padding: [48, 48], animate: true, duration: 0.35 });
                        onClose();
                    }}>Zoom here</button>
                </div>
            </article>
        </Popup>
    );
}

export function RentalMap({
    city,
    groups,
    selectedGroupKey,
    hoveredGroupKey,
    focusRequest,
    theme,
    priceScale,
    onSelectGroup,
    onHoverGroup,
    onShowCluster,
    onFocusHandled,
    onViewportChange,
    onMapReady
}: RentalMapProps) {
    const [clusterPreview, setClusterPreview] = useState<ClusterSummary | null>(null);
    const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);

    const clusterIcon = useMemo(() => (cluster: L.MarkerCluster) => {
        const summary = summarizeCluster(cluster);
        const count = summary?.listings ?? cluster.getChildCount();
        const label = count > 999 ? `${Math.round(count / 1000)}K` : String(count);
        const minimum = summary?.minimum ?? null;
        const color = priceColor(summary?.average ?? minimum, priceScale);
        return L.divIcon({
            className: 'rr-cluster-shell',
            html: `<span class="rr-cluster" style="--cluster-color:${color}"><strong>${label}</strong><small>From ${minimum === null ? 'TBA' : compactPrice(minimum).replace('AED ', '')}</small></span>`,
            iconSize: [78, 62],
            iconAnchor: [39, 31]
        });
    }, [priceScale]);

    useEffect(() => {
        if (!clusterGroupRef.current) return;
        (clusterGroupRef.current.options as L.MarkerClusterGroupOptions).iconCreateFunction = clusterIcon;
        clusterGroupRef.current.refreshClusters();
    }, [clusterIcon]);

    const previewCluster = (event: L.LeafletMouseEvent) => {
        const cluster = (event as L.LeafletMouseEvent & { layer?: L.MarkerCluster }).layer;
        if (!cluster) return;
        if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
        const summary = summarizeCluster(cluster);
        if (summary) setClusterPreview(summary);
    };

    const zoomCluster = (event: L.LeafletMouseEvent) => {
        const cluster = (event as L.LeafletMouseEvent & { layer?: L.MarkerCluster }).layer;
        if (!cluster) return;
        if (event.originalEvent) {
            L.DomEvent.preventDefault(event.originalEvent);
            L.DomEvent.stopPropagation(event.originalEvent);
        }
        setClusterPreview(null);
        cluster.zoomToBounds({ padding: [48, 48] });
    };

    return (
        <MapContainer
            className="map-canvas"
            center={city.center}
            zoom={city.zoom}
            zoomControl={false}
            preferCanvas
            attributionControl
            aria-label="Rental listings map"
        >
            <TileLayer
                attribution="&copy; OpenStreetMap contributors &copy; CARTO"
                url={theme === 'dark'
                    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
                    : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'}
            />
            <ZoomControl position="bottomright" />
            <MapReference onMapReady={onMapReady} />
            <ViewportEvents onViewportChange={onViewportChange} />
            <ViewportController city={city} groups={groups} focusRequest={focusRequest} onFocusHandled={onFocusHandled} />
            <MarkerClusterGroup
                ref={clusterGroupRef}
                chunkedLoading
                showCoverageOnHover={false}
                zoomToBoundsOnClick={false}
                spiderfyOnMaxZoom={false}
                animate
                animateAddingMarkers={false}
                maxClusterRadius={58}
                iconCreateFunction={clusterIcon}
                onClick={previewCluster}
                onDblClick={zoomCluster}
            >
                {groups.map((group) => (
                    <RentalMarker
                        key={group.key}
                        group={group}
                        selected={group.key === selectedGroupKey}
                        hovered={group.key === hoveredGroupKey}
                        priceScale={priceScale}
                        onSelectGroup={onSelectGroup}
                        onHoverGroup={onHoverGroup}
                    />
                ))}
            </MarkerClusterGroup>
            {clusterPreview ? (
                <ClusterPreviewPopup
                    summary={clusterPreview}
                    onClose={() => setClusterPreview(null)}
                    onShowCluster={onShowCluster}
                />
            ) : null}
        </MapContainer>
    );
}
