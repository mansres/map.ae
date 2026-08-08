import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { extractSearchPage, facetValues, groupVisibleListings, normalizeListing } from '../../assets/rental-core.js';
import type {
    RentalCity,
    RentalDataStatus,
    RentalFacets,
    RentalFilters,
    RentalGroup,
    RentalListing,
    RentalSearchPage,
    RentalSearchRequestPayload
} from '../types/rental';

export type { RentalGroup, RentalListing } from '../types/rental';
export type City = RentalCity;

const DEFAULT_ENDPOINT = 'https://rmi.mansoor-infos.workers.dev';
const SEARCH_INDEX = 'property-for-rent-residential.com';
const PAGE_CONCURRENCY = 3;
export const RENTAL_PRICE_LIMITS = Object.freeze({ minimum: 0, maximum: 1_000_000 });

const RETRIEVED_ATTRIBUTES = Object.freeze([
    'id', 'objectID', 'uuid', 'name', 'property_reference', 'price', 'bedrooms', 'bathrooms',
    'size', 'property_info', 'categories', 'categories_v2', 'category_v2', 'city', 'building',
    'neighborhoods', 'photos', 'images', 'absolute_url', 'short_url', 'description_short',
    'description', '_geoloc', 'payment_frequency', 'room_type'
]);

export const CITIES = Object.freeze([
    { id: '0', label: 'All Emirates', center: [24.84, 55.46] as [number, number], zoom: 8 },
    { id: '2', label: 'Dubai', center: [25.2048, 55.2708] as [number, number], zoom: 11 },
    { id: '3', label: 'Abu Dhabi', center: [24.4539, 54.3773] as [number, number], zoom: 11 },
    { id: '12', label: 'Sharjah', center: [25.3573, 55.3911] as [number, number], zoom: 11 },
    { id: '14', label: 'Ajman', center: [25.4111, 55.4353] as [number, number], zoom: 11 },
    { id: '11', label: 'Ras Al Khaimah', center: [25.7891, 55.9376] as [number, number], zoom: 11 },
    { id: '13', label: 'Fujairah', center: [25.1232, 56.3269] as [number, number], zoom: 11 },
    { id: '15', label: 'Umm Al Quwain', center: [25.5651, 55.5532] as [number, number], zoom: 11 },
    { id: '39', label: 'Al Ain', center: [24.2075, 55.7447] as [number, number], zoom: 11 }
] satisfies readonly RentalCity[]);

export const DEFAULT_CITY_ID = '2';
export const DEFAULT_RENTAL_FILTERS: Readonly<RentalFilters> = Object.freeze({
    maxPrice: 47_000,
    bedrooms: Object.freeze([1]),
    propertyTypes: null
});

export type RentalFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface UseRentalDataOptions {
    /** Override only for a controlled environment or tests. */
    endpoint?: string;
    /** Defaults to Dubai; retained for controlled embedding and tests. */
    initialCityId?: string;
    fetcher?: RentalFetch;
    /** Useful for tests or a server-rendered shell. Defaults to true. */
    autoLoad?: boolean;
}

export interface UseRentalDataResult {
    city: RentalCity;
    refresh: () => void;
    retry: () => void;
    listings: readonly RentalListing[];
    groups: readonly RentalGroup[];
    facets: RentalFacets;
    filters: RentalFilters;
    setFilters: (patch: Partial<RentalFilters>) => void;
    resetFilters: () => void;
    status: RentalDataStatus;
    isLoading: boolean;
    error: Error | null;
    loadedCount: number;
    expectedHits: number;
    failedPages: readonly number[];
}

interface DataSnapshot {
    listings: RentalListing[];
    expectedHits: number;
    expectedPages: number;
    loadedPages: number[];
    failedPages: number[];
    status: RentalDataStatus;
    isLoading: boolean;
    error: Error | null;
}

interface LoadSession {
    generation: number;
    cityId: string;
    controller: AbortController;
    listings: RentalListing[];
    seenIds: Set<string>;
    loadedPages: Set<number>;
    failedPages: Set<number>;
    errors: Map<number, Error>;
    expectedHits: number;
    expectedPages: number;
    isLoading: boolean;
}

function resolveEndpoint() {
    const configured = typeof window === 'undefined'
        ? null
        : (window as Window & { RENTAL_RADAR_API_URL?: unknown }).RENTAL_RADAR_API_URL;
    return typeof configured === 'string' && configured.trim() ? configured.trim() : DEFAULT_ENDPOINT;
}

const defaultFetch: RentalFetch = (input, init) => {
    if (typeof globalThis.fetch !== 'function') {
        return Promise.reject(new Error('Fetch is unavailable in this environment.'));
    }
    return globalThis.fetch(input, init);
};

function createEmptySnapshot(): DataSnapshot {
    return {
        listings: [],
        expectedHits: 0,
        expectedPages: 0,
        loadedPages: [],
        failedPages: [],
        status: 'loading',
        isLoading: true,
        error: null
    };
}

function cityForId(value: string | null | undefined): RentalCity {
    return CITIES.find((city) => city.id === String(value))
        ?? CITIES.find((city) => city.id === DEFAULT_CITY_ID)!;
}

