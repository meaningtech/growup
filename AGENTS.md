# Growup development instructions

- Growup is isolated from Solaraf. Do not import runtime files or domain code from `../solaraf`.
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
- `scripts/migrateBrandCollections.ts` is the one-way, idempotent Growaf-to-Growup collection migration. It must validate READY `_id` indexes before scanning and must never delete or rewrite the immutable legacy source collections.
- Growup owns only `growup_users`, `growup_projects`, `growup_project_revisions` and `growup_calculation_runs`. Preserve owner isolation and every READY index: unique document `_id` indexes, sparse unique user email, `{ ownerUserId: 1, updatedAt: -1 }` for projects, `{ ownerUserId: 1, projectId: 1, revision: -1 }` for revisions and `{ ownerUserId: 1, projectId: 1, createdAt: -1 }` for calculation runs.
- Google sign-in is optional. Anonymous users can analyse and design. Saving, reopening and exporting stored projects require a verified Google ID token and the signed HttpOnly `growup_session` cookie.
- The AI assistant is provider-agnostic through an OpenAI-compatible server adapter. Keep provider keys server-only, resolve proposed species against the curated catalogue, validate every action, and require user confirmation before mutation.
- `server/economics.ts` resolves one global USD planning basket through a live country-to-currency mapping and USD exchange table. Never add country-specific pricing branches; local rates are explicit user overrides.
- `server/export.ts` is the only project export composer. GeoJSON and CSV output must remain deterministic for the same stored project and include calculation/model metadata without credentials or private identity data.
- The production container is a two-stage Node 20 image. Cloud Run injects PostGIS, Mongo, Maps, OAuth, AI and session credentials through environment variables or Secret Manager; no deployment secret belongs in the image.
- Production runs as Cloud Run service `growup` in `europe-west1` with the dedicated `growup-runtime` service account and `growup-*` secrets. It intentionally mounts the existing Cloud SQL instance whose immutable technical resource name is `growaf-postgis`; do not duplicate or rename that data service during brand changes.
- The canonical public origin is `https://growup.earth`. Keep browser-key referrers and the Google OAuth authorized JavaScript origin aligned with it; Cloud Run-generated hostnames are operational endpoints only.

## API surface

- Runtime/auth: `GET /api/health`, `GET /api/config`, `GET /api/auth/session`, `POST /api/auth/google`, `POST /api/auth/logout`, `PUT /api/user/preferences/onboarding`.
- Site/data: `GET /api/locations/search`, `POST /api/site/validate`, `POST /api/site/profile`, `POST /api/site/profile/override`, `POST /api/geometry/metrics`.
- Species/design: `GET /api/catalog/stats`, `GET /api/catalog/search`, `GET /api/design-species`, `POST /api/recommendations`, `POST /api/layout/generate`, `POST /api/layout/regenerate`.
- Water/cost: `POST /api/irrigation/calculate`, `POST /api/costs/calculate`.
- Assistant: `GET /api/assistant/status`, `POST /api/assistant/plan`.
- Private projects: `GET /api/projects`, `GET|PUT /api/projects/:id`, `GET /api/projects/:id/revisions`, `GET /api/projects/:id/revisions/:revision`, `POST /api/projects/:id/revisions/:revision/restore`, `GET /api/projects/:id/calculations/:calculationRunId`, `GET /api/projects/:id/export.geojson`, `GET /api/projects/:id/export.csv`.

New or changed backend behavior must extend `server/app.integration.test.ts`; real persistence changes must also extend the opt-in `server/mongo.live.integration.test.ts` and clean up exact test IDs.

## Domain invariants

- `DesignConfiguration.objectives` controls suitability weights, species ordering and layout composition targets. Normalize every untrusted configuration before use.
- `LayoutVariant.composition` records actual stratum/succession counts plus productive, native and nitrogen-fixer shares and their targets.
- Species with `invasiveStatus: blocked` never enter a layout. `monitor` species can never be rated `recommended`. Missing critical soil pH caps a result at `conditional`.
- Every layout is deterministic for the same normalized site, species, configuration and seed. Existing woody Sentinel polygons, field-observed trees, exclusions, paths and setbacks are hard placement constraints.
- `LayoutVariant.generation` records the layout engine version, seed, full/partial mode, locked-tree count, assumptions and conflicts. Partial regeneration must preserve every valid locked tree byte-for-byte and reflow only unlocked candidates.
- `LayoutVariant.machinery` records exact corridor centre lines, required widths, turning areas and clearance results. Planned trees, machinery, irrigation, boundary, constraints, infrastructure and evidence overlays are independently switchable map layers.
- Machinery-space reservation is opt-in. `DEFAULT_MACHINERY_CONFIGURATION.enabled` and normalization of omitted machinery input must remain `false`; only an explicit user action may reserve corridors and turning headlands.
- Every authenticated save appends an immutable project revision and, when calculated results exist, an immutable calculation run. Use optimistic revision checks; never overwrite revision history or embed an unbounded history array in the current project document.
- First-run onboarding is skippable and resumable. Keep its latest checkpoint and project name in `growup:onboarding:v1`; authenticated users also sync the same bounded preference into their existing `growup_users` document. The tour must guide the real site, evidence, species, layout, water and cost actions rather than simulating a separate workflow.
- Site-profile overrides require a value, reason, source label, observation date and immutable audit entry; recalculated suitability must consume the overridden profile rather than mutating provider evidence.
- `GrowthState` exposes deterministic low/base/high height and crown estimates plus model version, hierarchy and confidence. Zero values outside the active planting/removal interval are intentional.
- `IrrigationConfiguration` includes source, flow, pressure, emitter, distribution-efficiency, operating-window and manual line-override inputs. `IrrigationNetworkPlan` must preserve source placement, editable geometry, obstacle routing, head/flow checks, measured versus purchase pipe quantities and the component bill of materials.
- Economic values use `EconomicConfiguration.baseCurrencyCode = USD`; displayed currency is a conversion estimate unless the user supplies local rates. Syntropic operating curves may decline with succession, while establishment CAPEX remains a historical total.
- Printable operational schedules must derive plant counts, labour, irrigation procurement, monthly demand, machinery reserves and evidence records from the selected generated design; never introduce placeholder quantities.
- Sentinel-1 output is a same-orbit backscatter anomaly, not volumetric soil moisture. Keep this distinction in UI, API and exports.
- Mobile map controls must remain below Google map-type controls, coach panels and toasts must remain above the safe-area bottom navigation, and the desktop map/inspector split must collapse without horizontal overflow at 820 px and below.
- Public metadata uses `https://growup.earth/` as the canonical URL. Keep Open Graph/Twitter metadata, `public/growup-social-card.png` at 1200×630, `robots.txt`, `sitemap.xml`, and `llms.txt` aligned whenever the public product description changes.

## Verification

- Baseline: `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`.
- The deployed acceptance workflow is `GROWUP_BASE_URL=<cloud-run-url> npm run test:acceptance`; it must exercise live evidence, layout, hydraulics, economics and perimeter planting against one explicit imported field.
- Property and performance gates live in `src/lib/layout.property.test.ts` and `server/performance.test.ts`; do not weaken plantability, determinism, catalogue, growth or layout thresholds to hide regressions.
- Live Mongo: set `GROWUP_LIVE_MONGO_TEST=1` with the guarded existing `MONGODB_URI` and `AUTH_SESSION_SECRET`, then run `npx vitest run server/mongo.live.integration.test.ts`.
- Browser behavior must be verified with explicit imported field fixtures; production must never bundle or auto-load a localized default field. Keep screenshots and generated test artifacts out of Git.
