import { memo, useEffect } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer, ZoomControl, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';

import type { RentalCity as City, RentalGroup } from '../types/rental';

type RentalMapProps = {
    city: City;
    groups: RentalGroup[];
    selectedGroupKey: string | null;
    focusRequest: { key: string; id: number } | null;
    theme: 'light' | 'dark';
    onSelectGroup: (key: string) => void;
    onFocusHandled: (id: number) => void;
    onMapReady: (map: LeafletMap) => void;
};

const markerBands = ['low', 'low', 'mid-low', 'mid', 'mid-high', 'high', 'high'];

function compactPrice(value: number | null) {
    if (value === null || !Number.isFinite(value)) return 'TBA';
    if (value >= 1_000_000) return `AED ${(value / 1_000_000).toFixed(1)}M`;
    return `AED ${Math.round(value / 1000)}k`;
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

function markerIcon(group: RentalGroup, selected: boolean) {
    const band = group.priceBandIndex >= 0 ? group.priceBandIndex : 0;
    const bandName = markerBands[band] ?? markerBands[0];
    const count = group.count > 1 ? `<span class="rr-marker__count">${group.count > 999 ? `${Math.round(group.count / 1000)}k` : group.count}</span>` : '';
    return L.divIcon({
        className: 'rr-marker-shell',
        html: `<span class="rr-marker${selected ? ' is-selected' : ''}" data-band="${bandName}"><span class="rr-marker__price">${compactPrice(group.lowestPrice)}</span>${count}</span>`,
        iconSize: [74, 48],
        iconAnchor: [37, 44],
        popupAnchor: [0, -40]
    });
}

function ViewportController({
    city,
    groups,
    focusRequest,
    onFocusHandled
}: {
    city: City;
    groups: RentalGroup[];
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
                <p className="popup-card__eyebrow">{group.count} matching rental{group.count === 1 ? '' : 's'}</p>
                <h2>{group.neighborhood || listing?.title || 'Rental location'}</h2>
                <strong>{group.lowestPrice === null ? 'Price on request' : `From ${formatPrice(group.lowestPrice)}`}</strong>
                {meta.length ? <p>{meta.join(' · ')}</p> : null}
                {listing?.listingUrl ? (
                    <a href={listing.listingUrl} target="_blank" rel="noopener noreferrer">View listing</a>
                ) : null}
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
                    {group.listings.length > 6 ? <p className="popup-card__more">+{group.listings.length - 6} more matching rentals</p> : null}
                </div>
            ) : null}
        </article>
    );
}

const RentalMarker = memo(function RentalMarker({
    group,
    selected,
    onSelectGroup
}: {
    group: RentalGroup;
    selected: boolean;
    onSelectGroup: (key: string) => void;
}) {
    return (
        <Marker
            position={[group.latitude, group.longitude]}
            icon={markerIcon(group, selected)}
            keyboard
            title={`${group.neighborhood || 'Rental location'}, ${compactPrice(group.lowestPrice)}`}
            eventHandlers={{
                click: () => onSelectGroup(group.key),
                mouseover: () => onSelectGroup(group.key)
            }}
        >
            <Popup minWidth={252} maxWidth={300} autoPanPadding={[28, 28]}>
                <PopupContent group={group} />
            </Popup>
        </Marker>
    );
});

export function RentalMap({ city, groups, selectedGroupKey, focusRequest, theme, onSelectGroup, onFocusHandled, onMapReady }: RentalMapProps) {

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
                url={`https://{s}.basemaps.cartocdn.com/${theme === 'dark' ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`}
            />
            <ZoomControl position="bottomright" />
            <MapReference onMapReady={onMapReady} />
            <ViewportController city={city} groups={groups} focusRequest={focusRequest} onFocusHandled={onFocusHandled} />
            <MarkerClusterGroup
                chunkedLoading
                showCoverageOnHover={false}
                maxClusterRadius={58}
                iconCreateFunction={(cluster) => {
                    const count = cluster.getChildCount();
                    const label = count > 999 ? `${Math.round(count / 1000)}k` : String(count);
                    return L.divIcon({
                        className: 'rr-cluster-shell',
                        html: `<span class="rr-cluster"><strong>${label}</strong><small>areas</small></span>`,
                        iconSize: [58, 58],
                        iconAnchor: [29, 29]
                    });
                }}
            >
                {groups.map((group) => <RentalMarker
                    key={group.key}
                    group={group}
                    selected={group.key === selectedGroupKey}
                    onSelectGroup={onSelectGroup}
                />)}
            </MarkerClusterGroup>
        </MapContainer>
    );
}
