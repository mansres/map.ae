import {
    PRICE_BANDS,
    extractSearchPage,
    facetValues,
    groupVisibleListings,
    isSafeHttpUrl,
    matchesFilters,
    normalizeListing,
    priceBandIndex
} from './rental-core.js';

const API_URL = window.RENTAL_RADAR_API_URL || 'https://rmi.mansoor-infos.workers.dev';
const SEARCH_INDEX = 'property-for-rent-residential.com';
const PAGE_CONCURRENCY = 3;
const SOURCE_PRICE_LIMITS = Object.freeze({ minimum: 10000, maximum: 80000 });

const CITIES = Object.freeze([
    { id: '0', label: 'All Emirates', center: [24.840, 55.460], zoom: 8 },
    { id: '2', label: 'Dubai', center: [25.2048, 55.2708], zoom: 11 },
    { id: '3', label: 'Abu Dhabi', center: [24.4539, 54.3773], zoom: 11 },
    { id: '12', label: 'Sharjah', center: [25.3573, 55.3911], zoom: 11 },
    { id: '14', label: 'Ajman', center: [25.4111, 55.4353], zoom: 11 },
    { id: '11', label: 'Ras Al Khaimah', center: [25.7891, 55.9376], zoom: 11 },
    { id: '13', label: 'Fujairah', center: [25.1232, 56.3269], zoom: 11 },
    { id: '15', label: 'Umm Al Quwain', center: [25.5651, 55.5532], zoom: 11 },
    { id: '39', label: 'Al Ain', center: [24.2075, 55.7447], zoom: 11 }
]);

const RETRIEVED_ATTRIBUTES = Object.freeze([
    'id', 'objectID', 'uuid', 'name', 'property_reference', 'price', 'bedrooms', 'bathrooms',
    'size', 'property_info', 'categories', 'categories_v2', 'category_v2', 'city', 'building',
    'neighborhoods', 'photos', 'images', 'absolute_url', 'short_url', 'description_short',
    'description', '_geoloc', 'payment_frequency', 'room_type'
]);

const aedFormatter = new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: 'AED',
    maximumFractionDigits: 0
});
const numberFormatter = new Intl.NumberFormat('en-AE');

const state = {
    cityId: '2',
    listings: [],
    seenIds: new Set(),
    minimumPrice: null,
    maximumPrice: null,
    bedrooms: new Set(),
    bedroomsTouched: false,
    expectedHits: 0,
    expectedPages: 0,
    loadedPages: new Set(),
    failedPages: new Set(),
    isLoading: false,
    requestGeneration: 0,
    abortController: null,
    selectedGroupKey: null,
    model: null,
    isMobile: false,
    focusRequest: null,
    lastSheetTrigger: null
};

const ui = {};
let map;
let markerLayer;
const markerByGroup = new Map();
let renderFrame = 0;
const mobileBreakpoint = window.matchMedia('(max-width: 768px)');

document.addEventListener('DOMContentLoaded', () => {
    try {
        bootstrap();
    } catch (error) {
        console.error('Rental Radar startup error:', error);
        const status = document.getElementById('app-status');
        if (status) {
            status.replaceChildren(createStatusBanner(
                'error',
                'Rental Radar could not start. Refresh the page and check that map resources are available.'
            ));
        }
    }
});

function bootstrap() {
    Object.assign(ui, {
        sidebar: requiredElement('sidebar'),
        desktopPanel: requiredElement('desktop-panel'),
        sidebarToggle: requiredElement('sidebar-toggle'),
        refreshData: requiredElement('refresh-data'),
        citySelect: requiredElement('city-select'),
        appStatus: requiredElement('app-status'),
        bedroomFilters: requiredElement('bedroom-filters'),
        minimumPrice: requiredElement('minimum-price'),
        maximumPrice: requiredElement('maximum-price'),
        bedroomActions: requiredElement('bedroom-actions'),
        activeFilters: requiredElement('active-filters'),
        filterPanel: requiredElement('filter-panel'),
        resetFilters: requiredElement('reset-filters'),
        mobileToolbar: requiredElement('mobile-toolbar'),
        openFilters: requiredElement('open-filters'),
        sheetBackdrop: requiredElement('sheet-backdrop'),
        filterSheet: requiredElement('filter-sheet'),
        filterSheetContent: requiredElement('filter-sheet-content')
    });

    populateCities();
    createMap();
    wireEvents();
    moveResponsiveContent();
    render();
    loadCity(state.cityId);
}

function requiredElement(id) {
    const element = document.getElementById(id);
    if (!element) throw new Error('Missing required element #' + id);
    return element;
}

