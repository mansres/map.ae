import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import {
    BedDouble,
    BookmarkPlus,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    CircleX,
    Filter,
    LocateFixed,
    MapPinned,
    Moon,
    Search,
    SlidersHorizontal,
    Sun,
    X
} from 'lucide-react';

import { PropertyCard } from './components/PropertyCard';
import { VirtualizedResults } from './components/VirtualizedResults';
import { CITIES, useRentalData } from './hooks/useRentalData';
import type { RentalFilters } from './types/rental';

type Popover = 'price' | 'beds' | 'type' | null;
type SortOption = 'price-low' | 'price-high' | 'density';
type SavedSearch = {
    id: string;
    label: string;
    cityId: string;
    filters: RentalFilters;
};

const STORAGE_KEYS = {
    favorites: 'rental-radar:favorites',
    recent: 'rental-radar:recent-searches',
    saved: 'rental-radar:saved-searches',
    filters: 'rental-radar:filters',
    theme: 'rental-radar:theme'
} as const;

const RentalMap = lazy(async () => {
    const module = await import('./components/RentalMap');
    return { default: module.RentalMap };
});

function readStorage<T>(key: string, fallback: T): T {
    try {
        const stored = window.localStorage.getItem(key);
        return stored ? JSON.parse(stored) as T : fallback;
    } catch {
        return fallback;
    }
}

function compactPrice(value: number | null) {
    if (value === null || !Number.isFinite(value)) return 'Any price';
    if (value >= 1_000_000) return `AED ${(value / 1_000_000).toFixed(1)}M`;
    return `AED ${Math.round(value / 1000)}k`;
}

function priceRangeLabel(minPrice: number | null, maxPrice: number | null) {
    if (minPrice !== null && maxPrice !== null) return `${compactPrice(minPrice)} – ${compactPrice(maxPrice).replace('AED ', '')}`;
    if (minPrice !== null) return `${compactPrice(minPrice)}+`;
    if (maxPrice !== null) return `Up to ${compactPrice(maxPrice).replace('AED ', '')}`;
    return 'Price';
}

function bedroomLabel(value: number) {
    return value === 0 ? 'Studio' : `${value} bed${value === 1 ? '' : 's'}`;
}

