import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPercentagePriceScale,
  extractHits,
  groupVisibleListings,
  isSafeHttpUrl,
  matchesFilters,
  normalizeListing,
  percentagePriceBandIndex
} from '../assets/rental-core.js';

function rawListing(overrides = {}) {
  return {
    objectID: 'listing-1',
    name: 'Central apartment',
    price: 55000,
    bedrooms: 1,
    property_info: [
      { id: 'property_type', value: { en: 'Apartment' } }
    ],
    _geoloc: { lat: 25.2048, lng: 55.2708 },
    absolute_url: { en: 'https://example.test/listing-1' },
    photos: [{ url: 'https://images.example.test/listing-1.jpg' }],
    neighborhoods: [{ name: 'Downtown Dubai' }],
    ...overrides
  };
}

test('extractHits accepts each supported search-response envelope', () => {
  const hits = [rawListing(), rawListing({ objectID: 'listing-2' })];

  assert.deepEqual(extractHits({ hits }), hits);
  assert.deepEqual(extractHits({ results: [{ hits }] }), hits);
  assert.deepEqual(extractHits([{ hits }]), hits);
});

test('extractHits rejects malformed response envelopes', () => {
  assert.throws(() => extractHits(null));
  assert.throws(() => extractHits({ results: [{}] }));
  assert.throws(() => extractHits({ hits: 'not-an-array' }));
});

test('normalizeListing keeps conventional coordinates and corrects reversed UAE coordinates', () => {
  const conventional = normalizeListing(rawListing(), 0);
  const reversed = normalizeListing(rawListing({
    objectID: 'reversed',
    _geoloc: { lat: 55.2708, lng: 25.2048 }
  }), 1);

  assert.equal(conventional.latitude, 25.2048);
  assert.equal(conventional.longitude, 55.2708);
  assert.equal(reversed.latitude, 25.2048);
  assert.equal(reversed.longitude, 55.2708);
  assert.equal(conventional.propertyType, 'Apartment');
  assert.equal(conventional.price, 55000);
  assert.equal(conventional.bedrooms, 1);
});

test('normalization is resilient to optional or malformed listing fields', () => {
  const listing = normalizeListing({
    id: 42,
    price: 'not a price',
    bedrooms: 'unknown',
    property_info: null,
    photos: null,
    neighborhoods: null,
    _geoloc: { lat: 'invalid', lng: null },
    absolute_url: { en: 'javascript:alert(1)' }
  }, 7);

  assert.equal(listing.id, '42');
  assert.equal(listing.price, null);
  assert.equal(listing.bedrooms, null);
  assert.equal(listing.propertyType, null);
  assert.equal(listing.latitude, null);
  assert.equal(listing.longitude, null);
  assert.equal(listing.listingUrl, null);
});

test('only http and https URLs are accepted for external links', () => {
  assert.equal(isSafeHttpUrl('https://example.test/property'), true);
  assert.equal(isSafeHttpUrl('http://example.test/property'), true);
  assert.equal(isSafeHttpUrl('javascript:alert(1)'), false);
  assert.equal(isSafeHttpUrl('data:text/html,unsafe'), false);
  assert.equal(isSafeHttpUrl('not a URL'), false);
  assert.equal(isSafeHttpUrl(null), false);
});

test('percentage price scale creates five live 20 percent intervals', () => {
  const scale = createPercentagePriceScale(0, 100000);
  assert.equal(scale.length, 5);
  assert.deepEqual(scale.map((band) => [band.minimum, band.maximum]), [
    [0, 20000],
    [20000, 40000],
    [40000, 60000],
    [60000, 80000],
    [80000, 100000]
  ]);
  assert.equal(percentagePriceBandIndex(20000, 0, 100000), 0);
  assert.equal(percentagePriceBandIndex(20001, 0, 100000), 1);
  assert.equal(percentagePriceBandIndex(100000, 0, 100000), 4);
  assert.equal(percentagePriceBandIndex(250000, 0, 100000), 4);
  assert.equal(percentagePriceBandIndex(null, 0, 100000), -1);
});

test('minimum and maximum price filters use an inclusive continuous range', () => {
    const lower = normalizeListing(rawListing({ objectID: 'lower', price: 50000 }), 0);
    const inside = normalizeListing(rawListing({ objectID: 'inside', price: 55000 }), 1);
    const upper = normalizeListing(rawListing({ objectID: 'upper', price: 60000 }), 2);
    const above = normalizeListing(rawListing({ objectID: 'above', price: 60001 }), 3);
    const filters = {
        minimumPrice: 50001,
        maximumPrice: 60000,
        propertyTypes: new Set(['Apartment']),
        bedrooms: new Set([1])
    };

    assert.equal(matchesFilters(lower, filters), false);
    assert.equal(matchesFilters(inside, filters), true);
    assert.equal(matchesFilters(upper, filters), true);
    assert.equal(matchesFilters(above, filters), false);
});

test('one filter predicate drives both matching and exact-coordinate grouping', () => {
  const listings = [
    normalizeListing(rawListing({ objectID: 'a', price: 55000 }), 0),
    normalizeListing(rawListing({ objectID: 'b', price: 53000 }), 1),
    normalizeListing(rawListing({
      objectID: 'c',
      price: 55000,
      bedrooms: 2,
      property_info: [{ id: 'property_type', value: { en: 'Villa' } }],
      _geoloc: { lat: 25.1972, lng: 55.2744 }
    }), 2),
    normalizeListing(rawListing({
      objectID: 'd',
      price: 35000,
      _geoloc: { lat: 25.1925, lng: 55.2820 }
    }), 3)
  ];
  const filters = {
    minimumPrice: 50001,
    maximumPrice: 60000,
    propertyTypes: new Set(['Apartment']),
    bedrooms: new Set([1])
  };

  assert.equal(matchesFilters(listings[0], filters), true);
  assert.equal(matchesFilters(listings[2], filters), false);
  assert.equal(matchesFilters(listings[3], filters), false);

  const groups = groupVisibleListings(listings, filters);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].latitude, 25.2048);
  assert.equal(groups[0].longitude, 55.2708);
  assert.equal(groups[0].lowestPrice, 53000);
  assert.deepEqual(groups[0].listings.map((listing) => listing.id).sort(), ['a', 'b']);
});

test('empty active facet sets produce no matches and no map groups', () => {
  const listing = normalizeListing(rawListing(), 0);
  const filters = {
    propertyTypes: new Set(['Apartment']),
    bedrooms: new Set()
  };

  assert.equal(matchesFilters(listing, filters), false);
  assert.deepEqual(groupVisibleListings([listing], filters), []);
});