function createMap() {
    if (!window.L) throw new Error('Leaflet did not load.');

    map = L.map('map', {
        zoomControl: false,
        preferCanvas: true,
        attributionControl: true
    }).setView(CITIES[1].center, CITIES[1].zoom);
    L.control.zoom({ position: 'topright' }).addTo(map);

    const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    });
    const light = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 20,
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    });
    const dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 20,
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    });
    const satellite = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19, attribution: 'Tiles &copy; Esri' }
    );

    streets.addTo(map);
    L.control.layers({
        'Detailed streets': streets,
        'Light map': light,
        'Dark map': dark,
        'Satellite': satellite
    }, null, { position: 'topright' }).addTo(map);

    markerLayer = typeof L.markerClusterGroup === 'function'
        ? L.markerClusterGroup({
            chunkedLoading: true,
            chunkInterval: 100,
            chunkDelay: 30,
            maxClusterRadius: 54,
            showCoverageOnHover: false,
            spiderfyOnMaxZoom: true,
            iconCreateFunction(cluster) {
                const count = cluster.getChildCount();
                const size = count >= 100 ? 'large' : count >= 20 ? 'medium' : 'small';
                const dimension = size === 'large' ? 66 : size === 'medium' ? 54 : 42;
                return L.divIcon({
                    className: 'cluster-marker marker-cluster-' + size,
                    html: '<span>' + compactCount(count) + '</span>',
                    iconSize: [dimension, dimension],
                    iconAnchor: [dimension / 2, dimension / 2]
                });
            }
        })
        : L.layerGroup();
    markerLayer.addTo(map);

    map.on('popupopen', (event) => {
        const marker = event.popup && event.popup._source;
        const key = marker && marker.__rentalGroupKey;
        if (key) {
            state.selectedGroupKey = key;
            updateSelectedVisuals();
        }
    });
}

function populateCities() {
    ui.citySelect.replaceChildren();
    for (const city of CITIES) {
        const option = document.createElement('option');
        option.value = city.id;
        option.textContent = city.label;
        ui.citySelect.append(option);
    }
    ui.citySelect.value = state.cityId;
}

function wireEvents() {
    ui.citySelect.addEventListener('change', () => loadCity(ui.citySelect.value));
    ui.minimumPrice.addEventListener('change', () => onPriceRangeChange('minimum'));
    ui.maximumPrice.addEventListener('change', () => onPriceRangeChange('maximum'));
    ui.refreshData.addEventListener('click', () => loadCity(state.cityId));
    ui.resetFilters.addEventListener('click', resetFilters);
    ui.filterPanel.addEventListener('click', onFilterPanelClick);
    ui.activeFilters.addEventListener('click', onActiveFilterClick);

    ui.sidebarToggle.addEventListener('click', () => {
        const collapsed = ui.desktopPanel.classList.toggle('is-collapsed');
        ui.sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
        window.setTimeout(() => map.invalidateSize(), 250);
    });

    ui.openFilters.addEventListener('click', () => openFilterSheet(ui.openFilters));
    ui.sheetBackdrop.addEventListener('click', closeSheets);
    for (const closeButton of document.querySelectorAll('[data-close-sheet]')) {
        closeButton.addEventListener('click', closeSheets);
    }
    document.addEventListener('keydown', onDocumentKeydown);

    const onBreakpointChange = () => {
        closeSheets({ restoreFocus: false });
        moveResponsiveContent();
        window.setTimeout(() => map.invalidateSize(), 30);
    };
    if (typeof mobileBreakpoint.addEventListener === 'function') {
        mobileBreakpoint.addEventListener('change', onBreakpointChange);
    } else {
        mobileBreakpoint.addListener(onBreakpointChange);
    }
}

function buildSearchPayload(cityId, page) {
    const filters = [
        '("categories_v2.slug_paths":"property-for-rent/residential")',
        '(price:' + SOURCE_PRICE_LIMITS.minimum + ' TO ' + SOURCE_PRICE_LIMITS.maximum + ')'
    ];
    if (cityId !== '0') filters.push('("city.id"=' + cityId + ')');

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

async function fetchSearchPage(cityId, page, signal) {
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSearchPayload(cityId, page)),
        signal
    });
    if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + response.statusText);
    return extractSearchPage(await response.json());
}

async function loadCity(cityId) {
    const city = CITIES.find((candidate) => candidate.id === String(cityId)) || CITIES[1];
    cityId = city.id;

    if (state.abortController) state.abortController.abort();
    const controller = new AbortController();
    const generation = state.requestGeneration + 1;
    state.abortController = controller;
    state.requestGeneration = generation;
    state.cityId = cityId;
    state.listings = [];
    state.seenIds = new Set();
    state.expectedHits = 0;
    state.expectedPages = 0;
    state.loadedPages = new Set();
    state.failedPages = new Set();
    state.isLoading = true;
    state.selectedGroupKey = null;
    resetFilters({ deferRender: true });
    ui.citySelect.value = cityId;
    map.closePopup();
    map.setView(city.center, city.zoom);
    scheduleRender();

    try {
        const firstPage = await fetchSearchPage(cityId, 0, controller.signal);
        if (!isCurrentRequest(generation, controller)) return;
        acceptPage(firstPage);
        state.expectedHits = firstPage.nbHits;
        state.expectedPages = firstPage.nbPages;
        scheduleRender();

        if (firstPage.nbPages > 1) {
            await fetchRemainingPages(firstPage.nbPages, cityId, generation, controller);
        }

        if (!isCurrentRequest(generation, controller)) return;
        state.isLoading = false;
        scheduleRender();
    } catch (error) {
        if (isAbortError(error) || !isCurrentRequest(generation, controller)) return;
        state.isLoading = false;
        state.failedPages.add(0);
        console.error('Rental Radar data error:', error);
        scheduleRender();
    }
}

