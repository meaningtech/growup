# Species operations catalogue

`growup-operations-1.0.0` turns a selected layout into a planting handbook and a month-by-month care calendar. It is a planning estimate, not a cultivar prescription, harvest forecast or agronomic certification.

## Matching

Records are keyed by normalised scientific name, not by the 51 design-ready IDs. Resolution order:

1. Country pack for the taxon (v1 ships Italy).
2. Genus archetype.
3. Design-species archetype from stock class, evergreen habit, succession and stratum.
4. Woody default when the catalogue flags the taxon as tree-like.
5. Unknown. Unknown fields stay unknown.

Italy is the first country pack and currently also the fallback pack when another country has no overlay. The engine still shifts windows by site hemisphere, frost and dry-season climate. A non-Italian site that consumed an Italy record is labelled in the plan warnings.

The local database is `data/operations/IT.json`. Human-reviewed windows live in `data/operations/curated-IT.json` and are never discarded. `npm run data:operations` runs `scripts/enrichOperations.ts` until every design-ready species has planting method/window, pruning style/window and first-year water. Later country packs are additional JSON files with the same contract.

## What is not ingested

- PFAF / Useful Temperate Plants text (non-commercial product licence).
- Raw PEP725 observations (registration and commercial-use declaration; no redistribution).
- CABI / PROTA bulk fields (link-only until a specific record is licensed).
- Switchboard source payloads. Switchboard remains a taxonomy linker.

## Calendar

The project calendar is the union of species planting and pruning windows, first-year irrigation months from the existing water model, placenta coppice years aligned with `growup-growth-1.0.0`, and inspection reminders. Maintenance person-hours stay in `growup-maintenance-1.1.0`; this model says when the work falls, not how many hours it takes.

Harvest dates, when present, are phenology context. They do not add harvest labour or yield.
