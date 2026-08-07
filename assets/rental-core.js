/**
 * Pure data helpers for Rental Radar.  Keeping these functions independent of
 * Leaflet and the DOM makes data-contract changes and filter behaviour easy to
 * verify.
 */

export const PRICE_BANDS = Object.freeze([
    { id: 'under-20', label: '\u2264 AED 20k', shortLabel: '\u226420k', max: 20000, color: '#0f766e' },
    { id: '20-30', label: 'AED 20k\u201330k', shortLabel: '20\u201330k', max: 30000, color: '#0f9e8f' },
    { id: '30-40', label: 'AED 30k\u201340k', shortLabel: '30\u201340k', max: 40000, color: '#3b82f6' },
    { id: '40-50', label: 'AED 40k\u201350k', shortLabel: '40\u201350k', max: 50000, color: '#6366f1' },
    { id: '50-60', label: 'AED 50k\u201360k', shortLabel: '50\u201360k', max: 60000, color: '#a855f7' },
    { id: '60-70', label: 'AED 60k\u201370k', shortLabel: '60\u201370k', max: 70000, color: '#e11d8a' },
    { id: 'over-70', label: 'Above AED 70k', shortLabel: '>70k', max: Infinity, color: '#e11d48' }
]);

const UAE_BOUNDS = Object.freeze({
    latitude: [22, 28.5],
    longitude: [51, 57.8]
});

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function asFiniteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function firstText(value) {
    if (typeof value === 'string') return value.trim() || null;
    if (typeof value === 'number') return String(value);
    if (Array.isArray(value)) {
        for (const item of value) {
            const text = firstText(item);
            if (text) return text;
        }
        return null;
    }
    if (value && typeof value === 'object') {
        return firstText(value.en) || firstText(value.name) || firstText(value.value) || null;
    }
    return null;
}

function propertyInfoValue(raw, id) {
    if (!Array.isArray(raw?.property_info)) return null;
    const item = raw.property_info.find((entry) => entry && entry.id === id);
    return firstText(item?.value);
}

function normalizeBedrooms(raw) {
    const direct = raw?.bedrooms;
    const numeric = asFiniteNumber(direct);
    if (numeric !== null && numeric >= 0) return Math.trunc(numeric);

    const source = firstText(direct) || firstText(raw?.bedrooms_name) || firstText(raw?.room_type);
    if (!source) return null;
    const value = source.toLowerCase();
    if (value.includes('studio')) return 0;
    const match = value.match(/\d+/);
    return match ? Number(match[0]) : null;
}

function normalizePropertyType(raw) {
    const propertyInfoType = propertyInfoValue(raw, 'property_type');
    if (propertyInfoType) return propertyInfoType;

    const categories = raw?.categories_v2 ?? raw?.categories;
    if (Array.isArray(categories)) {
        for (const category of categories) {
            const categoryName = firstText(category?.name);
            if (categoryName) return categoryName;
        }
    }
    const categoryName = firstText(categories?.name);
    if (categoryName) return categoryName;

    return firstText(raw?.category_v2?.name) || firstText(raw?.category) || null;
}

function isInUae(latitude, longitude) {
    return latitude >= UAE_BOUNDS.latitude[0]
        && latitude <= UAE_BOUNDS.latitude[1]
        && longitude >= UAE_BOUNDS.longitude[0]
        && longitude <= UAE_BOUNDS.longitude[1];
}

/**
 * Resolves both conventional `{ lat: 25, lng: 55 }` coordinates and the
 * reversed source convention found in the supplied search payload.
 */
export function normalizeCoordinates(raw) {
    const geo = raw?._geoloc ?? raw?.geoloc ?? raw?.location ?? raw;
    const first = asFiniteNumber(geo?.lat ?? geo?.latitude);
    const second = asFiniteNumber(geo?.lng ?? geo?.lon ?? geo?.longitude);
    if (first === null || second === null) return null;

    if (isInUae(first, second)) {
        return { latitude: first, longitude: second, wasReversed: false };
    }
    if (isInUae(second, first)) {
        return { latitude: second, longitude: first, wasReversed: true };
    }
    return null;
}

export function isSafeHttpUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return false;
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
        return false;
    }
}

function listingUrl(raw) {
    const candidate = firstText(raw?.absolute_url) || firstText(raw?.short_url) || null;
    return isSafeHttpUrl(candidate) ? candidate : null;
}

