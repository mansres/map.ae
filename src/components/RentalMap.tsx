import { memo, useEffect, useState } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import L from 'leaflet';
import {
    LayersControl,
    MapContainer,
    Marker,
    Popup,
    TileLayer,
    useMap,
    useMapEvents
} from 'react-leaflet';

import { rentalPriceColor } from '../../assets/rental-core.js';
import type { RentalCity as City, RentalGroup, RentalMapBounds } from '../types/rental';

const POPUP_LISTING_BATCH_SIZE = 20;

type RentalMapProps = {
    city: City;
    groups: readonly RentalGroup[];
    onViewportChange: (bounds: RentalMapBounds) => void;
    onMapReady: (map: LeafletMap) => void;
};

function compactPrice(value: number | null) {
    if (value === null || !Number.isFinite(value)) return 'Price TBA';
    if (value >= 1_000_000) return `AED ${(value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0)}M`;
    return `AED ${Math.round(value / 1_000)}K`;
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

function markerIcon(group: RentalGroup) {
    const color = rentalPriceColor(group.lowestPrice);
    const count = group.count > 1
        ? `<span class="rr-marker__count">${group.count > 999 ? `${Math.round(group.count / 1_000)}K` : group.count}</span>`
        : '';
    return L.divIcon({
        className: 'rr-marker-shell',
        html: `<span class="rr-marker" style="--marker-color:${color}"><span class="rr-marker__price">${compactPrice(group.lowestPrice)}</span>${count}</span>`,
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

function ViewportEvents({ onViewportChange }: Pick<RentalMapProps, 'onViewportChange'>) {
    const map = useMapEvents({
        moveend: () => onViewportChange(toBounds(map.getBounds()))
    });

    useEffect(() => {
        onViewportChange(toBounds(map.getBounds()));
    }, [map, onViewportChange]);

    return null;
}

function MapReference({ onMapReady }: Pick<RentalMapProps, 'onMapReady'>) {
    const map = useMap();
    useEffect(() => onMapReady(map), [map, onMapReady]);
    return null;
}

function CityController({ city }: { city: City }) {
    const map = useMap();

    useEffect(() => {
        map.flyTo(city.center, city.zoom, { animate: true, duration: 0.45 });
    }, [city.center, city.id, city.zoom, map]);

    return null;
}

function PopupContent({ group }: { group: RentalGroup }) {
    const listing = group.representative;
    const [visibleListingCount, setVisibleListingCount] = useState(POPUP_LISTING_BATCH_SIZE);
    const detailListings = group.listings.slice(1);
    const visibleListings = detailListings.slice(0, visibleListingCount);
    const remainingCount = Math.max(0, detailListings.length - visibleListingCount);
    const nextBatchCount = Math.min(POPUP_LISTING_BATCH_SIZE, remainingCount);

    useEffect(() => {
        setVisibleListingCount(POPUP_LISTING_BATCH_SIZE);
    }, [group.key]);

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
            {detailListings.length ? (
                <div className="popup-card__list" aria-label="Listings at this location">
                    {visibleListings.map((child) => (
                        <div className="popup-card__listing" key={child.id}>
                            <span>{child.title}</span>
                            <strong>{formatPrice(child.price)}</strong>
                            {child.size ? <small>{Math.round(child.size).toLocaleString('en-AE')} sqft</small> : null}
                            {child.listingUrl ? <a href={child.listingUrl} target="_blank" rel="noopener noreferrer">View</a> : null}
                        </div>
                    ))}
                    {remainingCount ? (
                        <button
                            className="popup-card__more"
                            type="button"
                            onClick={() => setVisibleListingCount((current) => current + POPUP_LISTING_BATCH_SIZE)}
                        >
                            +{nextBatchCount} more rental{nextBatchCount === 1 ? '' : 's'}
                        </button>
                    ) : null}
                </div>
            ) : null}
        </article>
    );
}

const RentalMarker = memo(function RentalMarker({ group }: { group: RentalGroup }) {
    return (
        <Marker
            position={[group.latitude, group.longitude]}
            icon={markerIcon(group)}
            keyboard
            riseOnHover
            riseOffset={500}
            title={`${group.neighborhood || 'Rental location'}, ${compactPrice(group.lowestPrice)}`}
        >
            <Popup minWidth={252} maxWidth={300} autoPanPadding={[28, 28]}>
                <PopupContent group={group} />
            </Popup>
        </Marker>
    );
});

export function RentalMap({ city, groups, onViewportChange, onMapReady }: RentalMapProps) {
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
            <LayersControl position="topright">
                <LayersControl.BaseLayer checked name="Detailed Streets (Default)">
                    <TileLayer
                        attribution="&copy; OpenStreetMap contributors"
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        maxZoom={19}
                    />
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="Light Mode">
                    <TileLayer
                        attribution="&copy; OpenStreetMap contributors &copy; CARTO"
                        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                        maxZoom={20}
                    />
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="Dark Mode">
                    <TileLayer
                        attribution="&copy; OpenStreetMap contributors &copy; CARTO"
                        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                        maxZoom={20}
                    />
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="Satellite 3D">
                    <TileLayer
                        attribution="Tiles &copy; Esri"
                        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                        maxZoom={19}
                    />
                </LayersControl.BaseLayer>
            </LayersControl>

            <MapReference onMapReady={onMapReady} />
            <CityController city={city} />
            <ViewportEvents onViewportChange={onViewportChange} />
            {groups.map((group) => <RentalMarker key={group.key} group={group} />)}
        </MapContainer>
    );
}
