# Multi-year maintenance model

## Scope

`growup-maintenance-1.1.0` estimates routine person-hours and labour cost for the woody planting system from year 1 onward. It is not a crop gross-margin model.

Included activities:

- selective vegetation and orchard-floor control;
- training, structural and light-management pruning;
- biomass and succession management where relevant;
- inspection, protection checks and routine replacement work.

Excluded activities:

- harvest, processing and marketing;
- annual crop operations between tree rows;
- plants, guards, mulch, fertiliser, pesticide, fuel and other materials;
- storm repair, major renovation, tree removal and other extraordinary work.

The displayed cost is therefore `person-hours × the project labour rate`. The user-supplied labour rate remains the authoritative project input.

## Evidence used

| Source | Use in the model |
|---|---|
| Embrapa, *Economic evaluation of a diversified agroforestry system* (2014) | Measured diversified agroforestry maintenance cost and its labour share. At the reported R$10/hour rate, the table corresponds to approximately 501, 198, 247 and 151 person-hours per hectare in years 1–4. It supports a high establishment workload followed by a lower, non-zero mature workload. |
| Embrapa, *Main management practices in agroforestry systems* | Defines selective weeding, pruning, biomass placement and succession management. It explicitly notes that weed-control work becomes lighter as shade and mulch accumulate. |
| FAO, *Domestication and commercialization of non-timber forest products in agroforestry systems* (1996) | Supports the long-term planning endpoint in which a mature agroforest resembles a natural forest and routine human intervention can be minimized. |
| University of California Cooperative Extension, *Sample costs to establish an almond orchard and produce almonds* (2006) | Supports recurring orchard-floor management and pruning/training in both establishment and production years. It prevents the monoculture curve from incorrectly falling toward zero. |
| USDA Forest Service, *ALLEY Model 2.0* (2018) | Supports a distinct long-term economic structure for alley cropping. Growup counts only the woody-system maintenance workload, not annual crop production. |
| USDA NRCS, Conservation Practice Standard 380 (2021) | Supports annual inspection, establishment protection, competing-vegetation control, replacement and periodic pruning/renovation for windbreaks and boundary buffers. |

The evidence is not globally representative of every species, wage structure, terrain or management regime. Profiles marked `triangulated-planning-default` intentionally have low confidence until replaced with farm records.

## Calculation

For each task:

```text
task hours =
  effective managed hectares × interpolated area hours per hectare
  + active plants × interpolated hours per plant
  + interpolated fixed mobilisation hours
```

`effective managed hectares` is the greater of:

- the profile's managed fraction of the site; and
- the active-plant count multiplied by a system-specific managed footprint;

and is capped at the site area.

Each task has an initial and mature coefficient. Syntropic profiles reach their forest-autonomy endpoint in year 25; other systems retain their own transition period. The transition uses:

```text
progress = ((year - 1) / (transition years - 1)) ^ curve exponent
```

with values clamped to the 0–1 range. Lower exponents represent the evidence-backed early reduction in selective weeding and replacement work. Pruning can increase as orchard trees mature, so the monoculture profile reaches a stable plateau rather than inheriting the syntropic decline.

## System behaviour

| System | Model behaviour | Evidence basis | Confidence |
|---|---|---|---|
| Syntropic | High early selective weeding, biomass and succession work; every routine task reaches zero at the year-25 forest-autonomy planning endpoint | Measured agroforestry references plus the FAO mature-agroforest endpoint | Medium |
| Monoculture | Lower complexity at establishment; recurring floor management and increasing structural pruning produce a stable mature plateau | Orchard enterprise budget | Medium |
| Mixed orchard | Early vegetation-control decline combined with increasing fruit-tree pruning | Triangulated agroforestry and orchard references | Low |
| Alley cropping | Woody-row workload only; excludes annual alley crop operations | USDA Forest Service plus agroforestry management reference | Low |
| Windbreak | Early vegetation control and replacement, then annual inspection and annualised pruning | NRCS practice standard | Medium |
| Boundary buffer | Windbreak logic with a smaller managed footprint and edge-access allowance | NRCS practice standard | Medium |

The zero-hour syntropic endpoint means no scheduled routine labour in Growup's planning scope. It does not mean that a mature site can never require human attention. Optional harvest, productive pruning, monitoring, access work and extraordinary interventions remain outside this routine-maintenance estimate and should be scheduled separately when the operator chooses to perform them.

## Calibration

The API returns task-level area, plant and fixed-hour components, model version, basis, confidence and sources. Farm records can therefore be compared against each component without changing the irrigation model. A future calibrated profile should preserve the same task contract and increment the model version.