function isCurrentRequest(generation, controller) {
    return state.requestGeneration === generation && state.abortController === controller && !controller.signal.aborted;
}

async function fetchRemainingPages(totalPages, cityId, generation, controller) {
    let nextPage = 1;
    const worker = async () => {
        while (nextPage < totalPages && isCurrentRequest(generation, controller)) {
            const page = nextPage;
            nextPage += 1;
            try {
                const result = await fetchSearchPage(cityId, page, controller.signal);
                if (!isCurrentRequest(generation, controller)) return;
                acceptPage(result);
                scheduleRender();
            } catch (error) {
                if (isAbortError(error)) throw error;
                if (!isCurrentRequest(generation, controller)) return;
                state.failedPages.add(page);
                console.warn('Rental Radar page ' + page + ' could not be loaded:', error);
                scheduleRender();
            }
        }
    };

    const workers = [];
    for (let index = 0; index < Math.min(PAGE_CONCURRENCY, totalPages - 1); index += 1) {
        workers.push(worker());
    }
    await Promise.all(workers);
}

function acceptPage(page) {
    if (state.loadedPages.has(page.page)) return;
    state.loadedPages.add(page.page);
    const startIndex = state.listings.length;
    for (let index = 0; index < page.hits.length; index += 1) {
        const listing = normalizeListing(page.hits[index], startIndex + index);
        if (!state.seenIds.has(listing.id)) {
            state.seenIds.add(listing.id);
            state.listings.push(listing);
        }
    }
    updateUntouchedFacetSelections();
}

function updateUntouchedFacetSelections() {
    const facets = facetValues(state.listings);
    if (!state.bedroomsTouched) {
        state.bedrooms = new Set(facets.bedrooms.map((facet) => facet.value));
    }
}

function isAbortError(error) {
    return error && (error.name === 'AbortError' || error.code === 20);
}

function resetFilters(options = {}) {
    const facets = facetValues(state.listings);
    state.minimumPrice = null;
    state.maximumPrice = null;
    state.bedrooms = new Set(facets.bedrooms.map((facet) => facet.value));
    state.bedroomsTouched = false;
    state.selectedGroupKey = null;
    if (!options.deferRender) scheduleRender();
}

function scheduleRender(focusRequest = null) {
    if (focusRequest) state.focusRequest = focusRequest;
    if (renderFrame) return;
    renderFrame = window.requestAnimationFrame(() => {
        renderFrame = 0;
        render();
    });
}

function currentFilters() {
    return {
        minimumPrice: state.minimumPrice,
        maximumPrice: state.maximumPrice,
        bedrooms: state.bedrooms
    };
}

function buildModel() {
    const filters = currentFilters();
    const visibleListings = state.listings.filter((listing) => matchesFilters(listing, filters));
    const groups = groupVisibleListings(state.listings, filters);
    const mappableListingCount = groups.reduce((total, group) => total + group.count, 0);
    const unmappableListingCount = Math.max(0, visibleListings.length - mappableListingCount);

    if (state.selectedGroupKey && !groups.some((group) => group.key === state.selectedGroupKey)) {
        state.selectedGroupKey = null;
    }

    return {
        visibleListings,
        groups,
        mappableListingCount,
        unmappableListingCount
    };
}

function render() {
    state.model = buildModel();
    renderStatus();
    renderFilters();
    renderActiveFilters();
    renderMap();
    renderMobileToolbar();
    restoreRequestedFocus();
}

function renderStatus() {
    const loadedCount = state.listings.length;
    const expected = state.expectedHits;
    let stateName = 'success';
    let message = '';
    let retry = false;

    if (state.failedPages.has(0) && loadedCount === 0) {
        stateName = 'error';
        message = 'We could not load rental listings. Check your connection and try again.';
        retry = true;
    } else if (state.isLoading && loadedCount === 0) {
        stateName = 'loading';
        message = 'Loading ' + currentCityLabel() + ' rental listings…';
    } else if (state.isLoading) {
        stateName = 'loading';
        message = 'Showing ' + formatCount(loadedCount) + ' loaded listing' + pluralSuffix(loadedCount)
            + (expected ? ' of ' + formatCount(expected) : '') + '.';
    } else if (state.failedPages.size > 0) {
        stateName = 'partial';
        message = 'Showing ' + formatCount(loadedCount)
            + ' loaded listings; ' + formatCount(state.failedPages.size)
            + ' page' + pluralSuffix(state.failedPages.size) + ' could not be loaded.';
        retry = true;
    } else if (loadedCount > 0) {
        stateName = 'success';
        message = formatCount(loadedCount) + ' listings loaded for ' + currentCityLabel() + '.';
    } else {
        stateName = 'success';
        message = 'No rentals are available for this location right now.';
    }

    ui.appStatus.replaceChildren(createStatusBanner(stateName, message, retry));
}

