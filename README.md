# Growaf

Growaf is a map-first agroforestry design configurator. It turns an editable site boundary, a selected plant palette, and management constraints into an explainable syntropic planting layout with species-specific crowns, a growth timeline, and irrigation demand estimates.

The implementation specification is in [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md).

## Current status

The workflow is location-independent and starts with an empty workspace. Runtime tests import explicit temperate and equatorial field fixtures, and cover:

- editable Google satellite boundaries and no-plant exclusions;
- Open-Meteo climate and terrain, SoilGrids soil properties, Nominatim and OSM context;
- Sentinel-2 NDVI/NDMI/NDWI/BSI and Sentinel-1 same-orbit moisture-context signals;
- existing woody-vegetation protection using seasonally separated Sentinel-2 observations, 2021–2023 annual tree classes, ESA WorldCover and the Copernicus 5 m Woody Vegetation Layer;
- objective-weighted, evidence-ranked species selection with explainable components, invasive-species safety gates and linked sources;
- six planting systems, full-field and perimeter planting, three deterministic layouts, locked partial regeneration, species-parameterized growth uncertainty, solar/shade assessment and composition targets;
- independently switchable boundary, constraint, infrastructure, existing-vegetation, planned-tree, machinery, irrigation and satellite map layers;
- editable irrigation sizing, pipe routing and bill of materials, annual water/energy cost, plant purchase cost and planting person-hours;
- PostGIS geometry validation plus owner-isolated project persistence in Growaf-specific collections on the existing Mongo-compatible database instance;
- optional Google sign-in: anonymous users can analyse and design, while authenticated users can save private projects;
- reproducible GeoJSON and per-tree CSV exports with site infrastructure, protected vegetation, machinery, irrigation, model metadata, growth ranges and unit planting costs;
- a provider-agnostic AI planning assistant that can propose catalogue-backed species and project changes, while Growaf validates every action and requires explicit confirmation before applying it.

No pilot parcel is loaded in production. The design-ready ecological catalogue is a deliberately validated subset of the much larger global taxonomy search index. Jurisdiction-level nativeness and invasiveness are reported only where supporting evidence exists; unknown regions remain explicitly unclassified. Contrasting field geometries are isolated test fixtures used to prove that location, economics, terrain, satellite and irrigation logic are selected dynamically.

## Run locally

Requirements: Node.js 20+, Docker and a Google Maps browser key authorized for the local origin.

```bash
docker compose up -d
npm ci
npm run db:migrate
MONGODB_URI=... AUTH_SESSION_SECRET=... GOOGLE_MAPS_BROWSER_API_KEY=... AI_PROVIDER_API_KEY=... npm run dev
```

The default PostGIS URL is `postgresql://growaf:growaf@127.0.0.1:55432/growaf`; it is used only for authoritative geometry operations. Project and user documents use the exact Mongo-compatible database selected through `MONGODB_URI`, with dedicated `growaf_users` and `growaf_projects` collections.
The configured AI-provider credential is read only by the API process. The browser receives a configured flag and model capability metadata, never the credential. The current deployment uses the OpenAI-compatible DeepSeek API through the provider adapter.

## Verification

```bash
npm run typecheck
npm test
GROWAF_BASE_URL=http://localhost:5174 npm run test:e2e
npm run build
```

The live satellite tests require access to Microsoft Planetary Computer, Copernicus Discomap, Open-Meteo, SoilGrids, Nominatim and Overpass. `e2e/assistant-live.spec.ts` additionally executes a real provider-backed AI proposal when the server is configured, takes a pre-confirmation checkpoint and verifies the confirmed project update.
