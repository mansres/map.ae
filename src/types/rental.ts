/**
 * Shared domain types for the Rental Radar client.  The legacy data helper
 * deliberately preserves optional fields as null, so view components never
 * need to guess whether a property has a value.
 */

export type RentalDataStatus = 'loading' | 'partial' | 'error' | 'ready';

export interface RentalCity {
    id: string;
    label: string;
    /** Mutable tuple to interoperate directly with Leaflet's LatLngTuple. */
    center: [latitude: number, longitude: number];
    zoom: number;
}

export interface RentalListing {
    id: string;
    title: string;
    propertyReference: string | null;
    price: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
    size: number | null;
    propertyType: string | null;
    description: string | null;
    neighborhood: string | null;
    paymentFrequency: string | null;
    imageUrl: string | null;
    listingUrl: string | null;
    latitude: number | null;
    longitude: number | null;
    coordinateKey: string | null;
    source: Record<string, unknown>;
}

export interface RentalGroup {
    key: string;
    latitude: number;
    longitude: number;
    listings: readonly RentalListing[];
    count: number;
    lowestPrice: number | null;
    propertyTypes: readonly string[];
    bedrooms: readonly number[];
    neighborhood: string | null;
    imageUrl: string | null;
    representative: RentalListing | null;
}

export interface RentalMapBounds {
    north: number;
    south: number;
    east: number;
    west: number;
}

export interface RentalPriceScaleBand {
    index: number;
    color: string;
    minimum: number;
    maximum: number;
}

export interface RentalFacet<TValue extends string | number> {
    value: TValue;
    count: number;
}

export interface RentalFacets {
    bedrooms: readonly RentalFacet<number>[];
    propertyTypes: readonly RentalFacet<string>[];
}

/**
 * A null facet selection means "Any". An empty array is intentionally
 * distinct: it means the user explicitly deselected every value.
 */
export interface RentalFilters {
    minPrice: number | null;
    maxPrice: number | null;
    bedrooms: readonly number[] | null;
    propertyTypes: readonly string[] | null;
    searchTerm: string;
}

export interface RentalFilterPatch {
    minPrice?: number | string | null;
    maxPrice?: number | string | null;
    bedrooms?: Iterable<number> | null;
    propertyTypes?: Iterable<string> | null;
    searchTerm?: string | null;
}

export interface RentalSearchPage {
    hits: readonly unknown[];
    page: number;
    nbHits: number;
    nbPages: number;
    hitsPerPage: number;
    raw: unknown;
}

export interface RentalSearchRequestPayload {
    requests: Array<{
        indexName: string;
        query: string;
        params: string;
    }>;
}