function createStatusBanner(stateName, message, showRetry = false) {
    const banner = element('div', 'status-banner');
    banner.dataset.state = stateName;
    const copy = element('span', 'status-copy', message);
    banner.append(copy);
    if (showRetry) {
        const retry = element('button', 'status-retry', 'Retry');
        retry.type = 'button';
        retry.addEventListener('click', () => loadCity(state.cityId));
        banner.append(retry);
    }
    return banner;
}

function renderFilters() {
    const facets = facetValues(state.listings);
    renderPriceRangeControls();
    renderFacetActions(ui.bedroomActions, 'bedroom', facets.bedrooms.map((facet) => facet.value), state.bedrooms);

    const bedroomChips = document.createDocumentFragment();
    for (const facet of facets.bedrooms) {
        bedroomChips.append(createFilterChip(
            'bedroom',
            facet.value,
            bedroomLabel(facet.value),
            countFacetValue('bedroom', facet.value),
            state.bedrooms.has(facet.value)
        ));
    }
    ui.bedroomFilters.replaceChildren(bedroomChips);
}

function renderPriceRangeControls() {
    const minimumValue = state.minimumPrice === null ? '' : String(state.minimumPrice);
    const maximumValue = state.maximumPrice === null ? '' : String(state.maximumPrice);
    if (ui.minimumPrice.value !== minimumValue) ui.minimumPrice.value = minimumValue;
    if (ui.maximumPrice.value !== maximumValue) ui.maximumPrice.value = maximumValue;
}

function onPriceRangeChange(changedBound) {
    const minimum = selectedPrice(ui.minimumPrice.value);
    const maximum = selectedPrice(ui.maximumPrice.value);
    state.minimumPrice = minimum;
    state.maximumPrice = maximum;

    if (minimum !== null && maximum !== null && minimum > maximum) {
        if (changedBound === 'minimum') {
            state.maximumPrice = minimum;
        } else {
            state.minimumPrice = maximum;
        }
    }

    state.selectedGroupKey = null;
    scheduleRender(changedBound === 'minimum' ? 'price-minimum' : 'price-maximum');
}

function selectedPrice(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}

function renderFacetActions(container, kind, values, selected) {
    container.replaceChildren();
    const all = element('button', 'text-button', 'All');
    all.type = 'button';
    all.dataset.filterKind = kind;
    all.dataset.filterAction = 'all';
    const pressed = selected.size === values.length && values.length > 0
        ? 'true'
        : selected.size === 0 ? 'false' : 'mixed';
    all.setAttribute('aria-pressed', pressed);
    all.setAttribute('aria-label', pressed === 'mixed'
        ? 'Some ' + kind + ' filters are selected'
        : 'Select all ' + kind + ' filters');

    const clear = element('button', 'text-button', 'Clear');
    clear.type = 'button';
    clear.dataset.filterKind = kind;
    clear.dataset.filterAction = 'clear';
    clear.disabled = values.length === 0 || selected.size === 0;
    container.append(all, clear);
}

function createFilterChip(kind, value, label, count, selected) {
    const chip = element('button', 'filter-chip', null);
    chip.type = 'button';
    chip.dataset.filterKind = kind;
    chip.dataset.filterValue = String(value);
    chip.dataset.focusKey = kind + ':' + String(value);
    chip.setAttribute('aria-pressed', String(selected));
    chip.setAttribute('aria-label', label + ', ' + formatCount(count) + ' match' + pluralSuffix(count)
        + (selected ? ', selected' : ', not selected'));

    chip.append(element('span', 'filter-chip-label', label));
    chip.append(element('span', 'filter-chip-count', formatCount(count)));
    return chip;
}

function countFacetValue(kind, value) {
    const base = currentFilters();
    const filters = {
        minimumPrice: base.minimumPrice,
        maximumPrice: base.maximumPrice,
        bedrooms: kind === 'bedroom' ? undefined : base.bedrooms
    };
    let count = 0;
    for (const listing of state.listings) {
        if (!matchesFilters(listing, filters)) continue;
        if (kind === 'bedroom' && listing.bedrooms === value) count += 1;
    }
    return count;
}

