# Growaf development instructions

- Growaf is isolated from Solaraf. Do not import runtime files or domain code from `../solaraf`.
- Keep code, tests, documentation, comments, and commits in English.
- Never expose credentials in source, logs, test fixtures, screenshots, or exports.
- All environmental, botanical, price, and cost values shown to users require a source, observation date or version, and confidence level.
- Unknown provider values remain unknown. Do not silently replace them with invented defaults.
- Backend and API behavior requires integration tests.
- Production code uses static imports only.
- Runtime-test behavior changes before committing or pushing.

## Current architecture

- `src/` is the React/Vite map-first client. `server/` is the Express API. Shared domain contracts live in `src/types.ts`; deterministic calculation code lives in `src/lib/`.
- PostGIS is authoritative only for boundary, exclusion, path and protected-tree geometry validation/measurement. Do not store project documents in PostGIS.
- Project persistence reuses the explicitly configured Firestore Enterprise Mongo-compatible database path `/solaraf` as infrastructure only. Runtime code must pass the host/database guard in `server/mongo.ts`; do not create another database or Mongo user.
- Growaf owns only `growaf_users` and `growaf_projects`. Preserve owner isolation and the READY indexes: unique user `_id`, unique sparse email, unique project `_id`, and `{ ownerUserId: 1, updatedAt: -1 }`.
- Google sign-in is optional. Anonymous users can analyse and design. Saving, reopening and exporting stored projects require a verified Google ID token and the signed HttpOnly `growaf_session` cookie.
- The AI assistant is provider-agnostic through an OpenAI-compatible server adapter. Keep provider keys server-only, resolve proposed species against the curated catalogue, validate every action, and require user confirmation before mutation.

## API surface

- Runtime/auth: `GET /api/health`, `GET /api/config`, `GET /api/auth/session`, `POST /api/auth/google`, `POST /api/auth/logout`.
- Site/data: `GET /api/locations/search`, `POST /api/site/validate`, `POST /api/site/profile`, `POST /api/geometry/metrics`.
- Species/design: `GET /api/catalog/stats`, `GET /api/catalog/search`, `GET /api/design-species`, `POST /api/recommendations`, `POST /api/layout/generate`.
- Water/cost: `POST /api/irrigation/calculate`, `POST /api/costs/calculate`.
- Assistant: `GET /api/assistant/status`, `POST /api/assistant/plan`.
- Private projects: `GET /api/projects`, `GET|PUT /api/projects/:id`, `GET /api/projects/:id/export.geojson`.

New or changed backend behavior must extend `server/app.integration.test.ts`; real persistence changes must also extend the opt-in `server/mongo.live.integration.test.ts` and clean up exact test IDs.

## Domain invariants

- `DesignConfiguration.objectives` controls suitability weights, species ordering and layout composition targets. Normalize every untrusted configuration before use.
- `LayoutVariant.composition` records actual stratum/succession counts plus productive, native and nitrogen-fixer shares and their targets.
- Species with `invasiveStatus: blocked` never enter a layout. `monitor` species can never be rated `recommended`. Missing critical soil pH caps a result at `conditional`.
- Every layout is deterministic for the same normalized site, species, configuration and seed. Existing woody Sentinel polygons, field-observed trees, exclusions, paths and setbacks are hard placement constraints.
- Sentinel-1 output is a same-orbit backscatter anomaly, not volumetric soil moisture. Keep this distinction in UI, API and exports.

## Verification

- Baseline: `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`.
- Live Mongo: set `GROWAF_LIVE_MONGO_TEST=1` with in-memory `MONGODB_URI` and `AUTH_SESSION_SECRET`, then run `npx vitest run server/mongo.live.integration.test.ts`.
- Browser behavior must be verified against the real default Ragusa Ibla field. Keep screenshots and generated test artifacts out of Git.
