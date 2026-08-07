declare module '*rental-core.js' {
    export const PERCENTAGE_PRICE_COLORS: readonly string[];
    export function createPercentagePriceScale(
        minimum: number,
        maximum: number
    ): import('./rental').RentalPriceScaleBand[];
    export function percentagePriceBandIndex(
        price: number | null,
        minimum: number,
        maximum: number
    ): number;

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