function onFilterPanelClick(event) {
    const control = event.target.closest('button[data-filter-kind]');
    if (!control || !ui.filterPanel.contains(control)) return;
    const kind = control.dataset.filterKind;
    const action = control.dataset.filterAction || 'toggle';
    const rawValue = control.dataset.filterValue;
    const value = Number(rawValue);
    const selection = selectionForKind(kind);
    const allValues = allValuesForKind(kind);
    if (!selection) return;

    if (action === 'all') {
        replaceSet(selection, allValues);
    } else if (action === 'clear') {
        selection.clear();
    } else if (selection.has(value)) {
        selection.delete(value);
    } else {
        selection.add(value);
    }

    if (kind === 'bedroom') state.bedroomsTouched = true;
    state.selectedGroupKey = null;
    scheduleRender(action === 'toggle' ? kind + ':' + String(value) : null);
}

function selectionForKind(kind) {
    if (kind === 'bedroom') return state.bedrooms;
    return null;
}

function allValuesForKind(kind) {
    const facets = facetValues(state.listings);
    if (kind === 'bedroom') return facets.bedrooms.map((facet) => facet.value);
    return [];
}

function replaceSet(target, values) {
    target.clear();
    for (const value of values) target.add(value);
}

function renderActiveFilters() {
    const fragment = document.createDocumentFragment();
    const facets = facetValues(state.listings);
    appendActivePriceRange(fragment);
    appendActiveFacetChips(fragment, 'bedroom', facets.bedrooms.map((facet) => bedroomLabel(facet.value)), facets.bedrooms.map((facet) => facet.value), state.bedrooms);
    ui.activeFilters.replaceChildren(fragment);
}

function appendActivePriceRange(container) {
    if (state.minimumPrice === null && state.maximumPrice === null) return;
    let label = 'Price: ';
    if (state.minimumPrice !== null && state.maximumPrice !== null) {
        label += formatCompactPrice(state.minimumPrice) + '–' + formatCompactPrice(state.maximumPrice).replace('AED ', '');
    } else if (state.minimumPrice !== null) {
        label += 'from ' + formatCompactPrice(state.minimumPrice);
    } else {
        label += 'up to ' + formatCompactPrice(state.maximumPrice);
    }
    container.append(createActiveChip('price-range', label, '', 'restore'));
}

function appendActiveFacetChips(container, kind, labels, values, selected) {
    if (!values.length || selected.size === values.length) return;
    if (selected.size === 0) {
        const none = createActiveChip(kind, 'No ' + kind + ' filters selected', '', 'restore');
        container.append(none);
        return;
    }

    values.forEach((value, index) => {
        if (!selected.has(value)) return;
        const label = kind === 'bedroom' ? labels[index] : labels[index];
        container.append(createActiveChip(kind, label, value, 'remove'));
    });
}

function createActiveChip(kind, label, value, action) {
    const chip = element('span', 'active-filter');
    chip.append(document.createTextNode(label));
    const remove = element('button', null, '×');
    remove.type = 'button';
    remove.dataset.activeKind = kind;
    remove.dataset.activeValue = String(value);
    remove.dataset.activeAction = action;
    remove.setAttribute('aria-label', action === 'restore' ? 'Restore all ' + kind + ' filters' : 'Remove ' + label + ' filter');
    chip.append(remove);
    return chip;
}

function onActiveFilterClick(event) {
    const button = event.target.closest('button[data-active-kind]');
    if (!button) return;
    const kind = button.dataset.activeKind;
    const action = button.dataset.activeAction;
    if (kind === 'price-range') {
        state.minimumPrice = null;
        state.maximumPrice = null;
        state.selectedGroupKey = null;
        scheduleRender();
        return;
    }
    const selection = selectionForKind(kind);
    if (!selection) return;

    if (action === 'restore') {
        replaceSet(selection, allValuesForKind(kind));
    } else {
        const rawValue = button.dataset.activeValue;
        selection.delete(Number(rawValue));
    }
    if (kind === 'bedroom') state.bedroomsTouched = true;
    state.selectedGroupKey = null;
    scheduleRender();
}

function renderResults() {
    const groups = state.model.groups;
    ui.resultsCount.textContent = formatCount(groups.length) + ' location' + pluralSuffix(groups.length);
    ui.mobileResultCount.textContent = compactCount(groups.length);
    ui.resultsList.replaceChildren();

    if (groups.length === 0) {
        ui.resultsList.append(createEmptyResultsState());
        ui.loadMoreResults.hidden = true;
        return;
    }

    const fragment = document.createDocumentFragment();
    groups.slice(0, state.resultsLimit).forEach((group) => fragment.append(createResultCard(group)));
    ui.resultsList.append(fragment);

    const remaining = groups.length - state.resultsLimit;
    ui.loadMoreResults.hidden = remaining <= 0;
    ui.loadMoreResults.textContent = remaining > 0
        ? 'Show ' + formatCount(Math.min(INITIAL_RESULT_LIMIT, remaining)) + ' more locations'
        : 'All locations shown';
    updateSelectedVisuals();
}