function sameArray<T>(left: readonly T[] | null, right: readonly T[] | null) {
    if (left === right) return true;
    if (left === null || right === null || left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
}

function toggleValue<T>(current: readonly T[] | null, available: readonly T[], value: T) {
    const active = new Set(current ?? available);
    if (active.has(value)) active.delete(value);
    else active.add(value);
    const next = available.filter((item) => active.has(item));
    return sameArray(next, available) ? null : next;
}

function SkeletonCards() {
    return (
        <div className="skeleton-list" aria-label="Loading rentals" aria-busy="true">
            {[0, 1, 2].map((index) => <div key={index} className="property-card is-skeleton skeleton" />)}
        </div>
    );
}

function AppliedChip({ label, onRemove }: { label: string; onRemove: () => void }) {
    return (
        <span className="active-filter-chip">
            {label}
            <button type="button" className="active-filter-chip__remove" onClick={onRemove} aria-label={`Remove ${label} filter`}>
                <X size={14} />
            </button>
        </span>
    );
}

export function App() {
    const rental = useRentalData();
    const {
        cityId,
        city,
        listings,
        groups,
        facets,
        filters,
        status,
        loadedCount,
        expectedHits,
        failedPages,
        setCityId,
        setFilters,
        resetFilters,
        retry,
        refresh
    } = rental;

    const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
    const [focusRequest, setFocusRequest] = useState<{ key: string; id: number } | null>(null);
    const [openPopover, setOpenPopover] = useState<Popover>(null);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [sheetExpanded, setSheetExpanded] = useState(false);
    const [desktopCollapsed, setDesktopCollapsed] = useState(false);
    const [workspaceWidth, setWorkspaceWidth] = useState<number | null>(null);
    const [isResizingWorkspace, setIsResizingWorkspace] = useState(false);
    const [sort, setSort] = useState<SortOption>('price-low');
    const [compactResults, setCompactResults] = useState(false);
    const [favorites, setFavorites] = useState<Set<string>>(() => new Set(readStorage<string[]>(STORAGE_KEYS.favorites, [])));
    const [recentSearches, setRecentSearches] = useState<string[]>(() => readStorage<string[]>(STORAGE_KEYS.recent, []));
    const [savedSearches, setSavedSearches] = useState<SavedSearch[]>(() => readStorage<SavedSearch[]>(STORAGE_KEYS.saved, []));
    const [theme, setTheme] = useState<'light' | 'dark'>(() => readStorage<'light' | 'dark'>(STORAGE_KEYS.theme, 'light'));
    const [searchFocused, setSearchFocused] = useState(false);
    const [map, setMap] = useState<LeafletMap | null>(null);
    const [filtersHydrated, setFiltersHydrated] = useState(false);
    const sheetStartY = useRef<number | null>(null);
    const sheetGestureWasDrag = useRef(false);
    const searchRef = useRef<HTMLInputElement>(null);
    const resizeStart = useRef<{ x: number; width: number } | null>(null);
    const focusRequestId = useRef(0);
    const filterTriggerRef = useRef<HTMLElement | null>(null);
    const filterDrawerRef = useRef<HTMLElement | null>(null);

    const sortedGroups = useMemo(() => [...groups].sort((left, right) => {
        if (sort === 'price-high') return (right.lowestPrice ?? -1) - (left.lowestPrice ?? -1);
        if (sort === 'density') return right.count - left.count || (left.lowestPrice ?? Infinity) - (right.lowestPrice ?? Infinity);
        return (left.lowestPrice ?? Infinity) - (right.lowestPrice ?? Infinity) || right.count - left.count;
    }), [groups, sort]);

    const selectedGroup = useMemo(
        () => sortedGroups.find((group) => group.key === selectedGroupKey) ?? null,
        [selectedGroupKey, sortedGroups]
    );

    const suggestions = useMemo(() => {
        const term = filters.searchTerm.trim().toLocaleLowerCase();
        if (!term) {
            if (recentSearches.length) return recentSearches.slice(0, 4);
            const counts = new Map<string, number>();
            for (const listing of listings) {
                if (listing.neighborhood) counts.set(listing.neighborhood, (counts.get(listing.neighborhood) ?? 0) + 1);
            }
            return [...counts.entries()]
                .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
                .slice(0, 4)
                .map(([neighborhood]) => neighborhood);
        }
        const unique = new Set<string>();
        for (const listing of listings) {
            const candidate = listing.neighborhood || listing.title;
            if (candidate && candidate.toLocaleLowerCase().includes(term)) unique.add(candidate);
            if (unique.size >= 5) break;
        }
        return [...unique];
    }, [filters.searchTerm, listings, recentSearches]);

    useEffect(() => {
        window.localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify([...favorites]));
    }, [favorites]);

    useEffect(() => {
        window.localStorage.setItem(STORAGE_KEYS.recent, JSON.stringify(recentSearches));
    }, [recentSearches]);

    useEffect(() => {
        window.localStorage.setItem(STORAGE_KEYS.saved, JSON.stringify(savedSearches));
    }, [savedSearches]);

    useEffect(() => {
        const saved = readStorage<Partial<RentalFilters> | null>(STORAGE_KEYS.filters, null);
        if (saved) setFilters(saved);
        setFiltersHydrated(true);
    }, [setFilters]);

    useEffect(() => {
        if (filtersHydrated) window.localStorage.setItem(STORAGE_KEYS.filters, JSON.stringify(filters));
    }, [filters, filtersHydrated]);

    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        window.localStorage.setItem(STORAGE_KEYS.theme, JSON.stringify(theme));
    }, [theme]);

    useEffect(() => {
        if (selectedGroupKey && !groups.some((group) => group.key === selectedGroupKey)) {
            setSelectedGroupKey(null);
            setFocusRequest(null);
        }
    }, [groups, selectedGroupKey]);

    useEffect(() => {
        const onEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (filtersOpen) {
                setFiltersOpen(false);
                window.setTimeout(() => filterTriggerRef.current?.focus(), 0);
                return;
            }
            if (openPopover) {
                setOpenPopover(null);
                return;
            }
            if (sheetExpanded) setSheetExpanded(false);
        };
        document.addEventListener('keydown', onEscape);
        return () => document.removeEventListener('keydown', onEscape);
    }, [filtersOpen, openPopover, sheetExpanded]);

    useEffect(() => {
        if (!filtersOpen) return undefined;
        const timer = window.setTimeout(() => {
            filterDrawerRef.current?.querySelector<HTMLElement>('button, input, select')?.focus();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [filtersOpen]);

    useEffect(() => {
        if (!isResizingWorkspace) return undefined;
        const onPointerMove = (event: PointerEvent) => {
            if (!resizeStart.current) return;
            const maximum = Math.min(480, Math.max(320, window.innerWidth * 0.42));
            setWorkspaceWidth(Math.min(maximum, Math.max(288, resizeStart.current.width + event.clientX - resizeStart.current.x)));
        };
        const stopResizing = () => {
            resizeStart.current = null;
            setIsResizingWorkspace(false);
        };
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', stopResizing, { once: true });
        return () => {
            document.removeEventListener('pointermove', onPointerMove);
            document.removeEventListener('pointerup', stopResizing);
        };
    }, [isResizingWorkspace]);

    const updateFilters = useCallback((patch: Partial<RentalFilters>) => {
        setSelectedGroupKey(null);
        setFocusRequest(null);
        setFilters(patch);
    }, [setFilters]);

    const toggleFavorite = useCallback((key: string) => {
        setFavorites((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);

    const selectGroup = useCallback((key: string) => {
        setSelectedGroupKey(key);
        setFocusRequest(null);
        setSheetExpanded(false);
    }, []);

    const focusGroup = useCallback((key: string) => {
        setSelectedGroupKey(key);
        focusRequestId.current += 1;
        setFocusRequest({ key, id: focusRequestId.current });
        setSheetExpanded(false);
    }, []);

    const handleFocusHandled = useCallback((id: number) => {
        setFocusRequest((current) => current?.id === id ? null : current);
    }, []);

    const commitSearch = useCallback((value = filters.searchTerm) => {
        const next = value.trim();
        if (!next) return;
        setRecentSearches((current) => [next, ...current.filter((item) => item.toLocaleLowerCase() !== next.toLocaleLowerCase())].slice(0, 5));
    }, [filters.searchTerm]);

    const saveCurrentSearch = useCallback(() => {
        const label = filters.searchTerm.trim() || `${city.label} rentals`;
        const next: SavedSearch = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            label,
            cityId,
            filters: { ...filters, bedrooms: filters.bedrooms ? [...filters.bedrooms] : null, propertyTypes: filters.propertyTypes ? [...filters.propertyTypes] : null }
        };
        setSavedSearches((current) => [next, ...current.filter((item) => item.label !== next.label)].slice(0, 8));
    }, [city.label, cityId, filters]);

    const applySavedSearch = useCallback((saved: SavedSearch) => {
        setCityId(saved.cityId);
        setFilters(saved.filters);
        setFiltersOpen(false);
        setOpenPopover(null);
        window.setTimeout(() => filterTriggerRef.current?.focus(), 0);
    }, [setCityId, setFilters]);

    const locateUser = useCallback(() => {
        if (!map || !navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
            ({ coords }) => map.flyTo([coords.latitude, coords.longitude], Math.max(map.getZoom(), 13), { animate: true, duration: 0.5 }),
            () => undefined,
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 }
        );
    }, [map]);

    const openFiltersDrawer = useCallback((trigger: HTMLElement) => {
        filterTriggerRef.current = trigger;
        setOpenPopover(null);
        setFiltersOpen(true);
    }, []);

    const closeFiltersDrawer = useCallback(() => {
        if (!filtersOpen) return;
        setFiltersOpen(false);
        window.setTimeout(() => filterTriggerRef.current?.focus(), 0);
    }, [filtersOpen]);

    const trapDrawerFocus = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
        if (event.key !== 'Tab') return;
        const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )].filter((element) => !element.hidden && element.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }, []);

    const startWorkspaceResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        if (window.innerWidth < 1024) return;
        const panel = event.currentTarget.closest('.desktop-workspace');
        if (!panel) return;
        resizeStart.current = { x: event.clientX, width: panel.getBoundingClientRect().width };
        setIsResizingWorkspace(true);
    }, []);

    const resizeWorkspaceByKeyboard = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const amount = event.key === 'ArrowLeft' ? -16 : 16;
        const current = workspaceWidth ?? 360;
        const maximum = Math.min(480, Math.max(320, window.innerWidth * 0.42));
        setWorkspaceWidth(Math.min(maximum, Math.max(288, current + amount)));
    }, [workspaceWidth]);

    const beginSheetGesture = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        sheetGestureWasDrag.current = false;
        sheetStartY.current = event.clientY;
        event.currentTarget.setPointerCapture(event.pointerId);
    }, []);

    const endSheetGesture = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        if (sheetStartY.current === null) return;
        const delta = event.clientY - sheetStartY.current;
        sheetStartY.current = null;
        if (Math.abs(delta) < 12) return;
        sheetGestureWasDrag.current = true;
        if (delta < -36) setSheetExpanded(true);
        if (delta > 36) setSheetExpanded(false);
    }, []);

    const toggleSheetFromGrabber = useCallback(() => {
        if (sheetGestureWasDrag.current) {
            sheetGestureWasDrag.current = false;
            return;
        }
        setSheetExpanded((value) => !value);
    }, []);

    const allBedrooms = facets.bedrooms.map((facet) => facet.value);
    const allTypes = facets.propertyTypes.map((facet) => facet.value);
    const anyFiltersActive = filters.minPrice !== null || filters.maxPrice !== null || filters.searchTerm.trim() || filters.bedrooms !== null || filters.propertyTypes !== null;
    const dataLabel = expectedHits
        ? `${loadedCount.toLocaleString('en-AE')} of ${expectedHits.toLocaleString('en-AE')} loaded`
        : `${loadedCount.toLocaleString('en-AE')} loaded`;

    const renderPriceControls = (surface: 'popover' | 'drawer') => (
        <div className={`${surface === 'popover' ? 'filter-popover__range' : 'filter-drawer__range'}`}>
            <label>
                Min AED
                <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1000"
                    placeholder="Any"
                    value={filters.minPrice ?? ''}
                    onChange={(event) => updateFilters({ minPrice: event.target.value === '' ? null : Number(event.target.value) })}
                />
            </label>
            <label>
                Max AED
                <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1000"
                    placeholder="Any"
                    value={filters.maxPrice ?? ''}
                    onChange={(event) => updateFilters({ maxPrice: event.target.value === '' ? null : Number(event.target.value) })}
                />
            </label>
        </div>
    );

    const renderBedroomOptions = (surface: 'popover' | 'drawer') => (
        <div className={`${surface === 'popover' ? 'filter-popover__option-grid' : 'filter-drawer__option-grid'}`}>
            {allBedrooms.map((value) => {
                const selected = filters.bedrooms === null || filters.bedrooms.includes(value);
                const facet = facets.bedrooms.find((item) => item.value === value);
                return (
                    <button
                        key={value}
                        type="button"
                        className="filter-option"
                        aria-pressed={selected}
                        onClick={() => updateFilters({ bedrooms: toggleValue(filters.bedrooms, allBedrooms, value) })}
                    >
                        {bedroomLabel(value)}{facet ? ` · ${facet.count.toLocaleString('en-AE')}` : ''}
                    </button>
                );
            })}
        </div>
    );

    const renderTypeOptions = (surface: 'popover' | 'drawer') => (
        <div className={`${surface === 'popover' ? 'filter-popover__option-grid' : 'filter-drawer__option-grid'}`}>
            {allTypes.map((value) => {
                const selected = filters.propertyTypes === null || filters.propertyTypes.includes(value);
                return (
                    <button
                        key={value}
                        type="button"
                        className="filter-option"
                        aria-pressed={selected}
                        onClick={() => updateFilters({ propertyTypes: toggleValue(filters.propertyTypes, allTypes, value) })}
                    >
                        {value}
                    </button>
                );
            })}
        </div>
    );

    return (
        <main className="app-shell" style={{ '--rr-workspace-width': workspaceWidth ? `${workspaceWidth}px` : undefined } as CSSProperties}>
            <Suspense fallback={<div className="map-loading" role="status" aria-label="Loading map" />}>
                <RentalMap
                city={city}
                groups={sortedGroups}
                selectedGroupKey={selectedGroupKey}
                focusRequest={focusRequest}
                theme={theme}
                onSelectGroup={selectGroup}
                onFocusHandled={handleFocusHandled}
                    onMapReady={setMap}
                />
            </Suspense>

            <section className="map-topbar" aria-label="Search and filters">
                <div className="search-field">
                    <Search className="search-field__icon" size={20} aria-hidden="true" />
                    <input
                        ref={searchRef}
                        type="search"
                        value={filters.searchTerm}
                        onChange={(event) => updateFilters({ searchTerm: event.target.value })}
                        onFocus={() => setSearchFocused(true)}
                        onBlur={() => window.setTimeout(() => setSearchFocused(false), 150)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                commitSearch();
                                setSearchFocused(false);
                            }
                        }}
                        placeholder="Search neighbourhoods or rentals"
                        aria-label="Search neighbourhoods or rental listings"
                    />
                    {filters.searchTerm ? (
                        <button className="search-field__clear" type="button" onClick={() => updateFilters({ searchTerm: '' })} aria-label="Clear search">
                            <CircleX size={18} />
                        </button>
                    ) : null}
                    <button className="search-field__submit" type="button" onClick={() => commitSearch()} aria-label="Save this search to recent searches">
                        <Search size={18} />
                    </button>
                    {searchFocused && suggestions.length ? (
                        <div className="search-suggestions" aria-label={filters.searchTerm ? 'Search suggestions' : 'Recent searches'}>
                            <p>{filters.searchTerm ? 'Suggestions' : recentSearches.length ? 'Recent searches' : 'Popular areas'}</p>
                            {suggestions.map((suggestion) => (
                                <button
                                    key={suggestion}
                                    type="button"
                                    className="search-suggestion"
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => {
                                        updateFilters({ searchTerm: suggestion });
                                        commitSearch(suggestion);
                                        setSearchFocused(false);
                                    }}
                                >
                                    <Search size={15} aria-hidden="true" /> {suggestion}
                                </button>
                            ))}
                        </div>
                    ) : null}
                </div>

                <div className="quick-filter-row" role="toolbar" aria-label="Quick filters">
                    <button className={`filter-pill${openPopover === 'price' || filters.minPrice !== null || filters.maxPrice !== null ? ' is-active' : ''}`} type="button" onClick={() => setOpenPopover((current) => current === 'price' ? null : 'price')} aria-expanded={openPopover === 'price'} aria-controls="quick-filter-popover">
                        {priceRangeLabel(filters.minPrice, filters.maxPrice)} <ChevronDown size={15} />
                    </button>
                    <button className={`filter-pill${openPopover === 'beds' || filters.bedrooms !== null ? ' is-active' : ''}`} type="button" onClick={() => setOpenPopover((current) => current === 'beds' ? null : 'beds')} aria-expanded={openPopover === 'beds'} aria-controls="quick-filter-popover">
                        <BedDouble size={16} /> {filters.bedrooms === null ? 'Beds' : `${filters.bedrooms.length} beds`} <ChevronDown size={15} />
                    </button>
                    <button className={`filter-pill${openPopover === 'type' || filters.propertyTypes !== null ? ' is-active' : ''}`} type="button" onClick={() => setOpenPopover((current) => current === 'type' ? null : 'type')} aria-expanded={openPopover === 'type'} aria-controls="quick-filter-popover">
                        Home type <ChevronDown size={15} />
                    </button>
                    <button className="filter-pill" type="button" onClick={(event) => openFiltersDrawer(event.currentTarget)} aria-expanded={filtersOpen} aria-controls="filter-drawer">
                        <SlidersHorizontal size={16} /> More filters
                    </button>
                    <button className="filter-pill filter-pill--results" type="button" onClick={() => setSheetExpanded((value) => !value)} aria-expanded={sheetExpanded} aria-controls="rental-results-sheet">
                        <MapPinned size={16} /> Results
                    </button>
                    <button className="filter-pill filter-pill--icon" type="button" onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')} aria-label={`Use ${theme === 'light' ? 'dark' : 'light'} mode`}>
                        {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
                    </button>
                </div>

                <div className="active-filter-row" aria-label="Applied filters">
                    {filters.searchTerm.trim() ? <AppliedChip label={`Search: ${filters.searchTerm}`} onRemove={() => updateFilters({ searchTerm: '' })} /> : null}
                    {(filters.minPrice !== null || filters.maxPrice !== null) ? <AppliedChip label={priceRangeLabel(filters.minPrice, filters.maxPrice)} onRemove={() => updateFilters({ minPrice: null, maxPrice: null })} /> : null}
                    {filters.bedrooms?.map((value) => <AppliedChip key={value} label={bedroomLabel(value)} onRemove={() => updateFilters({ bedrooms: filters.bedrooms?.filter((item) => item !== value) ?? null })} />)}
                    {filters.propertyTypes?.map((value) => <AppliedChip key={value} label={value} onRemove={() => updateFilters({ propertyTypes: filters.propertyTypes?.filter((item) => item !== value) ?? null })} />)}
                </div>

                <div id="quick-filter-popover" className={`filter-popover${openPopover ? ' is-open' : ''}`} data-state={openPopover ? 'open' : 'closed'}>
                    {openPopover === 'price' ? <><div className="filter-popover__heading"><span>Price range</span><button type="button" className="button-link" onClick={() => updateFilters({ minPrice: null, maxPrice: null })}>Clear</button></div>{renderPriceControls('popover')}</> : null}
                    {openPopover === 'beds' ? <><div className="filter-popover__heading"><span>Bedrooms</span><button type="button" className="button-link" onClick={() => updateFilters({ bedrooms: null })}>Any</button></div>{renderBedroomOptions('popover')}</> : null}
                    {openPopover === 'type' ? <><div className="filter-popover__heading"><span>Home type</span><button type="button" className="button-link" onClick={() => updateFilters({ propertyTypes: null })}>Any</button></div>{renderTypeOptions('popover')}</> : null}
                </div>
            </section>

            <aside className={`desktop-workspace${desktopCollapsed ? ' is-collapsed' : ''}${isResizingWorkspace ? ' is-resizing' : ''}`} aria-label="Rental results">
                <header className="desktop-workspace__header">
                    <div className="desktop-workspace__brand" aria-hidden={desktopCollapsed}>
                        <span className="desktop-workspace__eyebrow">Live rental map</span>
                        <strong className="desktop-workspace__title">Rental Radar</strong>
                    </div>
                    <button className="desktop-workspace__collapse" type="button" onClick={() => setDesktopCollapsed((value) => !value)} aria-label={desktopCollapsed ? 'Expand results panel' : 'Collapse results panel'} aria-expanded={!desktopCollapsed}>
                        {desktopCollapsed ? <ChevronRight size={19} /> : <ChevronLeft size={19} />}
                    </button>
                </header>
                {!desktopCollapsed ? (
                    <div className="desktop-workspace__content">
                        <div className="desktop-workspace__summary" role="status" aria-live="polite">
                            <span>{status === 'loading' ? 'Finding rentals…' : `${sortedGroups.length.toLocaleString('en-AE')} places`}</span>
                            <strong>{dataLabel}</strong>
                        </div>
                        <label className="desktop-workspace__sort">
                            Sort
                            <select value={sort} onChange={(event) => setSort(event.target.value as SortOption)}>
                                <option value="price-low">Lowest price</option>
                                <option value="price-high">Highest price</option>
                                <option value="density">Most listings</option>
                            </select>
                        </label>
                        <button className="results-toggle" type="button" onClick={() => setCompactResults((value) => !value)} aria-pressed={compactResults}>
                            <MapPinned size={15} /> {compactResults ? 'Comfortable cards' : 'Compact cards'}
                        </button>
                        {status === 'loading' && !groups.length ? <SkeletonCards /> : (
                            <VirtualizedResults
                                groups={sortedGroups}
                                selectedGroupKey={selectedGroupKey}
                                favorites={favorites}
                                compact={compactResults}
                                onSelect={focusGroup}
                                onToggleFavorite={toggleFavorite}
                            />
                        )}
                    </div>
                ) : null}
                <button
                    className="desktop-workspace__resize-handle"
                    type="button"
                    onPointerDown={startWorkspaceResize}
                    onKeyDown={resizeWorkspaceByKeyboard}
                    aria-label="Resize results panel. Use left and right arrow keys."
                />
            </aside>

            <div className="map-actions" aria-label="Map actions">
                <button className="mobile-fab mobile-fab--round" type="button" onClick={locateUser} aria-label="Use my location">
                    <LocateFixed size={19} />
                </button>
                <button className="mobile-fab mobile-fab--filters" type="button" onClick={(event) => openFiltersDrawer(event.currentTarget)} aria-expanded={filtersOpen} aria-controls="filter-drawer">
                    <Filter size={18} /> Filters {anyFiltersActive ? <span className="mobile-fab__count">•</span> : null}
                </button>
            </div>

            <section className={`selected-preview${selectedGroup ? ' is-open' : ''}`} data-state={selectedGroup ? 'open' : 'closed'} aria-label="Selected rental preview">
                {selectedGroup ? <>
                    <button type="button" className="selected-preview__close" onClick={() => { setSelectedGroupKey(null); setFocusRequest(null); }} aria-label="Close selected rental preview"><X size={18} /></button>
                    <PropertyCard group={selectedGroup} selected favorite={favorites.has(selectedGroup.key)} compact onSelect={focusGroup} onToggleFavorite={toggleFavorite} />
                </> : null}
            </section>

            <section
                id="rental-results-sheet"
                className={`results-drawer${sheetExpanded ? ' is-expanded' : ''}`}
                data-state={sheetExpanded ? 'expanded' : 'collapsed'}
                aria-label="Rental result list"
            >
                <button
                    className="results-drawer__grabber"
                    type="button"
                    onPointerDown={beginSheetGesture}
                    onPointerUp={endSheetGesture}
                    onPointerCancel={() => { sheetStartY.current = null; }}
                    onClick={toggleSheetFromGrabber}
                    aria-expanded={sheetExpanded}
                    aria-label={sheetExpanded ? 'Collapse rental results' : 'Expand rental results'}
                />
                <header className="results-drawer__header">
                    <div className="results-drawer__title"><strong>{sortedGroups.length.toLocaleString('en-AE')} places</strong><span>{dataLabel}</span></div>
                    <div className="results-drawer__tools">
                        <button className="results-drawer__tool" type="button" onClick={() => setCompactResults((value) => !value)} aria-label="Toggle compact result cards"><MapPinned size={16} /></button>
                        <button className="results-drawer__tool" type="button" onClick={() => setSheetExpanded((value) => !value)} aria-label={sheetExpanded ? 'Collapse results' : 'Expand results'}><ChevronDown size={18} /></button>
                    </div>
                </header>
                {sheetExpanded ? <div className="results-drawer__content">
                    <label className="desktop-workspace__sort">
                        Sort
                        <select value={sort} onChange={(event) => setSort(event.target.value as SortOption)}>
                            <option value="price-low">Lowest price</option>
                            <option value="price-high">Highest price</option>
                            <option value="density">Most listings</option>
                        </select>
                    </label>
                    {status === 'loading' && !groups.length ? <SkeletonCards /> : <VirtualizedResults groups={sortedGroups} selectedGroupKey={selectedGroupKey} favorites={favorites} compact={compactResults} onSelect={focusGroup} onToggleFavorite={toggleFavorite} />}
                </div> : null}
            </section>

            <div className={`filter-drawer-backdrop${filtersOpen ? ' is-open' : ''}`} onClick={closeFiltersDrawer} aria-hidden="true" />
            <aside id="filter-drawer" ref={filterDrawerRef} className={`filter-drawer${filtersOpen ? ' is-open' : ''}`} data-state={filtersOpen ? 'open' : 'closed'} role="dialog" aria-modal={filtersOpen || undefined} aria-labelledby="filter-drawer-title" aria-hidden={!filtersOpen} inert={!filtersOpen} onKeyDown={trapDrawerFocus}>
                <header className="filter-drawer__header">
                    <div><span>Search settings</span><h2 id="filter-drawer-title">Filters</h2></div>
                    <button className="filter-drawer__close" type="button" onClick={closeFiltersDrawer} aria-label="Close filters"><X size={19} /></button>
                </header>
                <div className="filter-drawer__content">
                    <fieldset>
                        <legend>Location</legend>
                        <label>
                            Emirate
                            <select value={cityId} onChange={(event) => setCityId(event.target.value)}>
                                {CITIES.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.label}</option>)}
                            </select>
                        </label>
                    </fieldset>
                    <fieldset>
                        <legend>Price range</legend>
                        {renderPriceControls('drawer')}
                    </fieldset>
                    <fieldset>
                        <legend>Bedrooms</legend>
                        {renderBedroomOptions('drawer')}
                    </fieldset>
                    <fieldset>
                        <legend>Home type</legend>
                        {renderTypeOptions('drawer')}
                    </fieldset>
                    {savedSearches.length ? <section className="saved-searches" aria-labelledby="saved-searches-title">
                        <div className="filter-drawer__heading"><span id="saved-searches-title">Saved searches</span></div>
                        {savedSearches.map((saved) => <button type="button" key={saved.id} className="saved-search" onClick={() => applySavedSearch(saved)}>{saved.label}</button>)}
                    </section> : null}
                    {status === 'partial' ? <p className="status-pill status-pill--warning">Some pages could not load. <button type="button" onClick={retry}>Retry</button></p> : null}
                    {status === 'error' ? <p className="status-pill status-pill--error">Listings could not load. <button type="button" onClick={retry}>Retry</button></p> : null}
                </div>
                <footer className="filter-drawer__footer">
                    <button className="filter-drawer__reset" type="button" onClick={() => { resetFilters(); setOpenPopover(null); }}>Reset</button>
                    <button className="button-secondary" type="button" onClick={saveCurrentSearch}><BookmarkPlus size={16} /> Save search</button>
                    <button className="filter-drawer__apply" type="button" onClick={closeFiltersDrawer}>Show {sortedGroups.length.toLocaleString('en-AE')} places</button>
                </footer>
            </aside>

            {status === 'error' && !listings.length ? <section className="fatal-state" role="alert"><h1>We couldn’t load rentals</h1><p>Check your connection, then try again.</p><button type="button" onClick={refresh}>Retry loading</button></section> : null}
            {status === 'partial' && failedPages.length ? <p className="map-status" role="status">Some listings are still unavailable. <button type="button" onClick={retry}>Retry</button></p> : null}
        </main>
    );
}
