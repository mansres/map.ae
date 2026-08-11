import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_CITY_ID,
  buildRentalSearchPayload,
  cityForId,
  createDefaultFilters
} from '../src/data/rental-data.js';
import { rentalDataStatusFor, shouldRefreshOnRetry } from '../src/data/rental-state.js';
import {
  groupInBounds,
  mapBoundsFromRegion,
  retainSelectedGroup,
  toggleSelection
} from '../src/utils/rental-view.js';

test('native filter reset and city selection preserve the web defaults', () => {
  const first = createDefaultFilters();
  const second = createDefaultFilters();

  assert.deepEqual(first, { maxPrice: 47_000, bedrooms: [1], propertyTypes: null });
  assert.notEqual(first.bedrooms, second.bedrooms);
  assert.equal(cityForId(DEFAULT_CITY_ID).label, 'Dubai');
  assert.equal(cityForId('not-a-city').id, DEFAULT_CITY_ID);
});

test('native search payload keeps the existing city and all-emirates request semantics', () => {
  const cityParams = new URLSearchParams(buildRentalSearchPayload('2', 3).requests[0].params);
  const allParams = new URLSearchParams(buildRentalSearchPayload('0', 0).requests[0].params);

  assert.equal(cityParams.get('page'), '3');
  assert.equal(cityParams.get('hitsPerPage'), '1000');
  assert.match(cityParams.get('filters'), /"city\.id"=2/);
  assert.doesNotMatch(allParams.get('filters'), /"city\.id"=/);
});

test('viewport bounds retain only markers visible in the map region', () => {
  const bounds = mapBoundsFromRegion({
    latitude: 25.2,
    longitude: 55.27,
    latitudeDelta: 0.2,
    longitudeDelta: 0.3
  });

  assert.equal(groupInBounds({ latitude: 25.21, longitude: 55.28 }, bounds), true);
  assert.equal(groupInBounds({ latitude: 25.5, longitude: 55.28 }, bounds), false);
  assert.equal(groupInBounds({ latitude: 25.21, longitude: 55.6 }, bounds), false);
});

test('marker selection is retained only while its exact-coordinate group remains visible', () => {
  const selected = { key: '25.2048,55.2708' };
  const other = { key: '25.1972,55.2744' };

  assert.equal(retainSelectedGroup(selected, [selected, other]), selected);
  assert.equal(retainSelectedGroup(selected, [other]), null);
  assert.equal(retainSelectedGroup(null, [other]), null);
});

test('multi-select chips and retry statuses match the mobile loader rules', () => {
  assert.deepEqual(toggleSelection([1], 2), [1, 2]);
  assert.equal(toggleSelection([1], 1), null);
  assert.equal(rentalDataStatusFor({ isLoading: true, loadedPageCount: 1, failedPageCount: 0, failedFirstPage: false }), 'loading');
  assert.equal(rentalDataStatusFor({ isLoading: false, loadedPageCount: 0, failedPageCount: 1, failedFirstPage: true }), 'error');
  assert.equal(rentalDataStatusFor({ isLoading: false, loadedPageCount: 2, failedPageCount: 1, failedFirstPage: false }), 'partial');
  assert.equal(rentalDataStatusFor({ isLoading: false, loadedPageCount: 2, failedPageCount: 0, failedFirstPage: false }), 'ready');
  assert.equal(shouldRefreshOnRetry({ currentCityId: '2', sessionCityId: '2', isLoading: false, failedPages: [2] }), false);
  assert.equal(shouldRefreshOnRetry({ currentCityId: '2', sessionCityId: '2', isLoading: false, failedPages: [0] }), true);
});