function statusFor(session: LoadSession): RentalDataStatus {
    if (session.isLoading) return 'loading';
    if (session.loadedPages.size === 0 && session.failedPages.has(0)) return 'error';
    return session.failedPages.size > 0 ? 'partial' : 'ready';
}

function firstError(session: LoadSession) {
    return [...session.errors.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, error]) => error)[0] ?? null;
}

function asError(error: unknown) {
    if (error instanceof Error) return error;
    return new Error(typeof error === 'string' ? error : 'The rental data could not be loaded.');
}

function isAbortError(error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') return true;
    return typeof error === 'object' && error !== null
        && ('name' in error && (error as { name?: unknown }).name === 'AbortError'
            || 'code' in error && (error as { code?: unknown }).code === 20);
}

/** Kept public so contract tests can inspect the Algolia-compatible request. */
export function buildRentalSearchPayload(cityId: string, page: number): RentalSearchRequestPayload {
    const filters = [
        '("categories_v2.slug_paths":"property-for-rent/residential")',
        `(price:${RENTAL_PRICE_LIMITS.minimum} TO ${RENTAL_PRICE_LIMITS.maximum})`
    ];
    if (cityId !== '0') filters.push(`("city.id"=${cityId})`);

    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('hitsPerPage', '1000');
    params.set('attributesToHighlight', '[]');
    params.set('attributesToRetrieve', JSON.stringify(RETRIEVED_ATTRIBUTES));
    params.set('facets', '[]');
    params.set('filters', filters.join(' AND '));

    return {
        requests: [{
            indexName: SEARCH_INDEX,
            query: '',
            params: params.toString().replace(/\+/g, '%20')
        }]
    };
}

async function fetchRentalSearchPage(
    endpoint: string,
    cityId: string,
    page: number,
    signal: AbortSignal,
    fetcher: RentalFetch
): Promise<RentalSearchPage> {
    const response = await fetcher(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRentalSearchPayload(cityId, page)),
        signal
    });
    if (!response.ok) {
        const suffix = response.statusText ? `: ${response.statusText}` : '';
        throw new Error(`HTTP ${response.status}${suffix}`);
    }
    return extractSearchPage(await response.json());
}

function acceptPage(session: LoadSession, page: RentalSearchPage) {
    if (session.loadedPages.has(page.page)) return;

    session.loadedPages.add(page.page);
    session.failedPages.delete(page.page);
    session.errors.delete(page.page);
    const pageStart = page.page * Math.max(1, page.hitsPerPage);

    for (let index = 0; index < page.hits.length; index += 1) {
        try {
            const listing = normalizeListing(page.hits[index], pageStart + index);
            if (!session.seenIds.has(listing.id)) {
                session.seenIds.add(listing.id);
                session.listings.push(listing);
            }
        } catch {
            // A malformed hit must not make a useful page unusable.
        }
    }
}

function cloneForRetry(session: LoadSession, generation: number): LoadSession {
    return {
        generation,
        cityId: session.cityId,
        controller: new AbortController(),
        listings: [...session.listings],
        seenIds: new Set(session.seenIds),
        loadedPages: new Set(session.loadedPages),
        failedPages: new Set(session.failedPages),
        errors: new Map(session.errors),
        expectedHits: session.expectedHits,
        expectedPages: session.expectedPages,
        isLoading: true
    };
}

