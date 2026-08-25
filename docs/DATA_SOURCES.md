# GrowUp data sources

Every environmental, botanical, price and cost value shown to users carries a source, a date or version, and a confidence level. Unknown provider values stay unknown. This file lists the **exact URLs** GrowUp cites or requests at runtime. It does not redistribute third-party bulk datasets.

Canonical code citations live in `src/data/`, `src/lib/` and `server/`. The import inventory for Switchboard and GlobUNT is `data/SOURCES.md`.

## FAO

GrowUp does **not** use the FAO homepage. These are the FAO records actually referenced:

| Record | URL | Use in GrowUp |
| --- | --- | --- |
| FAO ECOCROP via GAEZ | https://gaez.fao.org/pages/ecocrop | Climate, soil-reaction and crop-ecology envelopes for design-ready species; life-form and planting-window support in the Care catalogue. Access checked 2026-07-21. |
| FAO GAEZ portal | https://gaez.fao.org/ | Host for the ECOCROP viewer used above. |
| FAO Irrigation and Drainage Paper 66 | https://www.fao.org/4/i2800e/i2800e00.pdf | Rainfed versus irrigated fruit-tree yield envelopes (olive, citrus, almond, pistachio). 2012, checked 2026-08-24. Not mixed-system hectare yield. |
| FAO olive production systems (ID 66, ch. 9) | https://www.fao.org/4/i2800e/i2800e09.pdf | Traditional grove fruit-yield context. t/ha is not applied to mixed agroforestry. |
| FAOSTAT | https://www.fao.org/faostat/ | National fruit and nut t/ha **context only**. Never multiplied by GrowUp plant counts. Checked 2026-08-24. |
| FAO agroforestry NTFP volume (1996) | https://www.fao.org/4/w3735e/w3735e.pdf | Mature agroforest management endpoint for routine maintenance hours. |

## Catalogue and taxonomy

| Record | URL | Use in GrowUp |
| --- | --- | --- |
| Agroforestry Species Switchboard 4.0 | https://doi.org/10.5281/zenodo.15628568 | Searchable taxonomic catalogue, tree-like flag, WFO/WCVP identifiers. Zenodo record: https://zenodo.org/records/15628568 |
| GlobalUsefulNativeTrees 2023.01 | https://doi.org/10.5281/zenodo.7994433 | Useful-tree membership and cross-source validation. Zenodo record: https://zenodo.org/records/7994433 |
| ICRAF Switchboard name lookup | https://apps.worldagroforestry.org/products/switchboard/index.php/name_like/ | Per-species taxonomy link from the design catalogue. |
| EUFORGEN species pages | https://www.euforgen.org/species | European distribution, ecology and forest-use notes. Unknown native range stays unverified. |
| Plants of the World Online | https://powo.science.kew.org/ | Accepted names, native distribution, growth form and evergreen habit. |

## Climate, terrain, soil and water

| Record | URL | Use in GrowUp |
| --- | --- | --- |
| Open-Meteo Historical Weather API | https://archive-api.open-meteo.com/v1/archive | Daily rain, temperature and FAO ET₀ for 2021–2025. Climate normals, species suitability and irrigation demand. |
| Open-Meteo forecast / elevation | https://api.open-meteo.com/v1/forecast | Field elevation samples; slope, aspect, hydraulic head. Docs: https://open-meteo.com/ |
| Google Maps Elevation API | https://maps.googleapis.com/maps/api/elevation/json | Credential-protected fallback for the same elevation samples. Keys never enter the project. |
| ISRIC SoilGrids WCS | https://maps.isric.org/mapserv | Modelled pH, texture, carbon, total nitrogen and water retention at 250 m. Parcel screening, not a laboratory analysis. https://www.isric.org/explore/soilgrids |
| ISRIC / Shangguan depth to bedrock | https://files.isric.org/soilgrids/former/2017-03-10/data/BDTICM_M_250m_ll.tif | Modelled bedrock-depth cells. Never treated as measured rooting depth. |
| BGR / UNESCO WHYMAP | https://services.bgr.de/arcgis/rest/services/grundwasser/whymap_gwr/MapServer | Regional aquifer type and recharge class. Not water-table depth or well viability. Portal: https://www.whymap.org/ |

