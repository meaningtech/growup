# Growup Product and Implementation Plan

## 1. Executive decision

Growup will be a new, isolated application under `growup/`. Solaraf remains untouched and is used only as the UX, map-interaction, and project-structure reference.

Growup will preserve Solaraf's strongest interaction pattern: a compact operations sidebar next to a dominant map, direct polygon editing, immediate recalculation, stable metrics, and visible system status. It will replace the solar domain with an agroforestry design engine that:

1. Lets the user locate or import a site and draw an editable planting perimeter.
2. Lets the user select tree and perennial species from a broad, evidence-backed catalogue.
3. Filters and scores species for the site without hiding missing data or uncertainty.
4. Generates several deterministic planting layouts from the selected species and constraints.
5. Organizes plants through time and vertical space using syntropic agriculture principles.
6. Draws every tree as an individual, species-specific, age-dependent crown.
7. Provides a timeline that estimates height and crown development and visualizes management events.
8. Calculates auditable preliminary irrigation demand and is structurally ready for hydraulic zoning.

The application is a decision-support tool, not a substitute for a local agronomist, hydrologist, forestry professional, or site survey. Every recommendation and estimate must expose its evidence level.

## 2. Evidence reviewed

### 2.1 Reference video

The supplied LinkedIn video was reviewed as a 39.5-second screen recording. The useful product behavior is not a particular visual skin; it is the rapid feedback loop:

- An irregular site boundary is the primary object.
- The generated parking layout refills the boundary as geometry changes.
- Splitting, mirroring, straightening, and moving geometry produces a new valid arrangement immediately.
- Large reserved areas can be inserted and the remaining layout reflows around them.
- The generated result remains editable rather than becoming a static export.
- Alternative arrangements can be evaluated visually on the map.

Growup will reproduce this behavior for planting design: boundary changes, exclusion areas, paths, water infrastructure, locked trees, and changed species mixes must cause a quick, explainable regeneration of only the affected design.