function createEmptyResultsState() {
    const stateElement = element('div', 'empty-state');
    stateElement.append(element('div', 'empty-state-icon', '⌕'));

    if (state.failedPages.has(0) && state.listings.length === 0) {
        stateElement.append(element('h3', null, 'Listings are unavailable'));
        stateElement.append(element('p', null, 'The data source could not be reached. Try loading the city again.'));
        const retry = element('button', 'primary-button', 'Retry data load');
        retry.type = 'button';
        retry.dataset.resultAction = 'retry-data';
        stateElement.append(retry);
        return stateElement;
    }

    stateElement.append(element('h3', null, state.listings.length ? 'No rentals match these filters' : 'No listings yet'));
    stateElement.append(element('p', null, state.listings.length
        ? 'Clear one or more filters to explore available rental locations.'
        : state.isLoading ? 'The first page is still loading.' : 'Try another emirate or refresh the data.'));
    if (state.listings.length) {
        const reset = element('button', 'primary-button', 'Reset filters');
        reset.type = 'button';
        reset.dataset.resultAction = 'reset-filters';
        stateElement.append(reset);
    }
    return stateElement;
}

function createResultCard(group) {
    const card = element('article', 'result-card');
    card.dataset.groupKey = group.key;
    card.dataset.selected = String(group.key === state.selectedGroupKey);
    if (group.key === state.selectedGroupKey) card.classList.add('is-selected');

    if (group.imageUrl && isSafeHttpUrl(group.imageUrl)) {
        const image = document.createElement('img');
        image.className = 'result-card-image';
        image.src = group.imageUrl;
        image.alt = '';
        image.loading = 'lazy';
        image.addEventListener('error', () => replaceImageWithPlaceholder(image));
        card.append(image);
    } else {
        card.append(createImagePlaceholder());
    }

    const content = element('div', 'result-card-content');
    const header = element('div', 'result-card-header');
    const title = group.neighborhood || group.representative?.title || 'Rental location';
    header.append(element('h3', 'result-card-title', title));
    header.append(element('span', 'result-card-price', group.lowestPrice === null ? 'Price TBA' : 'From ' + formatShortPrice(group.lowestPrice)));
    content.append(header);

    const detailParts = [];
    if (group.propertyTypes.length) detailParts.push(group.propertyTypes.join(' · '));
    const beds = group.bedrooms.map((bedroom) => bedroomLabel(bedroom));
    if (beds.length) detailParts.push(beds.join(', '));
    content.append(element('p', 'result-card-location', detailParts.join(' · ') || 'Location details are unavailable'));

    const footer = element('div', 'result-card-footer');
    footer.append(element('span', 'listing-count', formatCount(group.count) + ' listing' + pluralSuffix(group.count)));
    const mapButton = element('button', 'view-on-map', 'View on map');
    mapButton.type = 'button';
    mapButton.dataset.resultAction = 'view-map';
    mapButton.dataset.groupKey = group.key;
    footer.append(mapButton);
    content.append(footer);

    const detailsId = 'listing-details-' + safeDomId(group.key);
    const toggle = element('button', 'listing-toggle', 'View matching listings');
    toggle.type = 'button';
    toggle.dataset.resultAction = 'toggle-listings';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', detailsId);
    content.append(toggle);

    const details = element('div', 'listing-details');
    details.id = detailsId;
    details.hidden = true;
    for (const listing of group.listings) details.append(createListingRow(listing));
    content.append(details);
    card.append(content);
    return card;
}

function createImagePlaceholder() {
    return element('div', 'result-card-image is-placeholder', '⌂');
}

function replaceImageWithPlaceholder(image) {
    if (!image || !image.parentNode) return;
    image.replaceWith(createImagePlaceholder());
}

function createListingRow(listing) {
    const row = element('div', 'listing-row');
    const details = element('div');
    details.append(element('div', 'listing-row-title', listing.title));
    const meta = [];
    if (listing.propertyType) meta.push(listing.propertyType);
    if (listing.bedrooms !== null) meta.push(bedroomLabel(listing.bedrooms));
    if (listing.size !== null && listing.size !== undefined) meta.push('Size: ' + formatSize(listing.size));
    if (meta.length) details.append(element('div', 'listing-row-meta', meta.join(' · ')));
    row.append(details);

    const right = element('div', 'listing-row-right');
    right.append(element('div', 'listing-row-price', formatPrice(listing.price)));
    if (listing.listingUrl) {
        const link = element('a', 'popup-link', 'View');
        link.href = listing.listingUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        right.append(link);
    }
    row.append(right);
    return row;
}