export function useRentalData(options: UseRentalDataOptions = {}): UseRentalDataResult {
    const endpoint = options.endpoint?.trim() || resolveEndpoint();
    const fetcher = options.fetcher ?? defaultFetch;
    const city = cityForId(options.initialCityId ?? DEFAULT_CITY_ID);
    const [data, setData] = useState<DataSnapshot>(createEmptySnapshot);
    const [filters, setFiltersState] = useState<RentalFilters>(() => ({
        maxPrice: DEFAULT_RENTAL_FILTERS.maxPrice,
        bedrooms: [...(DEFAULT_RENTAL_FILTERS.bedrooms ?? [])],
        propertyTypes: null
    }));
    const sessionRef = useRef<LoadSession | null>(null);
    const generationRef = useRef(0);

    const isCurrentSession = useCallback((session: LoadSession) => {
        return sessionRef.current === session && !session.controller.signal.aborted;
    }, []);

    const publish = useCallback((session: LoadSession) => {
        if (!isCurrentSession(session)) return;
        setData({
            listings: [...session.listings],
            expectedHits: session.expectedHits,
            expectedPages: session.expectedPages,
            loadedPages: [...session.loadedPages].sort((left, right) => left - right),
            failedPages: [...session.failedPages].sort((left, right) => left - right),
            status: statusFor(session),
            isLoading: session.isLoading,
            error: firstError(session)
        });
    }, [isCurrentSession]);

    const stopCurrentSession = useCallback(() => {
        const active = sessionRef.current;
        if (active && !active.controller.signal.aborted) active.controller.abort();
        sessionRef.current = null;
    }, []);

    const loadPages = useCallback(async (session: LoadSession, pages: readonly number[]) => {
        let nextPageIndex = 0;
        const worker = async () => {
            while (isCurrentSession(session) && nextPageIndex < pages.length) {
                const pageNumber = pages[nextPageIndex];
                nextPageIndex += 1;
                try {
                    const page = await fetchRentalSearchPage(
                        endpoint,
                        session.cityId,
                        pageNumber,
                        session.controller.signal,
                        fetcher
                    );
                    if (!isCurrentSession(session)) return;
                    acceptPage(session, page);
                    publish(session);
                } catch (error) {
                    if (isAbortError(error) || !isCurrentSession(session)) return;
                    session.failedPages.add(pageNumber);
                    session.errors.set(pageNumber, asError(error));
                    publish(session);
                }
            }
        };

        await Promise.all(
            Array.from({ length: Math.min(PAGE_CONCURRENCY, pages.length) }, () => worker())
        );
    }, [endpoint, fetcher, isCurrentSession, publish]);

    const startFullLoad = useCallback(() => {
        stopCurrentSession();

        const session: LoadSession = {
            generation: generationRef.current + 1,
            cityId: city.id,
            controller: new AbortController(),
            listings: [],
            seenIds: new Set(),
            loadedPages: new Set(),
            failedPages: new Set(),
            errors: new Map(),
            expectedHits: 0,
            expectedPages: 0,
            isLoading: true
        };
        generationRef.current = session.generation;
        sessionRef.current = session;
        setData(createEmptySnapshot());

        void (async () => {
            try {
                const firstPage = await fetchRentalSearchPage(
                    endpoint,
                    city.id,
                    0,
                    session.controller.signal,
                    fetcher
                );
                if (!isCurrentSession(session)) return;

                session.expectedHits = firstPage.nbHits;
                session.expectedPages = firstPage.nbPages;
                acceptPage(session, firstPage);
                publish(session);

                if (firstPage.nbPages > 1) {
                    const pages = Array.from({ length: firstPage.nbPages - 1 }, (_, index) => index + 1);
                    await loadPages(session, pages);
                }
                if (!isCurrentSession(session)) return;
                session.isLoading = false;
                publish(session);
            } catch (error) {
                if (isAbortError(error) || !isCurrentSession(session)) return;
                session.failedPages.add(0);
                session.errors.set(0, asError(error));
                session.isLoading = false;
                publish(session);
            }
        })();

        return session;
    }, [city.id, endpoint, fetcher, isCurrentSession, loadPages, publish, stopCurrentSession]);

    useEffect(() => {
        if (options.autoLoad === false) return undefined;
        const session = startFullLoad();
        return () => {
            if (sessionRef.current === session && !session.controller.signal.aborted) {
                session.controller.abort();
                sessionRef.current = null;
            }
        };
    }, [options.autoLoad, startFullLoad]);

    const refresh = useCallback(() => {
        startFullLoad();
    }, [startFullLoad]);

    const retry = useCallback(() => {
        const prior = sessionRef.current;
        if (!prior || prior.isLoading || prior.failedPages.size === 0 || prior.failedPages.has(0)) {
            refresh();
            return;
        }

        const retryPages = [...prior.failedPages].sort((left, right) => left - right);
        prior.controller.abort();
        const session = cloneForRetry(prior, generationRef.current + 1);
        generationRef.current = session.generation;
        sessionRef.current = session;
        publish(session);

        void (async () => {
            await loadPages(session, retryPages);
            if (!isCurrentSession(session)) return;
            session.isLoading = false;
            publish(session);
        })();
    }, [isCurrentSession, loadPages, publish, refresh]);

    const setFilters = useCallback((patch: Partial<RentalFilters>) => {
        setFiltersState((current) => ({
            ...current,
            ...patch,
            bedrooms: patch.bedrooms === undefined ? current.bedrooms : patch.bedrooms ? [...patch.bedrooms] : null,
            propertyTypes: patch.propertyTypes === undefined
                ? current.propertyTypes
                : patch.propertyTypes ? [...patch.propertyTypes] : null
        }));
    }, []);

    const resetFilters = useCallback(() => {
        setFiltersState({
            maxPrice: DEFAULT_RENTAL_FILTERS.maxPrice,
            bedrooms: [...(DEFAULT_RENTAL_FILTERS.bedrooms ?? [])],
            propertyTypes: null
        });
    }, []);

    const facets = useMemo<RentalFacets>(() => facetValues(data.listings), [data.listings]);
    const groups = useMemo<RentalGroup[]>(() => groupVisibleListings(data.listings, {
        maximumPrice: filters.maxPrice,
        bedrooms: filters.bedrooms,
        propertyTypes: filters.propertyTypes
    }), [data.listings, filters]);

    return {
        city,
        refresh,
        retry,
        listings: data.listings,
        groups,
        facets,
        filters,
        setFilters,
        resetFilters,
        status: data.status,
        isLoading: data.isLoading,
        error: data.error,
        loadedCount: data.listings.length,
        expectedHits: data.expectedHits,
        failedPages: data.failedPages
    };
}
