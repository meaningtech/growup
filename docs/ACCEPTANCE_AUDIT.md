# Growaf completion audit

Audit date: 2026-07-21. The authoritative acceptance scope is the original user request plus `PROJECT_PLAN.md`, especially Sections 5, 17, 18 and 22. A row is complete only when current code and a repeatable runtime or test artifact prove it.

| Requirement | Current evidence | Status | Remaining acceptance evidence |
| --- | --- | --- | --- |
| Isolated Growaf runtime | Independent package, environment example, Docker PostGIS and application identity under `growaf/` | Proven | Final clean-room startup check |
| Real Ragusa Ibla field | Default 2,746 m² field, live Google satellite view and provider-backed profile | Proven | Repeat in final complete workflow |
| Location, terrain, climate, soil and land cover | Live Nominatim, Open-Meteo and SoilGrids profile with evidence records | Proven for pilot | Add editable overrides and fuller soil/drainage fields |
| Sentinel water context | Sentinel-2 indices and same-orbit Sentinel-1 anomaly from Planetary Computer | Proven | Add complete calculation snapshot/version metadata |
| Existing-tree detection | Multi-date NDVI persistence plus independent annual/tree/woody layers; known-tree control test | Proven | Keep regression in final suite |
| Species catalogue | Switchboard 4.0 and GlobUNT search, tree/GlobUNT/design-ready filters, 51 design-ready profiles, evidence-linked inspector and layout composition targets | Partial | Add native/role/stratum/stage/evidence filters, explicit expert-review records and fuller source-stack coverage |
| Explainable suitability | Objective-normalized weights, component scores/explanations, linked sources, hard invasive gate, monitored-species cap, reasons, mitigations and critical missing-pH gate | Proven for current model | Add auditable user overrides when editable site fields are introduced |
| Site authoring | Boundary drawing/editing and exclusion drawing | Partial | Import, holes, setbacks, paths, access/water points, validation and complete command history |
| Three deterministic variants | Three stable layouts with reproducible tree IDs and protected-area clipping | Partial | Expose seeds/assumptions, configurable objectives, local conflict audit and locked partial regeneration |
| Editable individual plants | Select, add, move, lock, delete and tree undo/redo | Partial | Replace, group/row operations, constraint feedback and non-generic procedural crown rendering on the map |
| Growth timeline | Deterministic age-dependent height/crown and active/removal state | Partial | Low/base/high uncertainty, model levels, events, composition metrics, season and event tests |
| Irrigation | FAO-style monthly crop demand, effective rain, efficiency, wetted area, peak, install and annual operating cost | Partial | Daily/root-zone audit, editable assumptions, zone geometry and independent calculation fixtures |
| Plant and planting costs | Per-species unit purchase cost and person-hours, regional source basis | Proven for pilot | Preserve in versioned calculation snapshot and exports |
| Persistence | PostGIS geometry validation plus owner-isolated users/projects in exact existing Mongo-compatible database, dedicated collections, READY unique/compound indexes, point and owner-list query plans, live integration write/read/isolation/cleanup | Partial | Immutable revisions/calculation runs, autosave/recovery and authenticated browser reload test |
| Exports | GeoJSON site, exclusions, protected vegetation and tree points | Partial | CSV, re-import, selected-year crowns, rows/zones, source/model metadata and printable schedule |
| Provider-agnostic AI assistant | Real provider-backed request through the current DeepSeek adapter, server-only key, validated proposal and confirmation-gated apply | Proven | Keep live opt-in verification in final suite |
| Integration tests | Current workflow, validation, persistence/export and assistant contract | Partial | Cover every API route, partial failures, overrides, revisions and new exports |
| Unit/property tests | Geometry/site invariants, solar geometry and objective-driven suitability/safety gates | Partial | Determinism, water invariants, growth/events and randomized plantability properties |
| Accessibility/responsive QA | Responsive CSS and desktop visual screenshots | Missing | Keyboard path, axe/semantic checks and tablet/mobile browser tests |
| Performance | No direct benchmark | Missing | Catalogue, generation and 1k/5k/20k rendering/calculation gates plus PostGIS execution plan |
| Visual checkpoints | Evidence, perimeter/solar, optional sign-in, objective/species, design, water, cost and AI screenshots sent through Grog Telegram | Proven so far | Send final complete-workflow checkpoint after all gates pass |

The active goal remains incomplete while any row is `Partial` or `Missing`.