function onResultsListClick(event) {
    const actionElement = event.target.closest('[data-result-action]');
    if (!actionElement) return;
    const action = actionElement.dataset.resultAction;
    if (action === 'retry-data') {
        loadCity(state.cityId);
        return;
    }
    if (action === 'reset-filters') {
        resetFilters();
        return;
    }
    if (action === 'view-map') {
        closeSheets({ restoreFocus: false });
        selectGroup(actionElement.dataset.groupKey, { focusMap: true, scrollCard: false });
        return;
    }
    if (action === 'toggle-listings') {
        const card = actionElement.closest('.result-card');
        const detailsId = actionElement.getAttribute('aria-controls');
        const details = detailsId ? document.getElementById(detailsId) : card?.querySelector('.listing-details');
        if (!details) return;
        const expanded = actionElement.getAttribute('aria-expanded') === 'true';
        actionElement.setAttribute('aria-expanded', String(!expanded));
        actionElement.textContent = expanded ? 'View matching listings' : 'Hide matching listings';
        details.hidden = expanded;
    }
}

function renderMap() {
    markerLayer.clearLayers();
    markerByGroup.clear();

    state.model.groups.forEach((group) => {
        const marker = L.marker([group.latitude, group.longitude], {
            icon: createMarkerIcon(group),
            keyboard: true,
            riseOnHover: true
        });
        marker.__rentalGroupKey = group.key;
        marker.bindPopup(() => createPopup(group), {
            minWidth: 260,
            maxWidth: 314,
            autoPanPadding: [24, 24]
        });
        marker.on('click', () => {
            selectGroup(group.key);
        });
        markerLayer.addLayer(marker);
        markerByGroup.set(group.key, marker);
    });
}

function createMarkerIcon(group) {
    const bandIndex = group.priceBandIndex === -1 ? 0 : group.priceBandIndex;
    const price = group.lowestPrice === null ? 'TBA' : formatCompactPrice(group.lowestPrice);
    const badge = group.count > 1
        ? '<span class="marker-count">' + compactCount(group.count) + '</span>'
        : '';
    const selected = group.key === state.selectedGroupKey ? ' is-selected' : '';
    return L.divIcon({
        className: 'map-marker-shell',
        html: '<div class="map-marker price-band-' + bandIndex + selected + '" data-band="' + bandIndex + '">'
            + '<span class="marker-price">' + price + '</span>' + badge + '</div>',
        iconSize: [58, 50],
        iconAnchor: [29, 46],
        popupAnchor: [0, -42]
    });
}

function createPopup(group) {
    const card = element('section', 'popup-card');
    const header = element('header', 'popup-card-header');
    header.append(element('h2', 'popup-card-title', group.neighborhood || 'Rental location'));
    const subtitle = [];
    if (group.lowestPrice !== null) subtitle.push('From ' + formatPrice(group.lowestPrice));
    if (group.propertyTypes.length) subtitle.push(group.propertyTypes.join(' · '));
    header.append(element('p', 'popup-card-subtitle', subtitle.join(' · ') || 'Matching rentals'));
    header.append(element('span', 'popup-card-count', formatCount(group.count) + ' matching listing' + pluralSuffix(group.count)));
    card.append(header);

    const list = element('div', 'popup-list');
    for (const listing of group.listings) {
        const row = element('article', 'popup-listing');
        const details = element('div');
        details.append(element('div', 'popup-listing-title', listing.title));
        const meta = [];
        if (listing.propertyType) meta.push(listing.propertyType);
        if (listing.bedrooms !== null) meta.push(bedroomLabel(listing.bedrooms));
        if (listing.size !== null && listing.size !== undefined) meta.push('Size: ' + formatSize(listing.size));
        if (meta.length) details.append(element('div', 'popup-listing-meta', meta.join(' · ')));
        if (listing.listingUrl) {
            const link = element('a', 'popup-link', 'View listing');
            link.href = listing.listingUrl;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            details.append(link);
        }
        row.append(details);
        row.append(element('div', 'popup-listing-price', formatPrice(listing.price)));
        list.append(row);
    }
    card.append(list);
    return card;
}

function selectGroup(key, options = {}) {
    if (!state.model.groups.some((group) => group.key === key)) return;
    state.selectedGroupKey = key;
    updateSelectedVisuals();
    if (options.focusMap) focusGroupOnMap(key);
}

function focusGroupOnMap(key) {
    const group = state.model.groups.find((candidate) => candidate.key === key);
    const marker = markerByGroup.get(key);
    if (!group || !marker) return;
    const open = () => {
        map.flyTo([group.latitude, group.longitude], Math.max(map.getZoom(), 15), { duration: 0.45 });
        window.setTimeout(() => marker.openPopup(), 200);
    };
    if (typeof markerLayer.zoomToShowLayer === 'function') {
        markerLayer.zoomToShowLayer(marker, open);
    } else {
        open();
    }
}

function updateSelectedVisuals() {
    for (const [key, marker] of markerByGroup) {
        const node = marker.getElement();
        const pin = node && node.querySelector('.map-marker');
        if (pin) {
            const selected = key === state.selectedGroupKey;
            pin.classList.toggle('is-selected', selected);
            pin.dataset.selected = String(selected);
        }
    }
}

