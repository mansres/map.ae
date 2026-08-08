declare module '*rental-core.js' {
    export const RENTAL_PRICE_BANDS: readonly import('./rental').RentalPriceBand[];
    export function rentalPriceBandIndex(price: number | null): number;
    export function rentalPriceColor(price: number | null, fallback?: string): string;

    export function extractSearchPage(payload: unknown): import('./rental').RentalSearchPage;
    export function normalizeListing(raw: unknown, index?: number): import('./rental').RentalListing;
    export function matchesFilters(
        listing: import('./rental').RentalListing,
        filters?: {
            minimumPrice?: number | null;
            maximumPrice?: number | null;
            minPrice?: number | null;
            maxPrice?: number | null;
            bedrooms?: Iterable<number> | null;
            propertyTypes?: Iterable<string> | null;
        }
    ): boolean;
    export function groupVisibleListings(
        listings: readonly import('./rental').RentalListing[],
        filters?: object
    ): import('./rental').RentalGroup[];
    export function facetValues(listings: readonly import('./rental').RentalListing[]): import('./rental').RentalFacets;
}