function imageUrl(raw) {
    const collections = [raw?.photos, raw?.images];
    for (const collection of collections) {
        if (!Array.isArray(collection)) continue;
        for (const image of collection) {
            const candidate = firstText(image?.main) || firstText(image?.thumb) || firstText(image?.url);
            if (isSafeHttpUrl(candidate)) return candidate;
        }
    }
    return null;
}

function placeLabel(raw) {
    const neighborhoods = raw?.neighborhoods;
    const neighborhood = Array.isArray(neighborhoods)
        ? firstText(neighborhoods[0]?.name) || firstText(neighborhoods[0])
        : firstText(neighborhoods?.name) || firstText(neighborhoods);
    return neighborhood
        || firstText(raw?.building?.name)
        || firstText(raw?.city?.name)
        || null;
}

/**
 * Extract a page of hits from supported search response envelopes.
 */
export function extractSearchPage(payload) {
    let result = null;
    if (Array.isArray(payload)) {
        result = payload[0] ?? null;
    } else if (payload && Array.isArray(payload.results)) {
        result = payload.results[0] ?? null;
    } else if (payload && typeof payload === 'object') {
        result = payload;
    }

    if (!result || !Array.isArray(result.hits)) {
        throw new Error('The data source returned an unsupported response format.');
    }

    const hitsPerPage = asFiniteNumber(result.hitsPerPage) ?? result.hits.length;
    const nbHits = asFiniteNumber(result.nbHits) ?? result.hits.length;
    const nbPages = Math.max(1, Math.trunc(asFiniteNumber(result.nbPages) ?? 1));
    const page = Math.max(0, Math.trunc(asFiniteNumber(result.page) ?? 0));

    return {
        hits: result.hits,
        page,
        nbHits,
        nbPages,
        hitsPerPage,
        raw: result
    };
}

export function extractHits(payload) {
    return extractSearchPage(payload).hits;
}

/**
 * Convert an API hit into a predictable record. Optional data remains null;
 * malformed values never throw during filter or render work.
 */
export function normalizeListing(raw, index = 0) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const coordinates = normalizeCoordinates(source);
    const rawPrice = asFiniteNumber(source.price ?? source.starting_price);
    const price = rawPrice !== null && rawPrice >= 0 ? rawPrice : null;
    const bedrooms = normalizeBedrooms(source);
    const idCandidate = source.objectID ?? source.id ?? source.uuid ?? source.property_reference;
    const id = idCandidate === null || idCandidate === undefined || idCandidate === ''
        ? `listing-${index}`
        : String(idCandidate);

    const title = firstText(source.name)
        || firstText(source.property_reference)
        || `${normalizePropertyType(source) || 'Rental'} listing`;

    return {
        id,
        title,
        propertyReference: firstText(source.property_reference),
        price,
        bedrooms,
        bathrooms: asFiniteNumber(source.bathrooms),
        size: asFiniteNumber(source.size),
        propertyType: normalizePropertyType(source),
        description: firstText(source.description_short) || firstText(source.description),
        neighborhood: placeLabel(source),
        paymentFrequency: firstText(source.payment_frequency),
        imageUrl: imageUrl(source),
        listingUrl: listingUrl(source),
        latitude: coordinates?.latitude ?? null,
        longitude: coordinates?.longitude ?? null,
        coordinateKey: coordinates
            ? `${coordinates.latitude.toFixed(6)},${coordinates.longitude.toFixed(6)}`
            : null,
        source
    };
}

/**
 * Price buckets are exclusive of the lower edge and inclusive of the upper
 * edge, except the first bucket which includes zero. This makes 50,000 part
 * of the 40\u201350k bucket and 50,001 part of the 50\u201360k bucket.
 */
export function priceBandIndex(price) {
    if (!isFiniteNumber(price) || price < 0) return -1;
    return PRICE_BANDS.findIndex((band) => price <= band.max);
}

export function getPriceBand(price) {
    const index = priceBandIndex(price);
    return index === -1 ? null : PRICE_BANDS[index];
}

function selectedSet(filters, name) {
    if (!filters || !Object.prototype.hasOwnProperty.call(filters, name)) return null;
    const value = filters[name];
    if (value === null || value === undefined) return null;
    if (value instanceof Set) return value;
    if (Array.isArray(value)) return new Set(value);
    return new Set();
}

function matchesSelection(value, selection) {
    return selection === null || selection.has(value);
}