function renderMobileToolbar() {
    const activeCount = activeFilterCount();
    ui.openFilters.setAttribute(
        'aria-label',
        activeCount
            ? 'Open filters, ' + activeCount + ' active'
            : 'Open filters'
    );
}

function activeFilterCount() {
    const facets = facetValues(state.listings);
    let count = 0;
    if (state.minimumPrice !== null || state.maximumPrice !== null) count += 1;
    if (state.bedrooms.size !== facets.bedrooms.length) count += 1;
    return count;
}

function moveResponsiveContent() {
    const shouldUseMobile = mobileBreakpoint.matches;
    if (state.isMobile === shouldUseMobile && ui.filterPanel.parentElement) return;
    state.isMobile = shouldUseMobile;

    closeSheets({ restoreFocus: false });
    if (shouldUseMobile) {
        ui.filterSheetContent.append(
            ui.appStatus,
            ui.activeFilters,
            ui.filterPanel
        );
    } else {
        ui.sidebar.append(
            ui.appStatus,
            ui.activeFilters,
            ui.filterPanel
        );
    }
}

function openFilterSheet(trigger) {
    if (!state.isMobile) return;
    const target = ui.filterSheet;
    state.lastSheetTrigger = trigger || null;
    target.classList.add('is-open');
    target.setAttribute('aria-hidden', 'false');
    target.setAttribute('aria-modal', 'true');
    ui.sheetBackdrop.classList.add('is-visible');
    ui.sheetBackdrop.setAttribute('aria-hidden', 'false');

    const firstFocus = target.querySelector('[data-close-sheet], button, select, input, a[href]');
    window.setTimeout(() => firstFocus?.focus(), 30);
}

function closeSheets(options = {}) {
    const wasOpen = ui.filterSheet?.classList.contains('is-open');
    closeSpecificSheet(ui.filterSheet, { restoreFocus: false });
    if (ui.sheetBackdrop) {
        ui.sheetBackdrop.classList.remove('is-visible');
        ui.sheetBackdrop.setAttribute('aria-hidden', 'true');
    }
    if (wasOpen && options.restoreFocus !== false && state.lastSheetTrigger?.isConnected) {
        state.lastSheetTrigger.focus();
    }
    state.lastSheetTrigger = null;
}

function closeSpecificSheet(sheet, options = {}) {
    if (!sheet) return;
    sheet.classList.remove('is-open');
    sheet.setAttribute('aria-hidden', 'true');
    sheet.removeAttribute('aria-modal');
    if (options.restoreFocus && state.lastSheetTrigger?.isConnected) state.lastSheetTrigger.focus();
}

function onDocumentKeydown(event) {
    if (event.key === 'Escape') {
        if (ui.filterSheet.classList.contains('is-open')) {
            event.preventDefault();
            closeSheets();
        }
        return;
    }
    if (event.key !== 'Tab') return;
    const sheet = ui.filterSheet.classList.contains('is-open') ? ui.filterSheet : null;
    if (!sheet) return;

    const focusable = [...sheet.querySelectorAll(
        'button:not([disabled]), [href], select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter((candidate) => !candidate.hidden && candidate.offsetParent !== null);
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
}

function restoreRequestedFocus() {
    const requested = state.focusRequest;
    state.focusRequest = null;
    if (!requested) return;
    const button = [...document.querySelectorAll('button[data-focus-key]')]
        .find((candidate) => candidate.dataset.focusKey === requested);
    if (button) button.focus();
}

function currentCityLabel() {
    return (CITIES.find((city) => city.id === state.cityId) || CITIES[1]).label;
}

function formatCount(value) {
    return numberFormatter.format(Number.isFinite(value) ? value : 0);
}

function compactCount(value) {
    const number = Number(value) || 0;
    if (number >= 1000) return Math.round(number / 1000) + 'k';
    return String(number);
}

function formatPrice(value) {
    return typeof value === 'number' && Number.isFinite(value)
        ? aedFormatter.format(value)
        : 'Price TBA';
}

function formatSize(value) {
    return typeof value === 'number' && Number.isFinite(value)
        ? formatCount(Math.round(value)) + ' sqft'
        : 'Size unavailable';
}

function formatCompactPrice(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'TBA';
    if (value >= 1000000) return 'AED ' + (value / 1000000).toFixed(1) + 'M';
    if (value >= 1000) return 'AED ' + Math.round(value / 1000) + 'k';
    return 'AED ' + formatCount(value);
}

function formatShortPrice(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'TBA';
    return formatCompactPrice(value);
}

function bedroomLabel(value) {
    if (value === 0) return 'Studio';
    if (value === null || value === undefined) return 'Beds unknown';
    return String(value) + ' bed' + (value === 1 ? '' : 's');
}

function pluralSuffix(value) {
    return Number(value) === 1 ? '' : 's';
}

function safeDomId(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== null && text !== undefined) node.textContent = text;
    return node;
}
