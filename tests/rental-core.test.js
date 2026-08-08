import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RENTAL_PRICE_BANDS,
  extractHits,
  groupVisibleListings,
  isSafeHttpUrl,
  matchesFilters,
  normalizeListing,
  rentalPriceBandIndex,
  rentalPriceColor
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

test('fixed rental price bands use the requested colors and lower-edge ownership', () => {
  assert.deepEqual(RENTAL_PRICE_BANDS.map(({ label, color }) => [label, color]), [
    ['0–20K', '#8E44AD'],
    ['20–30K', '#2980B9'],
    ['30–35K', '#00BBD4'],
    ['35–40K', '#009688'],
    ['40–45K', '#27AE60'],
    ['45–50K', '#F1C40F'],
    ['50–55K', '#F39C12'],
    ['55–60K', '#E67E22'],
    ['60–80K', '#E91E63'],
    ['80K+', '#C0392B']
  ]);

  assert.deepEqual(
    [0, 20000, 20001, 30000, 30001, 35000, 35001, 40000, 40001, 45000,
      45001, 50000, 50001, 55000, 55001, 60000, 60001, 80000, 80001, 100000, 250000]
      .map(rentalPriceBandIndex),
    [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 9]
  );
  assert.equal(rentalPriceBandIndex(null), -1);
  assert.equal(rentalPriceColor(null), '#64748b');
  assert.equal(rentalPriceColor(250000), '#C0392B');
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

test('the default map filters keep one-bedroom rentals up to AED 47K', () => {
  const matching = normalizeListing(rawListing({ objectID: 'matching', price: 47000, bedrooms: 1 }), 0);
  const tooExpensive = normalizeListing(rawListing({ objectID: 'expensive', price: 47001, bedrooms: 1 }), 1);
  const wrongBedrooms = normalizeListing(rawListing({ objectID: 'two-bed', price: 45000, bedrooms: 2 }), 2);
  const filters = { maximumPrice: 47000, bedrooms: [1] };

  assert.equal(matchesFilters(matching, filters), true);
  assert.equal(matchesFilters(tooExpensive, filters), false);
  assert.equal(matchesFilters(wrongBedrooms, filters), false);
  assert.deepEqual(groupVisibleListings([matching, tooExpensive, wrongBedrooms], filters)
    .flatMap((group) => group.listings.map((listing) => listing.id)), ['matching']);
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
  assert.equal(rentalPriceColor(groups[0].lowestPrice), '#F39C12');
  assert.deepEqual(groups[0].listings.map((listing) => listing.id).sort(), ['a', 'b']);
});

test('location groups order rentals by price with deterministic ties and unavailable prices last', () => {
  const listings = [
    normalizeListing(rawListing({ objectID: 'unpriced', name: 'Unpriced home', price: null }), 0),
    normalizeListing(rawListing({ objectID: 'high', name: 'Higher price', price: 36000 }), 1),
    normalizeListing(rawListing({ objectID: 'tie-b', name: 'Same title', price: 34000 }), 2),
    normalizeListing(rawListing({ objectID: 'tie-a', name: 'Same title', price: 34000 }), 3),
    normalizeListing(rawListing({ objectID: 'cheapest', name: 'A first title', price: 34000 }), 4),
    normalizeListing(rawListing({ objectID: 'middle', name: 'Middle price', price: 35900 }), 5)
  ];

  const [group] = groupVisibleListings(listings);

  assert.deepEqual(group.listings.map((listing) => listing.id), [
    'cheapest',
    'tie-a',
    'tie-b',
    'middle',
    'high',
    'unpriced'
  ]);
  assert.equal(group.lowestPrice, 34000);
  assert.equal(group.representative.id, 'cheapest');
  assert.equal(group.listings[0], group.representative);
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
