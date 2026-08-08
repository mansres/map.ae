# Rental Radar

Rental Radar is a map-only Dubai rental browser built with React, TypeScript,
Vite, React-Leaflet, and Leaflet. The interface renders one marker for each
exact rental location and keeps co-located rentals together in the marker
popup.

## Product behavior

- Load Dubai rental listings progressively from the configured search endpoint.
- Filter from the bottom-corner drawer; one bedroom and AED 47K maximum are selected by default.
- Color location markers with ten fixed annual-price bands from AED 0–20K to AED 80K+.
- Browse every rental at a location from its marker popup.
- Use standard OpenStreetMap by default, with Light, Dark, and Satellite base-map choices.
- Recenter the map on the browser's current location and retry partial or failed data loads.

The app uses the existing authorized worker endpoint by default. Set
`window.RENTAL_RADAR_API_URL` before the app loads only when hosting an
authorized alternative.

## Development

```powershell
npm ci
npm run dev
```

Run unit tests and create the production output:

```powershell
npm test
npm run build
```

`dist/` is the deployable static site. Vite is configured with `base: './'`,
so the same output works at a GitHub Pages project URL such as
`https://mansres.github.io/map.ae/`.

## Data safeguards

- Supports `[{ hits: [...] }]`, `{ results: [{ hits: [...] }] }`, and
  `{ hits: [...] }` response envelopes.
- Normalizes malformed optional fields and validates listing URLs.
- Detects both conventional and reversed UAE latitude/longitude payloads.
- Keeps exact-coordinate rentals together without proximity clustering.
