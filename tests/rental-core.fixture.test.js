import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    extractSearchPage,
    groupVisibleListings,
    matchesFilters,
    normalizeListing,
    priceBandIndex
} from '../assets/rental-core.js';

const fixturePath = process.env.RENTAL_FIXTURE;

test('the supplied 1,000-listing fixture keeps map groups and filters in sync', {
    skip: fixturePath ? false : 'Set RENTAL_FIXTURE to run this optional full-payload regression test.'
}, () => {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const page = fixture[0];

    for (const envelope of [fixture, { results: [page] }, page]) {
        assert.equal(extractSearchPage(envelope).hits.length, 1000);
    }

    const listings = extractSearchPage(fixture).hits.map(normalizeListing);
    assert.equal(listings.length, 1000);
    assert.equal(new Set(listings.map((listing) => listing.coordinateKey)).size, 613);
    assert.deepEqual(
        [listings[0].latitude, listings[0].longitude],
        [25.06631350370958, 55.20364156143339]
    );

    const allPropertyTypes = new Set(listings.map((listing) => listing.propertyType).filter(Boolean));
    const filters = {
        priceBands: new Set([4]),
        propertyTypes: allPropertyTypes,
        bedrooms: new Set([1])
    };
    const visible = listings.filter((listing) => matchesFilters(listing, filters));
    const groups = groupVisibleListings(listings, filters);

    assert.equal(priceBandIndex(50000), 3);
    assert.equal(priceBandIndex(50001), 4);
    assert.equal(priceBandIndex(60000), 4);
    assert.equal(visible.length, 110);
    assert.equal(groups.length, 89);
    assert.equal(groups.reduce((total, group) => total + group.listings.length, 0), 110);
});
