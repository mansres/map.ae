import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    extractSearchPage,
    facetValues,
    groupVisibleListings,
    matchesFilters,
    normalizeListing
} from '../../assets/rental-core.js';
import type {
    RentalCity,
    RentalDataStatus,
    RentalFacets,
    RentalFilterPatch,
    RentalFilters,
    RentalGroup,
    RentalListing,
    RentalSearchPage,
    RentalSearchRequestPayload
} from '../types/rental';

export type { RentalFacets, RentalFilters, RentalGroup, RentalListing } from '../types/rental';
export type City = RentalCity;

const DEFAULT_ENDPOINT = 'https://rmi.mansoor-infos.workers.dev';
const SEARCH_INDEX = 'property-for-rent-residential.com';
const PAGE_CONCURRENCY = 3;
const SOURCE_PRICE_LIMITS = Object.freeze({ minimum: 10_000, maximum: 80_000 });

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

export type RentalFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface UseRentalDataOptions {
    /** Override only for a controlled environment or tests. */
    endpoint?: string;
    initialCityId?: string;
    fetcher?: RentalFetch;
    /** Useful for tests or a server-rendered shell. Defaults to true. */
    autoLoad?: boolean;
}

export interface UseRentalDataResult {
    cities: readonly RentalCity[];
    cityId: string;
    city: RentalCity;
    setCityId: (cityId: string) => void;
    refresh: () => void;
    retry: () => void;

    listings: readonly RentalListing[];
    visibleListings: readonly RentalListing[];
    groups: readonly RentalGroup[];
    /** Alias that makes the relationship to the filtered collection explicit. */
    groupedVisibleListings: readonly RentalGroup[];
    facets: RentalFacets;
    visibleFacets: RentalFacets;

    filters: RentalFilters;
    setFilters: (patch: RentalFilterPatch) => void;
    setMinPrice: (value: number | string | null) => void;
    setMaxPrice: (value: number | string | null) => void;
    setBedrooms: (values: Iterable<number> | null) => void;
    toggleBedroom: (bedrooms: number) => void;
    clearBedrooms: () => void;
    setPropertyTypes: (values: Iterable<string> | null) => void;
    togglePropertyType: (propertyType: string) => void;
    clearPropertyTypes: () => void;
    searchTerm: string;
    setSearchTerm: (value: string) => void;
    resetFilters: () => void;

    status: RentalDataStatus;
    isLoading: boolean;
    isInitialLoading: boolean;
    isRefreshing: boolean;
    error: Error | null;
    errorMessage: string | null;
    loadedCount: number;
    expectedHits: number;
    expectedPages: number;
    loadedPages: readonly number[];
    failedPages: readonly number[];

    mappableListingCount: number;
    unmappableListingCount: number;
    selectedGroupKey: string | null;
    setSelectedGroupKey: (groupKey: string | null) => void;
    selectedGroup: RentalGroup | null;
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

function createEmptyFilters(): RentalFilters {
    return {
        minPrice: null,
        maxPrice: null,
        bedrooms: null,
        propertyTypes: null,
        searchTerm: ''
    };
}

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
    return CITIES.find((city) => city.id === String(value)) ?? CITIES.find((city) => city.id === DEFAULT_CITY_ID)!;
}

function hasOwn<Value extends object>(value: Value, key: PropertyKey) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function normalisePrice(value: number | string | null | undefined): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

function normaliseNumberSelection(values: Iterable<number> | null | undefined): readonly number[] | null {
    if (values === null || values === undefined) return null;
    const selection = new Set<number>();
    for (const value of values) {
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
            selection.add(Math.trunc(value));
        }
    }
    return [...selection].sort((left, right) => left - right);
}

function normaliseStringSelection(values: Iterable<string> | null | undefined): readonly string[] | null {
    if (values === null || values === undefined) return null;
    const selection = new Set<string>();
    for (const value of values) {
        if (typeof value !== 'string') continue;
        const trimmed = value.trim();
        if (trimmed) selection.add(trimmed);
    }
    return [...selection].sort((left, right) => left.localeCompare(right));
}

