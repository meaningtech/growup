# Design Systems and Solar Analysis

## Decision

Growaf separates **planting extent**, **production system**, and **orientation objective**. These are independent decisions and must never be collapsed into a single visual preset.

### Planting extent

- `full-field`: candidates can occupy the plantable site interior.
- `perimeter-band`: candidates are restricted to a configurable inward band along the site boundary. Holes, setbacks, paths, exclusions, observed trees, and remotely detected woody vegetation remain protected. The resulting central crop area is reported explicitly.
- `selected-edges`: candidates are restricted to boundary edges selected by the user or chosen by a wind objective. This is required for windbreaks because planting every side can be agronomically inappropriate.

### Production systems

1. **Syntropic succession**
   - Diversified annual and perennial species arranged by vertical stratum and temporal succession.
   - Candidate ordering must deliberately represent placenta, secondary, and climax phases and multiple strata.
   - Biomass support plants, pruning, and planned removals are part of the design rather than optional labels.
   - Scientific evidence in temperate regions is still limited; the UI must show that implementation requires local agronomic validation and intensive management.

2. **Alley cropping**
   - One or more woody rows alternate with crop alleys.
   - Crop alley width is an explicit control and must accommodate equipment width.
   - Orientation is scored for crop light access, contour/erosion behavior, wind, and operational fit rather than defaulting to north–south.

3. **Mixed orchard**
   - Productive tree rows use compatible fruit/nut species, optional support species, and regular machine-access geometry.
   - This is a production-oriented agroforestry preset, not a syntropic claim.

4. **Monoculture orchard**
   - Exactly one productive species is used in a regular grid or row layout.
   - It is kept as a transparent comparison baseline, with diversity and resilience warnings; it must not be presented as agroforestry.

5. **Field windbreak**
   - One or more selected-edge rows are placed perpendicular to prevailing troublesome winds.
   - Barrier density target is 35–60% during the protection period, following USDA NRCS guidance.
   - Species require climate/soil suitability, wind resistance, and limited root/crown competition with adjacent crops.
   - Wind protection, crop shading, and crop-area loss are reported separately.

6. **Boundary buffer / productive hedge**
   - A continuous or segmented perimeter band provides products, habitat, screening, or drift/runoff interception while keeping the crop interior empty.
   - This is the direct implementation of the perimeter-only request. It is distinct from a windbreak unless a wind objective is selected.

### Context-gated systems

- `silvopasture` is offered only when grazing/livestock is an explicit objective.
- `riparian-buffer` is offered only when a mapped or user-confirmed watercourse exists.
- `forest-farming` is offered only when an existing wooded parcel is intentionally retained. It must not pass through the blank-slate woody-cover rejection flow.

## Evidence basis

- USDA NRCS defines alley cropping as tree or shrub rows/corridors with agronomic crop or forage alleys, sized for adequate crop light and equipment access: <https://www.nrcs.usda.gov/conservation-basics/land/forests/agroforestry-systems/alley-cropping>
- USDA NRCS defines field windbreaks as one or more woody rows perpendicular to troublesome prevailing winds and recommends 35–60% barrier density during the erosion period: <https://www.nrcs.usda.gov/conservation-basics/land/forests/agroforestry-systems/field-windbreak>
- FAO includes alley farming, mixed intercropping, boundary tree planting, windbreaks, and shelterbelts in agroforestry classification: <https://www.fao.org/4/x5546e/x5546e06.htm>
- The 2025 Lancet Planetary Health review describes syntropic systems through succession and vertical stratification, while noting scarce temperate evidence, mixed productivity comparisons, high labour demand, and intensive knowledge requirements: <https://doi.org/10.1016/S2542-5196(25)00047-6>
- ShadOT demonstrates that row orientation changes the spatial and temporal distribution of shade in alley cropping and provides a reproducible open-source modelling precedent: <https://pubmed.ncbi.nlm.nih.gov/38098769/>

## Solar and terrain engine

The old `solar` variant used a fixed north–south bearing. That shortcut is not sufficient and is replaced by the following auditable calculation.

### Inputs

- Site latitude, longitude, timezone, polygon, holes, and plantable constraints.
- Elevation samples, fitted slope, and aspect with source resolution and confidence.
- Historical hourly direct normal irradiance, diffuse radiation, shortwave radiation, cloud cover, and wind vectors from Open-Meteo for 2021–2025.
- Candidate row bearings between 0° and 175° at 5° intervals, plus contour, longest-axis, custom, and wind-normal bearings.
- Species mature height, crown diameter, growth state, and scenario-year canopy dimensions.
- Crop alley width and a crop-light objective when an interior crop is present.

### Solar position

For each representative hourly timestep, calculate solar zenith and azimuth from timestamp and site coordinates. The implementation follows the geometry and terminology of the NREL Solar Position Algorithm. The engine records its calculation version and does not claim NREL SPA numerical uncertainty unless it implements and verifies the complete SPA procedure.

Primary reference: <https://midcdmz.nrel.gov/spa/>

### Terrain correction

Fit a local plane to elevation samples rather than deriving slope from only the highest and lowest points. For each timestep, project direct irradiance onto the fitted terrain plane using solar azimuth, solar elevation, slope, and aspect. Diffuse radiation remains a separate component with an explicit sky-view approximation. If terrain resolution is coarser than the parcel or the fitted plane is unstable, lower confidence and keep the result advisory.

### Shade model

For each tree-row scenario and analysis year:

1. Derive tree height and crown width from the growth model.
2. Compute the sun-relative cross-row angle.
3. Project crown shadow length and direction onto the terrain plane.
4. Intersect projected shadows with crop-interior sample cells.
5. Aggregate direct-radiation loss, diffuse availability, sunlit hours, and shaded-area fraction by month and season.

The calculation is a comparative design model, not a promise of crop PAR. Leaf-area density, crown transmittance, pruning, crop response, and local horizon obstructions require calibrated field data and remain explicit assumptions.

### Orientation scoring by system

- **Alley cropping:** maximize winter and annual crop-interior radiation while limiting excessive summer exposure, respect equipment width, and penalize erosion-increasing cross-slope layouts.
- **Perimeter buffer:** preserve central crop light; compare all-sided, north-side, south-side, and user-selected edges.
- **Windbreak:** optimize perpendicularity to damaging prevailing winds first, then report the solar/shade cost rather than silently rotating the rows.
- **Syntropic succession:** evaluate time-dependent canopy shade at establishment, year 5, year 10, and maturity, including scheduled pruning/removal events.
- **Orchard/monoculture:** compare canopy-side radiation balance, operational axis, slope/erosion risk, and mature self-shading.

### Outputs

Each generated alternative reports:

- bearing and reason it was considered;
- annual and seasonal radiation on the plantable/crop-interior plane;
- shaded crop-interior area and sunlit hours at selected years;
- wind alignment and erosion/contour alignment;
- a component score with raw values, weights, evidence, and confidence;
- limitations and field measurements needed before execution.

## Weather source

Open-Meteo's Historical Weather API provides hourly direct normal irradiance, diffuse radiation, direct radiation, shortwave radiation, and wind variables suitable for the comparative engine: <https://open-meteo.com/en/docs/historical-weather-api>

