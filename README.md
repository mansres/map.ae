# Rental Radar

Rental Radar is a static, map-first rental browser. It groups listings at the
same location, keeps the map and result cards in sync, and filters live by
location, price band, property type, and bedrooms.

## Run locally

The page uses browser modules, so serve the folder rather than opening
index.html directly from file URLs.

    python -m http.server 4173 --bind 127.0.0.1

Then open http://127.0.0.1:4173/.

The page reads from the existing authorized worker endpoint by default. A host
can override it before the application module loads:

    <script>
      window.RENTAL_RADAR_API_URL = 'https://your-authorized-endpoint.example';
    </script>

Supported response envelopes are:

- [{ "hits": [...] }]
- { "results": [{ "hits": [...] }] }
- { "hits": [...] }

## Test

The pure data/filtering logic uses Node's built-in test runner:

    npm test

To also run the regression test against the supplied full sample payload
without committing that large data file:

    $env:RENTAL_FIXTURE = 'C:\path\to\pasted-text.txt'
    npm test

## Notes

- The source payload's geographic values can arrive with latitude and
  longitude reversed; Rental Radar validates and normalizes either order.
- Map pins, popups, grouped result cards, summary metrics, and distribution
  bars all use the same filtered listing set.
- Use only data sources you are authorized to access or display.