## Place search and maps

| Record | URL | Use in GrowUp |
| --- | --- | --- |
| Nominatim | https://nominatim.openstreetmap.org | Primary place search and reverse geocoding. https://nominatim.org/ |
| OpenStreetMap Overpass | https://overpass-api.de/api/interpreter | Nearby mapped land-use. Not a cadastral boundary. |
| Google Geocoding API | https://maps.googleapis.com/maps/api/geocode/json | Credential-protected fallback when Nominatim fails. |
| Google Maps satellite | https://www.google.com/maps | Visual basemap. Not redistributed as an analytical raster. |
| Esri World Imagery | https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9 | Optional comparison imagery. Never implied to be newer unless its acquisition date is known. |

## Satellite, vegetation and fire

| Record | URL | Use in GrowUp |
| --- | --- | --- |
| Sentinel-2 L2A (Planetary Computer) | https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a | Field-clipped true colour, NDVI, NDMI, NDWI, BSI and existing woody vegetation. STAC: https://planetarycomputer.microsoft.com/api/stac/v1 |
| Sentinel-1 RTC (Planetary Computer) | https://planetarycomputer.microsoft.com/dataset/sentinel-1-rtc | Same-orbit backscatter anomaly. Not volumetric soil moisture. |
| Impact Observatory 10 m LULC | https://planetarycomputer.microsoft.com/dataset/io-lulc-annual-v02 | Tree-class persistence 2021–2023. |
| ESA WorldCover 2021 | https://planetarycomputer.microsoft.com/dataset/esa-worldcover | Independent 10 m tree-cover corroboration. |
| Copernicus HRL Woody Vegetation 2021 | https://land.copernicus.eu/en/products/high-resolution-layer-small-landscape-features/woody-vegetation-layer-2021 | Isolated trees and permanent woody crops. |
| NASA GIBS | https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api | Dated landscape overlays (true colour, HLS, DSWx, flood, OMPS, DIST, IMERG). Do not replace Sentinel, SoilGrids or Open-Meteo. WMS: https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi |
| NASA FIRMS | https://firms.modaps.eosdis.nasa.gov/ | 375 m thermal hotspots. Not a parcel ignition model. |
| NASA Worldview | https://worldview.earthdata.nasa.gov | Official GIBS client permalink from the parcel box. |
| EFFIS Fire Weather Index | https://forest-fire.emergency.copernicus.eu/ | 8 km FWI forecast overlay. Viewer CSV: https://forest-fire.emergency.copernicus.eu/apps/effis.csv/ — WMTS: https://maps.effis.emergency.copernicus.eu/effist/wmts/1.0.0 |
| Natural England / Defra Heather and Grass Management Code 2025 | https://www.gov.uk/government/publications/heather-and-grass-management-code/heather-and-grass-management-code-2025 | Firebreak width basis (2.5× expected flame length). Planning only, not a safety certification. |
| USDA NRCS Firebreak Standard 394 | https://www.nrcs.usda.gov/resources/guides-and-instructions/firebreak-ft-394-conservation-practice-standard | Firebreak siting and maintenance practice. |
| Italian Civil Protection AIB plans | https://www.protezionecivile.gov.it/it/approfondimento/piani-regionali-di-previsione--prevenzione-e-lotta-attiva-agli-incendi-boschivi/ | Local-authority review requirement. |

## Operations, harvest and maintenance