function mergeFilterPatch(previous: RentalFilters, patch: RentalFilterPatch): RentalFilters {
    const minChanged = hasOwn(patch, 'minPrice');
    const maxChanged = hasOwn(patch, 'maxPrice');
    let minPrice = minChanged ? normalisePrice(patch.minPrice) : previous.minPrice;
    let maxPrice = maxChanged ? normalisePrice(patch.maxPrice) : previous.maxPrice;

    // A range should never silently become impossible while a user edits one
    // end. Move the opposite end to the changed value instead.
    if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
        if (minChanged && !maxChanged) {
            maxPrice = minPrice;
        } else if (maxChanged && !minChanged) {
            minPrice = maxPrice;
        } else {
            [minPrice, maxPrice] = [maxPrice, minPrice];
        }
    }

    return {
        minPrice,
        maxPrice,
        bedrooms: hasOwn(patch, 'bedrooms') ? normaliseNumberSelection(patch.bedrooms) : previous.bedrooms,
        propertyTypes: hasOwn(patch, 'propertyTypes')
            ? normaliseStringSelection(patch.propertyTypes)
            : previous.propertyTypes,
        searchTerm: hasOwn(patch, 'searchTerm')
            ? typeof patch.searchTerm === 'string' ? patch.searchTerm : ''
            : previous.searchTerm
    };
}

function toCoreFilters(filters: RentalFilters) {
    return {
        minimumPrice: filters.minPrice,
        maximumPrice: filters.maxPrice,
        bedrooms: filters.bedrooms ?? undefined,
        propertyTypes: filters.propertyTypes ?? undefined
    };
}