function filterNumber(filters, names) {
    if (!filters) return null;
    for (const name of names) {
        if (!Object.prototype.hasOwnProperty.call(filters, name)) continue;
        const value = asFiniteNumber(filters[name]);
        if (value !== null) return value;
    }
    return null;
}

/**
 * Missing filter sets mean unrestricted. An explicitly empty set means the
 * user cleared that facet and therefore nothing can match it.
 */
export function matchesFilters(listing, filters = {}) {
    if (!listing) return false;
    const bands = selectedSet(filters, 'priceBands');
    const types = selectedSet(filters, 'propertyTypes');
    const bedrooms = selectedSet(filters, 'bedrooms');
    const minimumPrice = filterNumber(filters, ['minimumPrice', 'minPrice']);
    const maximumPrice = filterNumber(filters, ['maximumPrice', 'maxPrice']);

    const band = priceBandIndex(listing.price);
    if (!matchesSelection(band, bands)) return false;
    if (!matchesSelection(listing.propertyType, types)) return false;
    if (!matchesSelection(listing.bedrooms, bedrooms)) return false;
    if (minimumPrice !== null && (listing.price === null || listing.price < minimumPrice)) return false;
    if (maximumPrice !== null && (listing.price === null || listing.price > maximumPrice)) return false;
    return true;
}

function uniqueValues(values) {
    return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ''))];
}

/**
 * Group only listings that already match active filters. Listings without
 * map-safe coordinates are deliberately excluded from map location groups.
 */
export function groupVisibleListings(listings, filters = {}) {
    const groups = new Map();
    for (const listing of listings ?? []) {
        if (!matchesFilters(listing, filters) || !listing?.coordinateKey) continue;
        const existing = groups.get(listing.coordinateKey);
        if (existing) {
            existing.listings.push(listing);
        } else {
            groups.set(listing.coordinateKey, {
                key: listing.coordinateKey,
                latitude: listing.latitude,
                longitude: listing.longitude,
                listings: [listing]
            });
        }
    }

    return [...groups.values()].map((group) => {
        const pricedListings = group.listings.filter((listing) => listing.price !== null);
        const lowestPrice = pricedListings.length
            ? Math.min(...pricedListings.map((listing) => listing.price))
            : null;
        const representative = [...group.listings].sort((left, right) => {
            const leftPrice = left.price ?? Number.POSITIVE_INFINITY;
            const rightPrice = right.price ?? Number.POSITIVE_INFINITY;
            return leftPrice - rightPrice || left.title.localeCompare(right.title);
        })[0];

        return {
            ...group,
            count: group.listings.length,
            lowestPrice,
            priceBandIndex: priceBandIndex(lowestPrice),
            propertyTypes: uniqueValues(group.listings.map((listing) => listing.propertyType)),
            bedrooms: uniqueValues(group.listings.map((listing) => listing.bedrooms)).sort((a, b) => a - b),
            neighborhood: representative?.neighborhood ?? null,
            imageUrl: representative?.imageUrl ?? null,
            representative
        };
    }).sort((left, right) => {
        const leftPrice = left.lowestPrice ?? Number.POSITIVE_INFINITY;
        const rightPrice = right.lowestPrice ?? Number.POSITIVE_INFINITY;
        return leftPrice - rightPrice || right.count - left.count || left.key.localeCompare(right.key);
    });
}

export function medianPrice(listings) {
    const values = (listings ?? [])
        .map((listing) => listing?.price)
        .filter((price) => isFiniteNumber(price))
        .sort((left, right) => left - right);
    if (!values.length) return null;
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle] : Math.round((values[middle - 1] + values[middle]) / 2);
}

export function facetValues(listings) {
    const propertyTypes = new Map();
    const bedrooms = new Map();
    for (const listing of listings ?? []) {
        if (listing?.propertyType) {
            propertyTypes.set(listing.propertyType, (propertyTypes.get(listing.propertyType) ?? 0) + 1);
        }
        if (listing?.bedrooms !== null && listing?.bedrooms !== undefined) {
            bedrooms.set(listing.bedrooms, (bedrooms.get(listing.bedrooms) ?? 0) + 1);
        }
    }
    return {
        propertyTypes: [...propertyTypes.entries()]
            .map(([value, count]) => ({ value, count }))
            .sort((left, right) => left.value.localeCompare(right.value)),
        bedrooms: [...bedrooms.entries()]
            .map(([value, count]) => ({ value, count }))
            .sort((left, right) => left.value - right.value)
    };
}
