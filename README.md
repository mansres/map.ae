# Rental Radar

Rental Radar is a mobile-first rental map built with React, TypeScript,
Tailwind, Leaflet, and clustered markers. It keeps the map, cards, filters,
and loading state synchronized from one normalized listing model.

## Product behavior

- Search neighbourhoods and listing text locally as data progressively loads.
- Filter by city, min/max AED budget, bedrooms, and home type.
- Browse color-coded price markers, clustered locations, result cards, and a
  selected property preview.
- Keep recent searches, saved searches, favorites, theme, and active filters
  in browser storage.
- Load all advertised endpoint pages with a maximum of three concurrent
  requests; stale city requests are cancelled and failed pages can be retried.

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

## GitHub Pages

The included workflow at `.github/workflows/deploy-pages.yml` builds and
deploys `dist/` when `main` is pushed. In the GitHub repository settings,
choose **GitHub Actions** as the Pages source once.

## Data safeguards

- Supports `[{ hits: [...] }]`, `{ results: [{ hits: [...] }] }`, and
  `{ hits: [...] }` response envelopes.
- Normalizes malformed optional fields and validates listing URLs.
- Detects both conventional and reversed UAE latitude/longitude payloads.
- Uses the same individual-listing predicate for marker groups and cards,
  preventing a matching rental from being hidden by a colocated listing.