function matchesSearchTerm(listing: RentalListing, searchTerm: string) {
    const query = searchTerm.trim().toLocaleLowerCase();
    if (!query) return true;
    return [listing.title, listing.neighborhood, listing.propertyType, listing.propertyReference]
        .filter((value): value is string => Boolean(value))
        .join(' ')
        .toLocaleLowerCase()
        .includes(query);
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

/**
 * Kept public so contract tests can inspect the request without duplicating
 * the endpoint's Algolia-compatible payload shape.
 */
export function buildRentalSearchPayload(cityId: string, page: number): RentalSearchRequestPayload {
    const filters = [
        '("categories_v2.slug_paths":"property-for-rent/residential")',
        `(price:${SOURCE_PRICE_LIMITS.minimum} TO ${SOURCE_PRICE_LIMITS.maximum})`
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
            // The page-based index keeps an id stable when the source omitted
            // one, even if pages settle in a different order.
            const listing = normalizeListing(page.hits[index], pageStart + index);
            if (!session.seenIds.has(listing.id)) {
                session.seenIds.add(listing.id);
                session.listings.push(listing);
            }
        } catch {
            // One malformed hit must never make a useful page unusable.
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

/**
 * Data ownership lives here rather than in the map or result components. That
 * guarantees the map, cards, metrics and filters all consume one normalized
 * and identically filtered collection.
 */
export function useRentalData(options: UseRentalDataOptions = {}): UseRentalDataResult {
    const endpoint = options.endpoint?.trim() || resolveEndpoint();
    const fetcher = options.fetcher ?? defaultFetch;
    const initialCity = cityForId(options.initialCityId ?? DEFAULT_CITY_ID);
    const [cityId, setCityIdState] = useState(initialCity.id);
    const [filters, setFiltersState] = useState<RentalFilters>(createEmptyFilters);
    const [data, setData] = useState<DataSnapshot>(createEmptySnapshot);
    const [selectedGroupKey, setSelectedGroupKeyState] = useState<string | null>(null);
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

    const startFullLoad = useCallback((requestedCityId: string) => {
        const city = cityForId(requestedCityId);
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
    }, [endpoint, fetcher, isCurrentSession, loadPages, publish, stopCurrentSession]);

    useEffect(() => {
        if (options.autoLoad === false) return undefined;
        const session = startFullLoad(initialCity.id);
        return () => {
            if (sessionRef.current === session && !session.controller.signal.aborted) {
                session.controller.abort();
                sessionRef.current = null;
            }
        };
    // Initial city is intentionally used only when the hook mounts. City
    // changes go through setCityId so filters reset in the same interaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [startFullLoad, options.autoLoad]);

    const setCityId = useCallback((requestedCityId: string) => {
        const nextCity = cityForId(requestedCityId);
        if (nextCity.id === cityId) return;
        setCityIdState(nextCity.id);
        setFiltersState(createEmptyFilters());
        setSelectedGroupKeyState(null);
        startFullLoad(nextCity.id);
    }, [cityId, startFullLoad]);

    const refresh = useCallback(() => {
        setSelectedGroupKeyState(null);
        startFullLoad(cityId);
    }, [cityId, startFullLoad]);

    const retry = useCallback(() => {
        const prior = sessionRef.current;
        if (!prior || prior.cityId !== cityId || prior.isLoading || prior.failedPages.size === 0 || prior.failedPages.has(0)) {
            refresh();
            return;
        }

        const retryPages = [...prior.failedPages].sort((left, right) => left - right);
        if (!retryPages.length) return;
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
    }, [cityId, isCurrentSession, loadPages, publish, refresh]);

    const setFilters = useCallback((patch: RentalFilterPatch) => {
        setFiltersState((previous) => mergeFilterPatch(previous, patch));
        setSelectedGroupKeyState(null);
    }, []);

    const setMinPrice = useCallback((value: number | string | null) => {
        setFilters({ minPrice: value });
    }, [setFilters]);

    const setMaxPrice = useCallback((value: number | string | null) => {
        setFilters({ maxPrice: value });
    }, [setFilters]);

    const setBedrooms = useCallback((values: Iterable<number> | null) => {
        setFilters({ bedrooms: values });
    }, [setFilters]);

    const setPropertyTypes = useCallback((values: Iterable<string> | null) => {
        setFilters({ propertyTypes: values });
    }, [setFilters]);

    const facets = useMemo<RentalFacets>(() => facetValues(data.listings), [data.listings]);

    const toggleBedroom = useCallback((bedrooms: number) => {
        setFiltersState((previous) => {
            const current = new Set(previous.bedrooms ?? facets.bedrooms.map((facet) => facet.value));
            if (current.has(bedrooms)) current.delete(bedrooms);
            else current.add(bedrooms);
            return mergeFilterPatch(previous, { bedrooms: current });
        });
        setSelectedGroupKeyState(null);
    }, [facets.bedrooms]);

    const togglePropertyType = useCallback((propertyType: string) => {
        setFiltersState((previous) => {
            const current = new Set(previous.propertyTypes ?? facets.propertyTypes.map((facet) => facet.value));
            if (current.has(propertyType)) current.delete(propertyType);
            else current.add(propertyType);
            return mergeFilterPatch(previous, { propertyTypes: current });
        });
        setSelectedGroupKeyState(null);
    }, [facets.propertyTypes]);

    const clearBedrooms = useCallback(() => setFilters({ bedrooms: null }), [setFilters]);
    const clearPropertyTypes = useCallback(() => setFilters({ propertyTypes: null }), [setFilters]);
    const setSearchTerm = useCallback((searchTerm: string) => setFilters({ searchTerm }), [setFilters]);

    const resetFilters = useCallback(() => {
        setFiltersState(createEmptyFilters());
        setSelectedGroupKeyState(null);
    }, []);

    const coreFilters = useMemo(() => toCoreFilters(filters), [filters]);
    const visibleListings = useMemo(() => {
        return data.listings.filter((listing) => (
            matchesFilters(listing, coreFilters) && matchesSearchTerm(listing, filters.searchTerm)
        ));
    }, [coreFilters, data.listings, filters.searchTerm]);

    // Search is deliberately applied before grouping. Passing an empty filter
    // here avoids accidentally putting a non-search match in a map group.
    const groups = useMemo<RentalGroup[]>(() => {
        return groupVisibleListings(visibleListings, {});
    }, [visibleListings]);

    const visibleFacets = useMemo<RentalFacets>(() => facetValues(visibleListings), [visibleListings]);
    const selectedGroup = useMemo(() => (
        groups.find((group) => group.key === selectedGroupKey) ?? null
    ), [groups, selectedGroupKey]);

    useEffect(() => {
        if (selectedGroupKey && !selectedGroup) setSelectedGroupKeyState(null);
    }, [selectedGroup, selectedGroupKey]);

    const setSelectedGroupKey = useCallback((groupKey: string | null) => {
        if (groupKey === null || groups.some((group) => group.key === groupKey)) {
            setSelectedGroupKeyState(groupKey);
        }
    }, [groups]);

    const mappableListingCount = useMemo(
        () => groups.reduce((count, group) => count + group.count, 0),
        [groups]
    );

    return {
        cities: CITIES,
        cityId,
        city: cityForId(cityId),
        setCityId,
        refresh,
        retry,

        listings: data.listings,
        visibleListings,
        groups,
        groupedVisibleListings: groups,
        facets,
        visibleFacets,

        filters,
        setFilters,
        setMinPrice,
        setMaxPrice,
        setBedrooms,
        toggleBedroom,
        clearBedrooms,
        setPropertyTypes,
        togglePropertyType,
        clearPropertyTypes,
        searchTerm: filters.searchTerm,
        setSearchTerm,
        resetFilters,

        status: data.status,
        isLoading: data.isLoading,
        isInitialLoading: data.isLoading && data.listings.length === 0,
        isRefreshing: data.isLoading && data.listings.length > 0,
        error: data.error,
        errorMessage: data.error?.message ?? null,
        loadedCount: data.listings.length,
        expectedHits: data.expectedHits,
        expectedPages: data.expectedPages,
        loadedPages: data.loadedPages,
        failedPages: data.failedPages,

        mappableListingCount,
        unmappableListingCount: Math.max(0, visibleListings.length - mappableListingCount),
        selectedGroupKey,
        setSelectedGroupKey,
        selectedGroup
    };
}