| Record | URL | Use in GrowUp |
| --- | --- | --- |
| International Olive Council 2015 | https://www.internationaloliveoil.org/wp-content/uploads/2019/11/INTERNATIONAL-OLIVE-OIL-PRODUCTION-COSTS-STUDY-.pdf | Olive-to-oil mass ratio ~19.25%. |
| IPGRI / Batlle 1997 carob | https://hdl.handle.net/10568/104277 | Carob pod kg/tree and kernel share. |
| LIFE Desert-Adapt carob note | https://www.desert-adapt.it/download/Commercial%20plan%20Carob_International%20(ENG).pdf | Traditional 50–70 kg pods/tree; 2022 farm-gate band. |
| Frontiers LCC Mediterranean crops 2022 | https://www.frontiersin.org/articles/10.3389/fsufs.2022.1004065/full | Calabria orchard t/ha at stated density, converted to kg/tree. |
| OIV | https://www.oiv.int/ | About 1.35 kg grapes per litre of wine. |
| ISMEA | https://www.ismeamercati.it/ | Italian EVO farm-gate planning snapshot (2025–26), user-editable. |
| Embrapa diversified agroforestry costs | https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1006456/1/2014AA18.pdf | Routine woody-system maintenance hours. |
| Embrapa SAF management practices | https://www.atermaisdigital.cnptia.embrapa.br/web/saf/principais-manejos | Weeding, pruning and biomass placement. |
| UCCE almond orchard budget 2006 | https://ucanr.edu/sites/Tehama/files/23080.pdf | Orchard training and pruning workload. |
| USDA Forest Service ALLEY Model 2.0 | https://research.fs.usda.gov/treesearch/57480 | Alley-crop financial / workload context. |
| USDA NRCS Windbreak Standard 380 | https://www.nrcs.usda.gov/resources/guides-and-instructions/windbreakshelterbelt-establishment-and-renovation-ft-380 | Windbreak establishment and renovation. |
| Mayoral et al. 2020, Agronomy 10:955 | https://www.mdpi.com/2073-4395/10/7/955 | Traditional waning-moon pruning cue. No verified sap-flow effect. |

## Costs and exchange

| Record | URL | Use in GrowUp |
| --- | --- | --- |
| Sicilian Agriculture Price Book 2023 | https://www.regione.sicilia.it/sites/default/files/2023-08/PREZZARIO%20REGIONALE%20AGRICOLTURA%202023.pdf | Plant stock, planting, dripline, mainline, fittings, pump and controller rates. Converted into the internal USD planning basket. Local rates remain user overrides. |
| Nursery retail comparison | https://www.vivaipiantebaldifranco.it/wp-content/uploads/2025/09/listino-09-09-25.pdf | Published stock-price comparison, normalized to USD. |
| Grafted stock retail comparison | https://www.savinivivai.it/it/shop/piante-da-frutto/piante-di-mandorlo/ | Published grafted-tree comparison, accessed 2026-07-21. |
| country.io currency map | https://country.io/currency.json | Country to ISO currency code. |
| ExchangeRate-API USD table | https://open.er-api.com/v6/latest/USD | Internal USD-to-local conversion. Not shown as a UI mechanic. |

## Machinery references

| Record | URL | Use in GrowUp |
| --- | --- | --- |
| BCS 740 Action | https://bcsagri.com/en-001/product/740-action/ | Two-wheel tractor envelope. |
| John Deere 1025R | https://www.deere.com/en/tractors/compact-tractors/1-series-sub-compact-tractors/1025r/ | Sub-compact tractor envelope. |
| John Deere 3033R | https://www.deere.com/en/tractors/compact-tractors/3-series-compact-tractors/3033r/ | Compact tractor envelope. |
| New Holland T4F/V | https://www.newholland.com/en-us/nar/products/tractors-telehandlers/t4fv | Narrow orchard tractor envelope. |

Machinery corridors are generated only when the user enables them. Default is off.

## Assistant

| Record | URL | Use in GrowUp |
| --- | --- | --- |
| DeepSeek API | https://api-docs.deepseek.com/ | Optional planning proposals. Species are resolved against the GrowUp catalogue. Nothing mutates without confirmation. The API key stays server-side. |

## What is not ingested

PFAF / Useful Temperate Plants prose, raw PEP725 observations, and CABI / PROTA bulk fields are not copied into the catalogue. Switchboard source payloads are not stored; Switchboard is a taxonomy linker only.
