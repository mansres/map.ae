import type { ReactNode } from 'react';
import { Heart, MapPin, Maximize2, MoveUpRight } from 'lucide-react';

import type { RentalGroup } from '../types/rental';

type PropertyCardProps = {
    group: RentalGroup;
    selected?: boolean;
    hovered?: boolean;
    compact?: boolean;
    favorite?: boolean;
    onSelect: (key: string) => void;
    onHover?: (key: string | null) => void;
    onToggleFavorite: (key: string) => void;
};

function formatPrice(value: number | null) {
    if (value === null || !Number.isFinite(value)) return 'Price on request';
    return new Intl.NumberFormat('en-AE', {
        style: 'currency',
        currency: 'AED',
        maximumFractionDigits: 0
    }).format(value);
}

function bedroomLabel(value: number | null | undefined) {
    if (value === 0) return 'Studio';
    if (value === null || value === undefined) return null;
    return `${value} bed${value === 1 ? '' : 's'}`;
}

function Meta({ children }: { children: ReactNode }) {
    return <span className="listing-meta">{children}</span>;
}

export function PropertyCard({ group, selected = false, hovered = false, compact = false, favorite = false, onSelect, onHover, onToggleFavorite }: PropertyCardProps) {
    const listing = group.representative;
    const meta = [
        bedroomLabel(listing?.bedrooms),
        listing?.bathrooms ? `${listing.bathrooms} bath${listing.bathrooms === 1 ? '' : 's'}` : null,
        listing?.size ? `${Math.round(listing.size).toLocaleString('en-AE')} sqft` : null
    ].filter(Boolean);
    const title = group.neighborhood || listing?.title || 'Rental location';

    return (
        <article
            className={`property-card${selected ? ' property-card--selected is-selected' : ''}${hovered ? ' is-hovered' : ''}${compact ? ' property-card--compact' : ''}`}
            onPointerEnter={() => onHover?.(group.key)}
            onPointerLeave={() => onHover?.(null)}
            onFocusCapture={() => onHover?.(group.key)}
            onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onHover?.(null);
            }}
        >
            <button
                type="button"
                className="property-card__media"
                onClick={() => onSelect(group.key)}
                aria-label={`Show ${title} on the map`}
            >
                {group.imageUrl ? (
                    <img src={group.imageUrl} alt="" loading="lazy" />
                ) : (
                    <span className="property-card__image-fallback" aria-hidden="true"><Maximize2 size={18} /></span>
                )}
                {group.count > 1 ? <span className="property-card__count">{group.count} listings</span> : null}
            </button>
            <button type="button" className="property-card__body" onClick={() => onSelect(group.key)}>
                <span className="property-card__price">
                    {group.lowestPrice === null ? 'Price on request' : `From ${formatPrice(group.lowestPrice)}`}
                </span>
                <h3 className="property-card__title">{title}</h3>
                {meta.length ? <p className="property-card__meta">{meta.map((item, index) => <Meta key={`${String(item)}-${index}`}>{item}</Meta>)}</p> : null}
                {listing?.propertyType ? <p className="property-card__type">{listing.propertyType}</p> : null}
            </button>
            <div className="property-card__actions">
                <button
                    type="button"
                    className={`favorite-button${favorite ? ' is-active' : ''}`}
                    onClick={() => onToggleFavorite(group.key)}
                    aria-label={favorite ? `Remove ${title} from saved rentals` : `Save ${title}`}
                    aria-pressed={favorite}
                >
                    <Heart size={17} fill={favorite ? 'currentColor' : 'none'} />
                </button>
                <button type="button" className="property-card__map-action" onClick={() => onSelect(group.key)}>
                    <MapPin size={15} /> Map
                </button>
                {listing?.listingUrl ? (
                    <a href={listing.listingUrl} target="_blank" rel="noopener noreferrer" className="property-card__link">
                        View <MoveUpRight size={14} />
                    </a>
                ) : null}
            </div>
        </article>
    );
}
