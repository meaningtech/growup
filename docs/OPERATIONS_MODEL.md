# Species operations catalogue

`growup-operations-1.1.0` turns a selected layout into a planting handbook and a month-by-month care calendar. It is a planning estimate, not a cultivar prescription, harvest forecast or agronomic certification.

## Matching

Records are keyed by normalised scientific name, not by the 51 design-ready IDs. Resolution order:

1. Species record in the Italy knowledge pack, then climate-group window adjustment for the site country.
2. Genus archetype.
3. Design-species archetype from stock class, evergreen habit, succession and stratum.
4. Woody default when the catalogue flags the taxon as tree-like.
5. Unknown. Unknown fields stay unknown.

Countries map to three climate groups: Mediterranean (winter planting, Italy windows), temperate (spring planting after frost) and tropical (warm/wet-season windows, low confidence). Southern-hemisphere sites still shift those northern civil months by six months. Site frost and dry-season climate can shrink a window further.

The local database is `data/operations/IT.json`. Human-reviewed windows live in `data/operations/curated-IT.json` and are never discarded. Country groups live in `src/data/operationsCountries.ts`. `npm run data:operations` rebuilds the species pack until every design-ready species is complete.

## What is not ingested

- PFAF / Useful Temperate Plants text (non-commercial product licence).
- Raw PEP725 observations (registration and commercial-use declaration; no redistribution).
- CABI / PROTA bulk fields (link-only until a specific record is licensed).
- Switchboard source payloads. Switchboard remains a taxonomy linker.

## Calendar

The user sets an explicit planting date on the project. That date is stored on `ProjectOperationsPlan.plantingDate` and is the origin of every later task. Planting, mulch and guards fall on that day. Irrigation checks occupy the dry months after it. Training, pruning and coppice occupy the species windows in later years. Inspection is not a calendar procedure.

The Care tab shows a month grid with civil dates and astronomical moon phases. Opening a task shows what to do for the species in that period.

Waning-moon pruning is an optional Mediterranean tradition (prune after full moon). Growup marks waning days on the grid. It is not a measured sap-flow effect: Mayoral et al., *Agronomy* 10:955 (2020) document the belief; stem-radius studies have not confirmed a lunar water cycle. Confidence is low. Maria Thun biodynamic day-types are not used (copyrighted annual calendar, not a public dataset).

Maintenance person-hours stay in `growup-maintenance-1.1.0`; this model says when the work falls, not how many hours it takes.

Harvest dates, when present, are phenology context. They do not add harvest labour or yield.