Reference: [LinkedIn post and video](https://www.linkedin.com/posts/andrea-innocenti-ita_mi-colpisce-la-velocit%C3%A0-con-cui-stiamo-trasformando-ugcPost-7484842159725002752-XVaj/).

### 2.2 Solaraf code audit

The following Solaraf concepts are reusable:

| Solaraf asset | Growup use | Treatment |
| --- | --- | --- |
| Vite, React, TypeScript, Express structure | Application foundation | Copy into `growup/`, rename, then evolve independently |
| `src/googleMaps.ts` | Google Maps loading and typed browser boundary | Reuse and update for current Maps APIs |
| Address search and server-side geocoding | Site discovery | Reuse with Growup endpoint names |
| Click-to-coordinate behavior | Site inspection and water/access-point placement | Reuse |
| Manual polygon drawing and draggable vertices | Planting perimeter and exclusion zones | Reuse concept; replace local area math with robust projected geometry |
| Two-column `app-shell` and compact panels | Primary workspace | Reuse layout proportions and density |
| Loading, empty, error, and status states | Long-running generation and data-source feedback | Reuse state conventions |
| Integration-test pattern in `server/app.test.ts` | API verification | Reuse test organization |
| Playwright polygon tests | Site-drawing and generation flows | Adapt into Growup end-to-end tests |

The following Solaraf code must not be copied into the production domain layer:

- Google Solar API clients and authentication.
- Roof suggestion and GeoTIFF mask extraction.
- Solar panel capacity and energy calculations.
- Solar-specific types, labels, layers, and tests.
- The equirectangular shoelace approximation for production area calculations.

## 3. Product scope

### 3.1 Primary users

- Agroforestry designers preparing an initial site concept.
- Farmers and landowners comparing planting strategies.
- Agronomists refining species, spacing, phases, and irrigation assumptions.
- Restoration practitioners selecting useful native trees.
- Nurseries or implementation teams needing a georeferenced planting list.

### 3.2 Primary user outcome

In one continuous workspace, a user can move from a geographic perimeter to an editable, time-aware planting plan and export the tree positions, species schedule, evidence, and preliminary water demand.

### 3.3 Initial geographic posture

The architecture, catalogue, and runtime are global. No calibration field is bundled or selected at startup. Regional profiles are activated explicitly from the field coordinates, and the application must never infer that a globally listed species is locally appropriate without country-level evidence.

### 3.4 Included in the complete target

- Address search, map selection, GeoJSON import, and manual boundary drawing.
- Editable planting boundary, holes, setbacks, exclusion areas, access points, water points, and management paths.
- Species discovery, comparison, selection, and site suitability explanations.
- Syntropic consortium and row design.
- Multiple generated variants with stable seeds and comparable metrics.
- Individual tree selection, movement, replacement, locking, and deletion.
- Age-dependent crown and height visualization.
- Planting, pruning, coppicing, thinning, removal, and replacement events on the timeline.
- Preliminary daily, monthly, annual, and peak irrigation estimates.
- Project persistence and reproducible calculation snapshots.
- GeoJSON and CSV export; a printable planting schedule after the core workflow is stable.

### 3.5 Explicit non-goals for the first production release

- Claiming exact biological growth, yield, or survival.
- Automatic regulatory approval or definitive invasive-species compliance.
- Full pipe-network pressure-loss design and pump procurement.
- Crop economics, carbon-credit issuance, or financial return guarantees.
- Photorealistic 3D landscape rendering.
- Autonomous planting decisions without user review.

These are not removed from the product vision; they are kept out of the first production acceptance gate so that the requested map, species, syntropic layout, timeline, and irrigation foundation are trustworthy.

## 4. Product principles

1. **Map first.** The map is the workspace, not an illustration behind form fields.
2. **Generate, then edit.** Generated trees remain first-class editable objects.
3. **Fast feedback.** Parameter and geometry changes update previews quickly and never leave the user wondering whether the design is stale.
4. **Time is part of the design.** A valid year-one system can become invalid at year ten; collision and light checks run at several time checkpoints.
5. **Syntropic, not ornamental.** Species are selected for ecological function, succession, strata, and management behavior in addition to appearance.
6. **Evidence is visible.** Observed data, fitted values, curated expert defaults, genus/family fallbacks, and unknowns are visibly distinct.
7. **No false precision.** Growth and water results are ranges or scenarios when source data do not support a precise value.
8. **Deterministic results.** The same inputs and generation seed produce the same layout.
9. **Local safety wins.** Invasive, prohibited, threatened, or clearly unsuitable species trigger hard stops or explicit expert overrides.
10. **Product isolation.** Growup has independent code, domain models, collections, deployment configuration and credentials. The current deployment reuses an existing Mongo-compatible database instance only as infrastructure, with dedicated `growup_*` collections; it does not import Solaraf runtime files or domain data.

## 5. End-to-end user workflow

### Step 1: Create or open a project

The user names the project, selects units, preferred language, and an initial planning horizon. Default planning horizon: 30 years, extendable to 50 years.

### Step 2: Define the site

The user can:

- Search for an address.
- Click a point and center the map.
- Draw an outer boundary.
- Drag, add, or remove vertices.
- Import Polygon or MultiPolygon GeoJSON.
- Add holes and exclusion polygons for buildings, ponds, roads, utilities, habitat patches, or no-plant zones.
- Add access gates, water-source points, and optional existing trees.
- Set boundary setbacks and management-path widths.

Growup validates self-intersections, ring orientation, minimum area, overlapping exclusions, and unsupported geometry before generation.

### Step 3: Describe site conditions

Automatically suggested values remain editable:

- Elevation and approximate slope.
- Climate normals and recent weather source.
- Annual precipitation and temperature range.
- Soil texture, pH, organic carbon, depth, drainage, and available-water estimates.
- Frost, drought, salinity, wind, and water-logging exposure.
- Irrigation availability and water quality when known.

Every value shows its source, spatial resolution, retrieval date, and whether the user overrode it.

### Step 4: Choose design intent

The user selects one or more priorities and adjusts their weights:

- Food and fruit production.
- Biomass and soil building.
- Biodiversity and native restoration.
- Timber or poles.
- Fodder.
- Wind protection.
- Shade and microclimate.
- Pollinator support.
- Low irrigation demand.

Presets only set weights; they do not conceal the underlying constraints.

### Step 5: Build the species palette

The catalogue initially shows site-appropriate candidates. The user can search the full catalogue and filter by:

- Native status and geographic origin.
- Syntropic stratum.
- Successional stage and expected lifespan.
- Product or ecological function.
- Evergreen/deciduous behavior and phenology.
- Nitrogen fixation and biomass role.
- Shade, drought, frost, salinity, and water-logging tolerance.
- Soil texture and pH range.
- Mature height and crown spread.
- Irrigation-demand class.
- Evidence completeness and design-readiness.
- Invasive, conservation, or regulatory warnings.

Selected species appear in a palette with target share, role, desired quantity, and whether the generator may add support species.

### Step 6: Configure geometry and management

The user sets:

- Row orientation: contour-aware, north-south, longest site axis, selected bearing, or free clusters.
- Row spacing and in-row spacing ranges.
- Equipment/access width.
- Edge planting behavior and windbreak sides.
- Required productive-to-support ratio.
- Allowed crown overlap by stratum and time.
- Existing trees to preserve.
- Manual keep-out zones.
- Initial planting window and management intensity.

### Step 7: Generate variants

Growup generates at least three named variants:

- **Regenerative:** stronger native, diversity, soil-cover, and support-species weighting.
- **Balanced:** balanced production, access, diversity, and water use.
- **Water-wise:** lower estimated peak irrigation and more drought-tolerant composition.

Each variant exposes its generation seed, assumptions, constraint violations, warnings, and metrics. The user compares variants without losing edits to the active design.

### Step 8: Edit the generated plan

The user can:

- Select a tree to inspect its species, stratum, age, size, and water estimate.
- Drag a tree while receiving spacing and boundary feedback.
- Replace one tree or a selected group.
- Lock trees, rows, guilds, or zones.
- Regenerate unlocked areas only.
- Draw a new exclusion zone and reflow the remaining layout.
- Undo and redo every geometry, species, and generation action.

### Step 9: Scrub the timeline

The bottom timeline controls the map year and season. It updates:

- Crown footprint and canopy density.
- Estimated height and DBH where supported.
- Active and removed species.
- Stratum occupancy.
- Canopy cover and overlap warnings.
- Pruning, coppicing, thinning, and replacement events.
- Irrigation demand by establishment stage and canopy size.

Quick stops: planting, year 1, year 3, year 5, year 10, year 20, and mature state. The play control animates the design but is never required to inspect exact values.

### Step 10: Review and export

The review step must show:

- Species counts and percentages.
- Tree coordinates and stable IDs.
- Stratum and succession coverage.
- Canopy cover at key years.
- Planting and management schedule.
- Water demand, assumptions, and confidence.
- Warnings and unresolved data gaps.
- Source and model versions required to reproduce the result.

Exports: GeoJSON, CSV, and a later print/PDF planting schedule. GeoJSON includes tree points, crown properties for selected timeline checkpoints, rows, exclusions, paths, and irrigation zones.

## 6. Workspace UX and visual system

### 6.1 Desktop layout

The default desktop workspace keeps Solaraf's dense two-column shell and adds a timeline:

- **Left rail, 376-408 px:** project steps and controls.
- **Map workspace:** full remaining width and height.
- **Map header:** project name, save state, active variant, map status, undo/redo.
- **Map toolbar:** select, draw boundary, draw exclusion, add path, add water/access point, measure.
- **Right inspector, 320-360 px when open:** selected species, tree, row, zone, or warning.
- **Bottom timeline, 96 px collapsed / 168 px expanded:** year scrubber, events, season, playback, and current-year metrics.
- **Compact metric strip:** area, tree count, design-ready coverage, canopy cover at selected year, and irrigation demand.

The map remains visible while any control is open. Drawers do not stack into nested modal cards.

### 6.2 Main sidebar steps

1. Site
2. Species
3. Design
4. Timeline
5. Water
6. Review

Each step has a completion state and visible blockers. Navigation is allowed even when a step is incomplete; generation buttons explain what is missing.

### 6.3 Visual direction

Growup inherits Solaraf's restrained operational character but shifts from solar yellow to a botanical system:

- Canvas: warm mineral off-white `#F4F2EA`.
- Primary ink: near-black `#1B211C`.
- Surfaces: white with restrained borders, not nested floating cards.
- Primary action: deep leaf `#315C3B`.
- Selection: clear blue `#2B61C9` so selection is not confused with vegetation.
- Soil/management event accent: ochre `#A66F32`.
- Warning: amber; error/prohibition: muted red.
- Species colors are generated from a controlled, color-blind-safe botanical palette and remain stable per species ID.
- Typography: IBM Plex Sans for UI and IBM Plex Mono for coordinates, years, and calculated values, self-hosted with the correct license.

Avoid decorative gradients, oversized headings, marketing sections, glassmorphism, and generic dashboard card grids. The memorable visual is the living, changing canopy controlled by the timeline.

### 6.4 Interaction details

- Hovering a catalogue species highlights all of its trees without changing selection.
- Hovering a timeline event previews its spatial impact.
- Crown collision warnings appear as local outlines, not global red overlays.
- Generation shows progressive status: validating, fitting rows, assigning guilds, checking time, calculating water, ready.
- Manual edits mark metrics as recalculating and preserve the last valid result until the next result is ready.
- Locked objects use a small lock marker and remain visually normal.
- All icon-only actions have labels, tooltips, and accessible names.
- Keyboard: `V` select, `B` boundary, `X` exclusion, `P` path, `W` water point, `L` lock, `Delete` remove, standard undo/redo.

### 6.5 Responsive posture

Desktop is the design surface. Tablet supports review and light editing through bottom sheets. Mobile supports project review, tree inspection, timeline scrubbing, and field location; it does not pretend that complex boundary or row editing is comfortable on a narrow screen.

## 7. Botanical data strategy

### 7.1 Core decision

No single available database contains the taxonomy, agroforestry use, native range, environmental niche, crown geometry, growth over age, syntropic role, and crop coefficient required by Growup. Growup will therefore use a versioned source stack with one canonical identity and several evidence layers.

The catalogue exposes four readiness levels:

1. **Discoverable:** taxon is indexed and can link to relevant sources.
2. **Agroforestry candidate:** documented as useful, agroforestry-relevant, or a selected local native.
3. **Enriched:** has usable climate, trait, crown, or management data.
4. **Design-ready:** has enough reviewed fields and fallbacks to participate in layout, timeline, and water calculations.

Only design-ready species enter automatic generation by default. Users may add lower-readiness species manually after acknowledging missing fields.

### 7.2 Selected source stack

| Source | Coverage and role | Growup use | License/access posture |
| --- | --- | --- | --- |
| [Agroforestry Species Switchboard 4.0](https://doi.org/10.1038/s41597-025-05492-w) | 107,269 accepted plant names, 54,812 tree-like species, and presence in 59 specialist databases | Canonical discovery backbone, WFO identifiers, synonyms, tree-like flag, source links | Downloadable archive is CC BY 4.0; contributing source content is not automatically reusable |
| [GlobalUsefulNativeTrees](https://doi.org/10.1038/s41598-023-39552-1) | 14,014 useful tree species with native distribution across 242 countries/territories and ten use categories | Default broad agroforestry candidate set and native/use filters | [Zenodo species list](https://zenodo.org/records/7994433) is CC BY 4.0 |
| [Agroforestree Database 4.0](https://apps.worldagroforestry.org/treedb/) | Detailed profiles for 670 agroforestry species: ecology, distribution, propagation, management, use, pests, and bibliography | Deep profile and curation reference for high-value design-ready species | Link and cite by default; bulk-field reuse only after explicit license review |
| [TreeGOER](https://zenodo.org/records/7922928) | Observed environmental ranges for 48,129 tree species across 51 climate, soil, and topographic variables | Site suitability and environmental evidence | Open Zenodo dataset; persist source version and DOI |
| [Tallo](https://zenodo.org/records/6637599) | 498,838 individual-tree records from 5,163 species, including height, stem diameter, and crown radius | Crown/height allometry and genus/family fallbacks | CC BY 4.0 |
| [TRY Plant Trait Database](https://www.try-db.org/) | 15+ million trait records, 305,000 taxa, and 2,661 traits in the currently public version | Height, growth form, leaf, phenology, wood, and functional-trait enrichment | Import only datasets/records released for the intended use, preserving attribution |
| [FAO ECOCROP](https://www.fao.org/geospatial/data-and-tools/data-portals/ecocrop/en) | Environmental requirements for 2,568 cultivated plant species | Secondary crop constraints and use descriptors | Use official GAEZ access; record its older/discontinued-source status |
| [SoilGrids](https://docs.isric.org/globaldata/soilgrids/index.html) | Global 250 m soil properties at six depth intervals with uncertainty | Site-level soil defaults | CC BY 4.0; REST service is currently paused, so sample official rasters/COGs through a cached backend path |
| [CHELSA 2.1](https://www.chelsa-climate.org/datasets/chelsa_bioclim) | Terrain-informed global bioclimatic variables at kilometre scale | Climate normals used to match the site's environmental vector to species ranges | Use the dataset-specific license and citation recorded in the source manifest |
| [Copernicus DEM](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM) | Global elevation surface at 30 m/90 m and European 10 m products | Elevation, slope, aspect, row-orientation evidence, and terrain warnings | Follow the current Copernicus access category, attribution, and derived-product notice |
| [Copernicus Global Dynamic Land Cover](https://land.copernicus.eu/en/products/global-dynamic-land-cover) | Dynamic global land cover, including a 10 m service for 2020-2026 | Existing land-cover context and change warnings; never automatic clearing permission | Record product year, class confidence, and Copernicus attribution |
| [NASA POWER Daily API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/) | Analysis-ready global daily meteorology and solar data | Weather inputs and climate fallback for water calculations | Use official API with server cache and request de-duplication |
| [FAO Irrigation and Drainage Paper 56, revised edition](https://agris.fao.org/search/en/providers/124943/records/6a32b9d6b9a0a56f302a5e20) | Reference evapotranspiration, crop coefficients, water balance, and updated data practices | Irrigation calculation standard | Cite methodology; do not redistribute copyrighted tables without permission |

Additional link-only checks include World Flora Online, Kew Plants of the World Online, GBIF, EUFORGEN, the IUCN Red List, the EU invasive alien species list, EPPO, and national/regional sources. Licensing and geographic authority are reviewed before any data is copied into Growup.

### 7.3 Why this is the most complete practical approach

- The Switchboard is the broadest agroforestry-oriented index found and resolves fragmented sources through standardized names.
- GlobUNT is the largest available dataset specifically combining useful trees and native distributions.
- Agroforestree supplies depth for a smaller, highly relevant set.
- TreeGOER supplies environmental ranges at a scale the above catalogues do not.
- Tallo supplies measured crown geometry needed by the map and timeline.
- TRY and ECOCROP fill trait and cultivated-species gaps.
- Growup adds the missing design layer: syntropic roles, time behavior, irrigation parameters, confidence, and local review.

### 7.4 Canonical species model

Every field that can influence a recommendation or calculation stores value, unit, source, source version, evidence type, confidence, reviewer, and last-reviewed date.

Required model groups:

**Identity**

- Growup UUID.
- WFO taxon ID and accepted scientific name.
- Authorship, synonyms, family, genus.
- Localized common names with region and source.
- Growth form and tree-like status.

**Distribution and safety**

- Native and introduced regions using stable geographic codes.
- Site occurrence evidence, kept separate from native range.
- Invasive status by jurisdiction.
- Conservation category and trade/planting restrictions.
- Toxicity or livestock risk where documented.

**Agroforestry function**

- Human food, animal food, material, medicine, fuel, social, environmental, invertebrate food, gene source, and other uses.
- Nitrogen fixation evidence.
- Biomass/support, productive, timber, fodder, windbreak, nurse, shade, pollinator, erosion-control, and habitat roles.
- Coppice, pollard, pruning, and resprouting response.

**Syntropic behavior**

- Stratum: emergent, high, medium, low, shrub/ground, or unknown.
- Successional phase: placenta/pioneer, secondary, transition, climax, or locally configured equivalent.
- Establishment speed and expected productive lifespan.
- Planned retention: permanent, medium-term, short-term, or cut-and-regrow.
- Shade demand/tolerance by life stage.
- Compatible and conflicting roles with evidence notes.

**Site suitability**

- Absolute and preferred temperature, precipitation, altitude, pH, soil texture, drainage, salinity, and water-logging ranges.
- Frost, drought, heat, wind, fire, and salt tolerance classes.
- Rooting depth and pattern.
- Climate and soil evidence coverage.

**Geometry and growth**

- Mature height, crown radius/diameter, DBH, and their ranges.
- Crown form: round, oval, spreading, vase, columnar, conical, palm, or irregular.
- Crown eccentricity, density, and irregularity parameters.
- Species, genus, family, or plant-functional-type growth curve.
- Allometric equations and calibration region.
- Seasonal leaf state and relevant phenology.

**Water**

- Establishment-stage duration.
- Kc or Kcb/Ke values when defensible.
- Root-zone depth by stage.
- Allowable depletion and drought strategy.
- Irrigated/wetted-area model.
- Irrigation evidence and uncertainty.

### 7.5 Data ingestion and governance

1. Maintain `data/sources.yml` with URL, DOI, license, citation, version, checksum, allowed use, and attribution text.
2. Download source snapshots through explicit CLI commands; do not silently scrape sources at application runtime.
3. Store raw snapshots outside Git or in versioned object storage. Commit only small, derived fixtures and metadata.
4. Normalize names to Switchboard/WFO IDs and retain original names.
5. Convert all units to a canonical SI representation while retaining the original value.
6. Reject impossible ranges and quarantine ambiguous taxonomic matches.
7. Merge values as separate evidence records; do not overwrite disagreement.
8. Derive resolved fields through an explicit precedence rule and expose alternatives in the inspector.
9. Generate coverage reports by field, source, region, and readiness level.
10. Require human review before promoting a species to design-ready.
11. Publish a data-attribution page and include source versions in each project snapshot and export.

### 7.6 Initial Mediterranean design-ready pack

Build a reviewed pilot pack broad enough to exercise all strata, phases, and roles. Candidate families include locally appropriate fruit/nut trees, native forest trees, shrubs, climbers, biomass species, and ground-layer companions. The exact list must be reviewed against the selected site, regional invasive rules, nursery availability, and water regime; examples in tests must not be presented as universal recommendations.

Acceptance gate for the pilot pack:

- At least 40 species.
- At least three usable species in each vertical stratum relevant to the pilot profile.
- At least three succession horizons.
- Productive, biomass, nitrogen-support, pollinator, windbreak, and native-habitat roles represented.
- Crown, growth, water, climate, soil, safety, and source-confidence fields complete or explicitly defaulted.
- Expert review recorded for each design-ready profile.

## 8. Site intelligence and suitability engine

### 8.1 Automatic site resolution

Once a user draws or imports the perimeter, Growup can understand where the land is and build a first environmental profile without asking the user to transcribe coordinates.

The backend will:

1. Calculate centroid, bounding box, area, and local projected coordinate system.
2. Reverse-geocode representative points to country, administrative region, municipality, and jurisdiction codes.
3. Sample elevation across the polygon, then derive approximate minimum/maximum elevation, slope, aspect, and terrain variability.
4. Sample climate normals for temperature, precipitation, aridity, seasonality, frost, and heat indicators.
5. Sample recent/historical weather for irrigation and establishment scenarios.
6. Sample soil properties by depth, including pH, texture, organic carbon, coarse fragments, and available-water proxies with uncertainty.
7. Classify current land-cover context and flag possible forest, water, built, wetland, or intensively cultivated areas for review.
8. Resolve native-region, invasive-species, and conservation checks from the jurisdiction.
9. Store a spatially weighted site profile rather than relying only on the centroid when the polygon spans several raster cells.
10. Expose every sampled layer, resolution, date, and uncertainty in the Site inspector.

The automatic profile then drives a staged species recommendation:

1. Remove jurisdictional and ecological hard failures.
2. Compare site climate and soil variables with each species' preferred and observed ranges.
3. Score native status, ecological role, user objectives, water budget, and evidence completeness.
4. Select complementary candidates across strata, succession stages, and functional roles.
5. Return a ranked **site palette** and several possible **syntropic consortia**, each with inclusion/exclusion reasons.

This is stronger than recommending isolated species: the result explains both why a plant fits the land and what role it serves alongside the other selected plants.

Automatic detection has explicit limits:

- A web map does not provide a globally reliable cadastral parcel boundary; the user must draw or import the authoritative boundary.
- Copernicus DEM is a surface model and can include vegetation and structures.
- Gridded soil and climate layers can miss local drainage, fill, compaction, frost pockets, irrigation history, and microclimate.
- Satellite land-cover classification does not authorize clearing or a land-use change.
- The production design gate should request a soil test, field slope/drainage check, water analysis, and local expert review.

### 8.2 Hard gates

The engine prevents automatic placement when:

- A species is prohibited or high-risk invasive in the project's jurisdiction.
- The selected scenario exceeds a documented absolute climatic limit with high-confidence data.
- A required hydrologic condition is incompatible with the site.
- A conservation or sourcing status requires a review that has not occurred.
- Essential layout fields are missing and no approved fallback exists.

An expert override records who, when, why, and the evidence used. Missing evidence is never equivalent to suitability.

### 8.3 Explainable score

The initial score is configurable and returns components rather than only a total:

- Climate match: 30%.
- Soil and topography match: 20%.
- Water match: 15%.
- Native/ecological fit: 15%.
- User-purpose fit: 10%.
- Syntropic consortium fit: 5%.
- Evidence completeness: 5%.

Each component returns `good`, `conditional`, `poor`, or `unknown`, the source values used, and recommended mitigations. Users can change objective weights but cannot turn a legal or invasive-species hard gate into a silent positive score.

### 8.4 Site data hierarchy

1. User or laboratory observations with date and method.
2. Local authoritative datasets or nearby weather stations.
3. Regional datasets.
4. Global gridded data such as SoilGrids and NASA POWER.
5. Manual fallback with a prominent low-confidence state.

## 9. Syntropic design model

### 9.1 Principles translated into software

Growup treats syntropic agriculture as a process-based design framework, not a fixed recipe. The rule system is derived from the official [Agenda Götsch](https://agendagotsch.com/en/) material and current scientific literature, including the review [Syntropic farming systems for reconciling productivity, ecosystem functions, and restoration](https://doi.org/10.1016/S2542-5196(25)00047-6).

The engine models:

- **Ecological succession:** early support species prepare conditions for longer-lived species.
- **Vertical stratification:** light-demanding and shade-tolerant species occupy complementary height layers.
- **Temporal stratification:** species can share space when their periods of dominance do not conflict.
- **Dense occupation:** bare soil and unused light are minimized through intentional coverage, not arbitrary crowding.
- **Functional diversity:** productive species are combined with biomass, nurse, nutrient, habitat, and protection roles.
- **Active management:** pruning, coppicing, thinning, removal, and residue placement are part of the design.
- **Continuous soil cover:** ground and short-cycle components can be represented even when the main user request focuses on trees.
- **Local adaptation:** climate, soil, slope, water, and local ecology constrain every pattern.

### 9.2 Consortium template

A consortium is a versioned template with:

- Applicable biome/region and site conditions.
- Required and optional strata.
- Required functional roles.
- Successional windows.
- Candidate species or species filters for each slot.
- In-row sequence and spacing ranges.
- Inter-row behavior.
- Crown-overlap policy by stratum and year.
- Planting, pruning, coppice, thinning, and removal events.
- Evidence, author/reviewer, and confidence.

Templates may suggest species but never bypass suitability and safety gates.

### 9.3 Temporal conflict matrix

At configured checkpoints, normally years 1, 3, 5, 10, 20, and 30, the engine checks:

- Same-stratum crown overlap.
- Cross-stratum light availability.
- Tree-to-path and tree-to-boundary clearance.
- Root-zone competition proxy.
- Planned removal or pruning before conflict.
- Soil-cover target.
- Role and stratum continuity after short-lived species leave.

Cross-stratum crown overlap can be desirable; same-stratum overlap can also be intentional in biomass rows. The rule is profile-specific and visible, not a global no-overlap rule.

### 9.4 Management events

Event types:

- Plant, direct seed, transplant.
- Formative prune.
- Biomass prune/chop-and-drop.
- Coppice or pollard.
- Thin/remove.
- Replace after mortality.
- Harvest window.
- Irrigation-stage transition.

Every event can alter crown, height, active status, biomass estimate, light availability, and water demand. Event effects are deterministic and reversible in the project history.

## 10. Spatial layout engine

### 10.1 Inputs

- WGS84 site Polygon or MultiPolygon.
- Exclusion polygons and required setbacks.
- Existing and locked tree points with crown state.
- Access gates, water sources, paths, and optional contour/slope data.
- Selected species and consortium rules.
- Design objective weights.
- Row bearing, spacing ranges, and equipment width.
- Timeline checkpoints and management profile.
- Stable generation seed.

### 10.2 Geometry pipeline

1. Validate GeoJSON structure, ring closure, and self-intersection.
2. Select an appropriate local metric coordinate reference system, normally the site's UTM zone; use a local azimuthal projection for sites crossing UTM boundaries.
3. Compute area and perimeter in projected space.
4. Apply the inward site setback.
5. Subtract exclusions, buildings, ponds, preserved habitat, and required path envelopes.
6. Split disjoint plantable regions while preserving a shared project identity.
7. Derive the primary site axis and optional contour-aware bearing.
8. Generate and clip candidate rows or cluster cells.
9. Place access paths and headlands before tree candidates.
10. Return all geometry to WGS84 for storage and map display while retaining projected calculation geometry for audit.

Use a robust geometry stack based on PostGIS and a TypeScript geometry library. The backend is authoritative for area, buffers, containment, and final validity; the frontend computes only responsive previews.

### 10.3 Candidate placement

**Row mode**

- Sweep parallel candidate lines across the plantable area.
- Clip lines to the planting polygon.
- Remove fragments shorter than minimum usable row length.
- Place candidate points at spacing intervals with endpoint and path clearance.
- Alternate or repeat consortium sequences by row and segment.

**Contour-aware mode**

- Use elevation samples to derive a smoothed local contour direction.
- Reject abrupt row-direction changes that are impractical for management.
- Flag, rather than silently solve, sites where elevation resolution is inadequate.

**Cluster/island mode**

- Partition the plantable area into management cells.
- Place anchor trees first, then complementary lower strata and support species.
- Preserve access corridors and avoid isolated unreachable pockets.

### 10.4 Species assignment

1. Filter hard-incompatible species.
2. Reserve locked/existing trees.
3. Create consortium slots by stratum, succession, function, and target share.
4. Assign anchor/permanent species.
5. Add support and short-cycle species.
6. Evaluate conflicts at all timeline checkpoints.
7. Improve the assignment through deterministic local swaps and moves.
8. Calculate violations, score components, and uncertainty.
9. Repeat with different objective weight profiles to produce variants.

The initial solver is a deterministic greedy assignment followed by bounded local search. This is easier to audit than an opaque generative model and can later be replaced or supplemented by a constraint solver behind the same contract.

### 10.5 Hard constraints

- No generated trunk outside the plantable polygon.
- No trunk inside an exclusion or path envelope.
- Boundary, utility, road, and structure setbacks respected.
- Minimum trunk spacing respected unless the consortium explicitly defines a managed dense row.
- Locked tree positions and species are unchanged.
- Regulatory and invasive-species gates respected.
- Required access corridors remain connected to an access point.

### 10.6 Soft objectives

- Match selected species shares.
- Maximize functional and taxonomic diversity.
- Maintain stratum occupancy through time.
- Minimize unmanaged same-stratum crown conflict.
- Minimize irrigation demand for the water-wise variant.
- Maximize native and site-suitable species for the regenerative variant.
- Keep rows and management operations practical.
- Reduce fragmented or single-tree row remnants.

### 10.7 Regeneration semantics

- A full regeneration creates a new immutable variant.
- A partial regeneration preserves locked objects and re-solves only affected management cells.
- A changed boundary invalidates only geometrically affected cells first; global metrics then recalculate.
- The previous valid variant remains visible until the new one succeeds.
- Cancelled or failed generation never corrupts the active design.

### 10.8 Performance targets

- Smooth pan/zoom and timeline updates with 5,000 visible trees on a supported desktop browser.
- Interaction previews within one animation frame where possible.
- A first three-variant result for a normal site of up to 10 hectares and 5,000 trees in under 5 seconds at the 95th percentile on the reference environment.
- Larger jobs use a cancellable background job and progressive status.
- Generation is seeded and reproducible across identical engine versions.

## 11. Individual crown rendering

### 11.1 Requirement

Every tree must have its own stable crown geometry, not a repeated generic green circle. Geometry changes with species, individual render seed, age, season, and management events.

### 11.2 Crown model

For each tree and timeline date:

1. Resolve the estimated crown radius and height with uncertainty.
2. Select the species crown archetype.
3. Create a deterministic 16-32 vertex radial polygon from the tree's stable render seed.
4. Apply crown eccentricity and species-specific irregularity.
5. Apply age and management scale.
6. Apply seasonal opacity/leaf state without changing trunk position.

Supported top-down archetypes: round, oval, spreading, vase, columnar, conical, palm, and irregular. Crown shapes are procedural vectors so no photo licensing or sprite mismatch is introduced.

### 11.3 Map rendering strategy

- Google Maps provides satellite/base mapping, address search, and familiar site context.
- A deck.gl Google Maps overlay renders trees, paths, rows, zones, and analysis layers in WebGL.
- At low zoom, use instanced simplified crown glyphs.
- At high zoom or for selected trees, render the full procedural polygon and trunk marker.
- Update GPU attributes on timeline movement instead of rebuilding DOM markers.
- Keep selection color separate from species color.

### 11.4 Visual analysis layers

- Species.
- Stratum.
- Succession stage.
- Site suitability.
- Water demand.
- Crown conflict.
- Planting phase.
- Management action due.

Only one thematic fill layer is active at a time; outlines and warnings remain legible.

## 12. Growth timeline and model

### 12.1 Scientific posture

Tallo provides strong allometric relationships between size dimensions, but not a universal age-growth curve. Growup must not infer that static crown measurements alone provide exact growth over time. Age curves combine measured data, regional equations, curated values, and explicit fallbacks.

### 12.2 Model hierarchy

1. Local species/provenance curve for comparable management and climate.
2. Species curve from an appropriate region.
3. Species allometry plus curated growth-rate parameters.
4. Genus curve.
5. Family or plant-functional-type curve.
6. Manual expert curve.

The user sees which level was used.

### 12.3 Initial mathematical model

Use a Chapman-Richards curve for height and DBH where calibrated:

`size(age) = asymptote * (1 - exp(-k * max(age - offset, 0))) ^ shape`

Then estimate crown radius from a species/region allometric relationship such as:

`crownRadius = a * DBH ^ b`

or, where DBH is unavailable:

`crownRadius = a * height ^ b`

Each parameter set contains sample count, region/biome, residual error, valid range, source, and confidence. Values outside the calibrated range are clamped and flagged as extrapolated.

### 12.4 Site and management modifiers

The baseline scenario may be modified by bounded factors for:

- Climate suitability.
- Soil suitability.
- Establishment irrigation.
- Water stress.
- Competition/light proxy.
- Pruning, coppicing, or pollarding.

Modifiers are visible and can be turned off for comparison. The model returns low/base/high estimates, not only one line.

### 12.5 Timeline outputs

Per tree and checkpoint:

- Active/removed state.
- Age.
- Estimated height, DBH, crown X/Y radius, and confidence range.
- Stratum and phenology state.
- Scheduled management action.
- Estimated daily water need for the selected scenario.

Project aggregates:

- Canopy cover and overlap by stratum.
- Species and functional diversity.
- Trees entering or leaving productive phases when data exists.
- Upcoming management workload count.
- Irrigation demand.

### 12.6 Calibration loop

Allow the user to enter observed planting date, height, DBH, crown width, health, and mortality. A later model version can refit or select the most appropriate curve. Observations never rewrite the source dataset; they are project measurements with provenance.

## 13. Irrigation calculation foundation

### 13.1 Target

The first release provides a transparent agronomic water-demand estimate and zone-ready outputs. It does not claim to finish pipe sizing, pressure balancing, pump selection, or emitter procurement.

### 13.2 Inputs

- Daily reference evapotranspiration, preferably FAO Penman-Monteith ETo.
- Daily precipitation and effective-rainfall method.
- Species/stage Kc or basal Kcb plus soil evaporation Ke when evidence supports it.
- Tree age, canopy size, planting density, and wetted area.
- Root-zone depth and total available water.
- Allowable depletion or water-stress coefficient.
- Soil texture, coarse fragments, drainage, and optional measured field capacity/wilting point.
- Irrigation system efficiency.
- Emitter flow/count or a default scenario.
- User water-availability cap and irrigation days.

### 13.3 Calculation method

Follow the revised FAO-56 methodology and preserve all intermediate values.

Baseline crop/tree evapotranspiration:

`ETc = ETo * Kc`

Detailed high-frequency method where supported:

`ETc = ETo * (Kcb * Ks + Ke)`

Daily root-zone balance:

`depletionToday = clamp(depletionYesterday + ETc - effectiveRain - netIrrigation, 0, totalAvailableWater)`

Net irrigation when the selected trigger is exceeded:

`netDepthMm = targetRefill - effectiveRainCredit`

Gross irrigation:

`grossDepthMm = netDepthMm / systemEfficiency`

Tree or zone volume:

`litres = grossDepthMm * wettedAreaM2`

because one millimetre over one square metre equals one litre.

### 13.4 Mixed-canopy handling

- Calculate demand per tree or homogeneous irrigation zone, not by averaging the entire project prematurely.
- Prevent double-counting soil evaporation under overlapping canopies.
- Adjust wetted area as crowns and root zones expand.
- Keep establishment irrigation separate from mature maintenance irrigation.
- Group zones by compatible scheduling, pressure, and water-demand class.
- Show peak-day, monthly, annual, and drought-scenario demand.

### 13.5 Data and uncertainty

- Weather values are cached with source and timestamp.
- Forecast, historical observation, and climate normal are separate modes.
- SoilGrids is a coarse default, not a substitute for a soil test.
- Species without a defensible Kc use an expert-reviewed functional-type range and show low confidence.
- The UI shows whether water demand is climate-driven, species-driven, or dominated by a manual assumption.

### 13.6 Irrigation-ready schema and outputs

Store:

- Water sources, available flow, pressure, capacity, and quality notes.
- Irrigation zones and included tree IDs.
- Emitter scenario per zone.
- Measured and user-editable main, submain, lateral and protected-crossing geometries.
- Daily schedule results and annual summary.
- Calculation version and all input assumptions.

The hydraulic engine routes visible pipe classes around mapped obstacles, recalculates edited vertices and the movable source, checks flow and head, and separates measured from purchase quantities. Field pressure tests, source yield and supplier validation remain execution requirements.

## 14. Technical architecture

### 14.1 Stack

- Frontend: React 19, TypeScript, Vite.
- Map: Google Maps JavaScript API plus deck.gl overlay.
- Geometry helpers: a maintained TypeScript geospatial library for previews; PostGIS for authoritative operations.
- Backend: Node.js, Express, TypeScript with static imports.
- Database: PostgreSQL with PostGIS.
- Validation: shared schemas used at API and import boundaries.
- Tests: Vitest, Supertest, Playwright.
- Background work: in-process job interface initially, replaceable by a queue worker without changing API contracts.

Do not introduce dynamic production imports. Audit every added npm dependency before installation using the repository's supply-chain security workflow.

### 14.2 Proposed folder structure

```text
growup/
├── AGENTS.md
├── README.md
├── package.json
├── package-lock.json
├── .env.example
├── docker-compose.yml
├── docs/
│   ├── PROJECT_PLAN.md
│   ├── DATA_PROVENANCE.md
│   ├── GROWTH_MODEL.md
│   └── IRRIGATION_MODEL.md
├── data/
│   ├── sources.yml
│   ├── fixtures/
│   └── curated/
├── scripts/
│   └── data/
├── shared/
│   ├── schemas/
│   ├── types/
│   └── units/
├── server/
│   ├── app.ts
│   ├── index.ts
│   ├── routes/
│   ├── services/
│   ├── repositories/
│   ├── layout/
│   ├── growth/
│   ├── irrigation/
│   └── data-ingestion/
├── src/
│   ├── App.tsx
│   ├── components/
│   ├── features/
│   ├── map/
│   ├── state/
│   ├── styles/
│   └── workers/
└── e2e/
```

### 14.3 Backend modules

- **Project service:** ownership, settings, versions, and snapshots.
- **Site service:** geometry validation, projected calculations, environmental inputs.
- **Species service:** search, evidence, readiness, suitability, and curation.
- **Layout service:** rows, candidates, assignment, variants, metrics, and violations.
- **Growth service:** curve resolution, events, timeline states, and uncertainty.
- **Irrigation service:** weather, soil balance, zones, and summaries.
- **Export service:** reproducible GeoJSON and CSV.
- **Source service:** dataset versions, attribution, and coverage reports.

### 14.4 Frontend state boundaries

- Server state: projects, species catalogue, variants, calculation results.
- Editor state: current tool, selection, draft geometry, active year, unsaved edit batch.
- Map render state: derived GPU-ready features only.
- History state: reversible domain commands, not arbitrary React state snapshots.

### 14.5 API contracts

Core endpoints:

```text
GET    /api/config
POST   /api/projects
GET    /api/projects/:projectId
PATCH  /api/projects/:projectId
POST   /api/sites/validate
PUT    /api/projects/:projectId/site
GET    /api/species
GET    /api/species/:speciesId
POST   /api/species/suitability
POST   /api/projects/:projectId/layouts/generate
GET    /api/layout-jobs/:jobId
GET    /api/layouts/:layoutId
PATCH  /api/layouts/:layoutId/trees/:treeId
POST   /api/layouts/:layoutId/regenerate
POST   /api/layouts/:layoutId/growth/simulate
POST   /api/layouts/:layoutId/irrigation/estimate
GET    /api/projects/:projectId/export.geojson
GET    /api/projects/:projectId/export.csv
GET    /api/sources
```

All calculation requests include an idempotency key and explicit input/model versions. Errors use a stable envelope with code, message, field/path, recoverability, and optional source status.

### 14.6 Core database tables

- `projects`
- `project_versions`
- `sites`
- `site_exclusions`
- `site_paths`
- `site_points`
- `species`
- `species_names`
- `species_evidence`
- `species_roles`
- `species_safety_flags`
- `species_growth_models`
- `species_water_models`
- `data_sources`
- `data_source_versions`
- `consortium_templates`
- `consortium_slots`
- `layout_variants`
- `layout_rows`
- `tree_instances`
- `management_events`
- `growth_snapshots`
- `irrigation_zones`
- `irrigation_daily_results`
- `calculation_runs`
- `expert_overrides`

Spatial columns use SRID 4326 for interchange plus projected calculation geometry where required. Add GiST indexes to site, exclusion, path, row, and tree geometries. Add indexed normalized scientific name, WFO ID, readiness, family, native region, and common-name search fields. Inspect query plans before accepting catalogue or spatial-query performance.

### 14.7 Versioning and reproducibility

Every saved variant records:

- Input project version.
- Boundary and exclusion geometry hashes.
- Selected species IDs and evidence versions.
- Consortium-template version.
- Layout-engine version and seed.
- Growth-model version.
- Irrigation-model version.
- Weather/soil source versions.
- User overrides.

A future engine version creates a new calculation run; it never silently changes a historical design.

## 15. Security, privacy, and operations

- Keep Google browser and server keys in separate environment variables.
- Restrict browser keys by origin and APIs.
- Proxy server-only weather, elevation, and geocoding requests.
- Validate request sizes and GeoJSON complexity.
- Rate-limit generation and external-data endpoints.
- Never log API keys, full headers, or private project exports.
- Treat exact farm coordinates and project ownership as private data.
- Cache external responses by spatial cell and date to reduce cost and avoid provider blocking.
- Provide health checks for database, map configuration, and source availability.
- Back up project data separately from reconstructable public source data.

## 16. Error, warning, and uncertainty model

The UI distinguishes:

- **Blocker:** invalid geometry, prohibited species, no plantable area, or missing mandatory calculation input.
- **Warning:** conditional climate fit, low-resolution soil data, crown conflict resolved by future pruning, or water demand above user cap.
- **Information:** a fallback model or non-local source was used.
- **Source outage:** cached values remain usable with their age shown.

Examples:

- `SITE_SELF_INTERSECTION`
- `NO_PLANTABLE_AREA`
- `SPECIES_PROHIBITED`
- `SPECIES_DATA_INCOMPLETE`
- `NO_VALID_CONSORTIUM`
- `TIMELINE_CROWN_CONFLICT`
- `WATER_BUDGET_EXCEEDED`
- `WEATHER_SOURCE_UNAVAILABLE`
- `MODEL_EXTRAPOLATION`

No empty catch blocks and no generic “something went wrong” for a recoverable user action.

## 17. Testing and verification strategy

### 17.1 Unit tests

- Coordinate projection and round trips.
- Polygon validation, area, buffers, holes, and containment.
- Row clipping and point spacing.
- Deterministic generation from seed.
- Consortium slot validation.
- Temporal conflict checks.
- Growth curve evaluation, clamping, and event effects.
- Crown polygon determinism and bounds.
- FAO water-balance calculations and unit conversions.
- Suitability score component explanations.

### 17.2 Backend integration tests

Required for every backend/API function:

- Project and site persistence.
- Spatial validation through PostGIS.
- Site Intelligence polygon sampling, jurisdiction resolution, cache freshness, and partial-provider failure behavior.
- Species filters and source evidence.
- Suitability hard gates and expert override audit.
- Layout generation and partial regeneration.
- Growth simulation.
- Weather cache and source failure behavior.
- Irrigation estimates.
- GeoJSON/CSV export reproducibility.

Use fixed external fixtures in normal CI and separate opt-in live provider checks.

### 17.3 Algorithm property tests

Across generated random valid polygons:

- No trunk lies outside plantable geometry.
- No unlocked generated trunk violates a hard exclusion.
- Same inputs and seed produce byte-equivalent normalized output.
- Tree IDs remain stable for unaffected locked regions.
- Timeline values remain finite and non-negative.
- Increasing irrigation efficiency cannot increase gross water demand.
- One millimetre over one square metre always converts to one litre.

### 17.4 Browser tests

Use Playwright or Chrome DevTools MCP:

1. Search for a site, draw and edit a polygon.
2. Wait for Site Intelligence, inspect the sourced site profile, and verify the ranked palette explanations.
3. Add an exclusion and confirm area changes.
4. Select species and generate three variants.
5. Lock trees, change an exclusion, and regenerate around them.
6. Drag and replace a tree with live constraint feedback.
7. Scrub from year 1 to year 20 and verify crown changes.
8. Trigger a pruning event and verify crown/state change.
9. Configure irrigation inputs and verify the visible audit trail.
10. Export and re-import GeoJSON.
11. Verify tablet review and mobile field-inspection modes.
12. Complete, skip, resume and restart the guided first-project onboarding on anonymous and authenticated sessions.

Capture screenshots for the main workflow, error states, and selected timeline years.

### 17.5 Accessibility and visual QA

- Keyboard-complete main workflow except freehand map vertex placement, which has an accessible coordinate-entry alternative.
- WCAG AA color contrast for controls and text.
- Do not encode species, warning, or stratum only by color.
- Visible focus and large enough map handles.
- Reduced-motion mode disables timeline playback animation while retaining exact states.
- Render checks at 1440x900, 1280x800, tablet landscape, and a mobile field-review viewport.

### 17.6 Performance tests

- 1,000, 5,000, and 20,000 tree render fixtures.
- Timeline scrub without layout thrashing.
- Generation benchmark on convex, concave, holed, and fragmented sites.
- Species search over the full Switchboard-derived index.
- PostGIS `EXPLAIN (ANALYZE, BUFFERS)` for critical spatial queries.

## 18. Implementation phases and acceptance gates

### Phase 0: Isolated foundation and specifications

Tasks:

- Create `growup/` with its own package, environment example, documentation, and ignore rules.
- Copy only the approved Solaraf foundation and rename all user-facing/domain identifiers.
- Add Growup-specific `AGENTS.md` and source-provenance rules.
- Establish shared units, IDs, schemas, error envelope, and calculation-run versioning.

Exit gate:

- Growup starts independently.
- Solaraf files and behavior are unchanged.
- Typecheck, tests, and production build pass.
- No Solar API code or secrets exist in Growup.

### Phase 1: Map workspace and site editor

Tasks:

- Rebuild the Solaraf shell as the Growup six-step workspace.
- Add address search, satellite map, coordinate selection, and status handling.
- Implement boundary, hole, exclusion, path, access point, water point, and existing-tree tools.
- Add projected backend geometry validation and accurate metrics.
- Add command-based undo/redo.

Exit gate:

- A user can create, edit, save, reload, and export a valid site.
- Area agrees with PostGIS reference fixtures within 1% for normal project scales.
- Invalid geometry is recoverable and clearly explained.

### Phase 2: Botanical source pipeline and catalogue

Tasks:

- Implement source registry and manual snapshot ingestion commands.
- Import Switchboard, GlobUNT, TreeGOER, and Tallo under their documented licenses.
- Add link-only adapters for sources without approved bulk reuse.
- Normalize taxonomy, units, evidence, and confidence.
- Build source coverage reports.
- Curate and review the initial Mediterranean design-ready pack.

Exit gate:

- Full discoverable catalogue is searchable.
- GlobUNT candidates are filterable by native region and use.
- Every displayed evidence value has provenance.
- At least 40 reviewed species pass design-ready validation.

### Phase 3: Species selection and suitability

Tasks:

- Build catalogue search, filters, comparison, and species inspector.
- Resolve jurisdiction and retrieve/cache weighted elevation, slope, aspect, climate, weather, soil, and land-cover defaults for the site polygon.
- Implement hard safety gates and explainable suitability components.
- Add user overrides with audit trail.
- Build selected-palette shares and roles.

Exit gate:

- A saved perimeter resolves a sourced, spatially weighted site profile without manual coordinate entry.
- The recommended palette and consortia show the site factors, hard gates, uncertainty, and evidence behind their ranking.
- The user can explain why each selected species is good, conditional, poor, or unknown for the site.
- Prohibited/invasive hard gates cannot be bypassed silently.
- Missing data remains visible.

### Phase 4: Syntropic templates and layout generation

Tasks:

- Implement consortium template schema and validator.
- Build row, contour-aware, and cluster candidate generators.
- Implement hard constraints, time checkpoints, deterministic assignment, local search, and variant scoring.
- Add generation progress, cancellation, stable seeds, and partial regeneration.
- Add variant comparison.

Exit gate:

- Three variants generate for every reference site fixture.
- No generated trunk violates plantable geometry or hard exclusions.
- Locked objects survive partial regeneration unchanged.
- Every warning points to the affected rule, tree, row, or time checkpoint.

### Phase 5: Editable individual-tree map

Tasks:

- Integrate deck.gl overlay.
- Generate stable, species-specific crown shapes.
- Add tree/row/guild selection, drag, replace, delete, lock, and group editing.
- Add thematic layers and local collision visualization.
- Optimize map buffers and selection indexes.

Exit gate:

- Every tree has a stable individual crown.
- Editing one tree updates metrics and warnings without a full page refresh.
- The 5,000-tree reference scene remains interactive.

### Phase 6: Growth timeline and management events

Tasks:

- Import/fit approved allometric and age-growth parameter sets.
- Implement model hierarchy and low/base/high scenarios.
- Add timeline state generation and cache.
- Render management events and their crown/state effects.
- Add observed-tree measurements and model-level badges.

Exit gate:

- Timeline checkpoints update crowns, heights, active species, and project metrics reproducibly.
- Every value indicates its model level and uncertainty.
- Pruning/removal events resolve the intended temporal conflicts in fixtures.

### Phase 7: Irrigation estimation and zone readiness

Tasks:

- Implement weather source/cache and manual input fallback.
- Implement revised FAO-56 ETo/ETc and daily root-zone balance paths.
- Add species/functional-type water profiles.
- Add irrigation system efficiency, wetted area, emitter scenarios, and water cap.
- Group compatible trees into editable preliminary zones.
- Build daily/monthly/annual/peak results and audit view.

Exit gate:

- Reference calculations match independent spreadsheet fixtures within defined rounding tolerance.
- Every displayed water result can be traced to inputs and equations.
- Missing Kc/soil/weather evidence lowers confidence and never invents precision.

### Phase 8: Persistence, exports, and review workflow

Tasks:

- Complete project versioning and immutable calculation runs.
- Add GeoJSON and CSV exports with attribution and model metadata.
- Add printable planting/management schedule.
- Add autosave state, conflict-safe recovery, and explicit saved/unsaved status.

Exit gate:

- Exported projects can reproduce tree count, coordinates, variant seed, selected-year crowns, and water summary.
- Historical variants do not change when source or model versions advance.

### Phase 9: Calibration, expert review, and production hardening

Tasks:

- Validate pilot species and consortiums with Mediterranean agroforestry expertise.
- Ground-check at least one representative site and compare generated spacing and access with field constraints.
- Run security, accessibility, performance, browser, and disaster-recovery checks.
- Finish data attribution, methodology, and limitations documentation.
- Verify deployment environment and monitoring.

Exit gate:

- All definition-of-done items below have direct evidence.
- There are no unresolved critical blockers or misleading high-confidence outputs.
- A clean production build and live runtime workflow have been tested before any push.

## 19. Prioritized implementation backlog

### Foundation

- `GROW-001` Create isolated Growup application shell.
- `GROW-002` Define shared schemas, units, errors, and IDs.
- `GROW-003` Add PostGIS development environment and migrations.
- `GROW-004` Add project/calculation version model.

### Site editor

- `GROW-010` Reuse and update Google Maps loader.
- `GROW-011` Implement geometry command model and undo/redo.
- `GROW-012` Implement boundary, holes, and exclusions.
- `GROW-013` Implement paths, access, water points, and existing trees.
- `GROW-014` Implement projected geometry validation API.
- `GROW-015` Implement GeoJSON import/export.

### Data

- `GROW-020` Source registry and attribution manifest.
- `GROW-021` Switchboard importer.
- `GROW-022` GlobUNT importer.
- `GROW-023` TreeGOER importer.
- `GROW-024` Tallo importer and allometry fitter.
- `GROW-025` Evidence resolver and readiness validator.
- `GROW-026` Mediterranean pilot curation workflow.

### Species UX

- `GROW-030` Catalogue index and filters.
- `GROW-031` Species inspector and evidence view.
- `GROW-032` Automatic site intelligence: jurisdiction, terrain, climate, soil, weather, and land cover.
- `GROW-033` Explainable suitability engine.
- `GROW-034` Species palette and target shares.

### Design engine

- `GROW-040` Consortium template schema.
- `GROW-041` Projected plantable-area builder.
- `GROW-042` Row and contour candidate generation.
- `GROW-043` Cluster candidate generation.
- `GROW-044` Temporal conflict graph.
- `GROW-045` Deterministic assignment and local search.
- `GROW-046` Variant scoring and comparison.
- `GROW-047` Partial regeneration and locking.

### Visualization and editing

- `GROW-050` deck.gl Google Maps overlay.
- `GROW-051` Procedural species crown library.
- `GROW-052` Tree/row/guild inspector.
- `GROW-053` Drag, replace, delete, lock, and group edit.
- `GROW-054` Thematic analysis layers.

### Time

- `GROW-060` Growth model registry.
- `GROW-061` Allometry and fallback hierarchy.
- `GROW-062` Timeline snapshot engine.
- `GROW-063` Management event engine.
- `GROW-064` Timeline UI and playback.
- `GROW-065` Observed measurement calibration inputs.

### Water

- `GROW-070` Weather and climate cache.
- `GROW-071` Soil-water profile model.
- `GROW-072` FAO-56 calculation engine.
- `GROW-073` Species/stage water profiles.
- `GROW-074` Irrigation scenarios and audit panel.
- `GROW-075` Preliminary zone grouping and geometry.

### Release

- `GROW-080` Project persistence and history.
- `GROW-081` Reproducible GeoJSON/CSV export.
- `GROW-082` Printable planting and management schedule.
- `GROW-083` Accessibility and responsive review mode.
- `GROW-084` Performance and large-site validation.
- `GROW-085` Live runtime and production verification.

## 20. Risks and mitigations

| Risk | Consequence | Mitigation |
| --- | --- | --- |
| No universal complete plant database | Gaps and conflicting values | Evidence records, source stack, readiness levels, human review |
| Source license incompatibility | Illegal or fragile bulk reuse | License manifest, link-only adapters, no runtime scraping |
| Static measurements presented as age growth | Misleading timeline | Separate allometry from age curves, show hierarchy and uncertainty |
| Syntropic practice reduced to fixed spacing | Ecologically poor plans | Versioned regional consortium templates and time-aware rules |
| Global environmental grids treated as field truth | Bad local recommendations | Source resolution display, user/lab override hierarchy |
| Invasive or prohibited species recommended | Ecological/legal harm | Jurisdictional hard gates and audited overrides |
| Crowns overwhelm browser rendering | Unusable editor | WebGL instancing, level of detail, spatial indexing, benchmarks |
| Complex polygons break layout | Invalid or empty design | Robust projected geometry, validation, property tests |
| Irrigation estimates imply hydraulic certainty | Bad infrastructure decisions | Separate agronomic demand from hydraulic design and label scope |
| Recalculation destroys manual edits | Loss of trust | Immutable variants, locks, affected-cell regeneration, undo/redo |
| External services fail or rate-limit | Blocked workflow | Cached source values, manual fallbacks, explicit freshness |

## 21. Assumptions requiring validation during implementation

- Google Maps remains the base map to maximize Solaraf code reuse and satellite familiarity.
- Country and regional calibration profiles are explicit modules, never permanent restrictions or startup defaults.
- PostgreSQL/PostGIS is acceptable for persistent spatial projects.
- The first design-ready catalogue can be intentionally smaller than the full discoverable catalogue as long as the distinction is explicit.
- Users prefer explainable deterministic variants to an opaque AI-generated layout.
- Irrigation demand is valuable before full hydraulic network design.
- A 30-year default horizon is useful, with 50-year extension for long-lived systems.

These assumptions are feature/configuration decisions, not reasons to pause the foundation work. They should be confirmed through the first usable prototype and expert review.

## 22. Definition of done

Growup is ready only when all of the following have direct evidence:

- The application lives entirely under `growup/` and Solaraf remains unchanged.
- A user can define and edit a perimeter and exclusions on the map.
- The perimeter automatically resolves a sourced environmental profile and jurisdiction used for recommendations.
- The system uses a versioned broad agroforestry catalogue and exposes source provenance.
- The user can select species and see site suitability, warnings, and data gaps.
- The generator produces at least three editable, reproducible variants.
- Generated trunks remain inside plantable geometry and outside hard exclusions.
- Layout rules explicitly model strata, succession, functions, and management over time.
- Every tree has an individual species-specific crown.
- The timeline visibly and numerically changes crown size and active composition.
- Growth values expose their model hierarchy and uncertainty.
- Irrigation estimates use auditable FAO-based equations, weather, soil, stage, efficiency, and wetted area.
- Water outputs clearly stop short of unimplemented hydraulic guarantees.
- Locked trees survive partial regeneration.
- GeoJSON and CSV exports reproduce the selected design.
- Backend/API functions have integration tests.
- Unit, integration, property, browser, accessibility, and performance gates pass.
- The main workflow has been runtime-tested in a live local or staging browser before any push.
- Documentation, code, comments, tests, and commits are in English.
- No secrets, unlicensed source content, or hidden high-confidence fallbacks are present.

## 23. Requirement traceability

| Requested outcome | Planned evidence |
| --- | --- |
| New project named Growup | Isolated `growup/` folder and application identity |
| Reuse Solaraf UX/UI | Section 2 reuse matrix and Phase 0/1 implementation gates |
| Match the parking configurator behavior | Editable perimeter, constraints, rapid reflow, variants, locks, partial regeneration |
| Select agroforestry species | Full catalogue, filters, palette, suitability, and design-readiness |
| Use the most complete database practical | Switchboard + GlobUNT core with TreeGOER, Tallo, TRY, Agroforestree, ECOCROP enrichment |
| Delineate a perimeter | Site editor with projected validation and exclusions |
| Understand where the land is and which species fit | Automatic Site Intelligence plus explainable site palette and consortium ranking |
| Automatically calculate and display tree map | Deterministic spatial engine plus WebGL map overlay |
| Different crown for every tree | Procedural species/seed/age crown model |
| Use syntropic agriculture principles | Strata, succession, consortia, functional diversity, management events, time conflict matrix |
| Growth timeline | 30/50-year timeline, growth hierarchy, uncertainty, event effects |
| Prepared irrigation calculation | Revised FAO-56 demand engine, daily balance, zones schema, and explicit hydraulic boundary |
| Precise and extensive plan | This document, phased backlog, acceptance gates, risks, and definition of done |

## 24. First implementation action

Start with Phase 0 and Phase 1 together: create the independent Growup runtime by copying only Solaraf's approved foundation, then replace the roof/solar workflow with the site editor and accurate projected geometry. Do not begin species recommendation or generation until the source-provenance schema, stable IDs, units, and calculation versioning exist, because those decisions affect every later result.
