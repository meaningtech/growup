# Growup data sources

## Agroforestry Species Switchboard 4.0

- File: `sources/switchboard-4/Switchboard_species.txt`
- Record: https://zenodo.org/records/15628568
- DOI: https://doi.org/10.5281/zenodo.15628568
- License: CC BY 4.0
- Version: 2025 publication archive for Switchboard 4.0
- MD5: `62029d90d5fece8c423a91bb013441c9`
- Rows including header: 107,270
- Use in Growup: broad searchable taxonomic catalogue, tree-like flag, source count, WFO and WCVP identifiers.

## GlobalUsefulNativeTrees

- File: `sources/globunt-2023/GlobUNT_Species_2023.txt`
- Record: https://zenodo.org/records/7994433
- DOI: https://doi.org/10.5281/zenodo.7994433
- License: CC BY 4.0
- Version: 2023.01
- MD5: `9079961907c125ee937cf52e1fe0ef99`
- Rows including header: 14,015
- Use in Growup: useful-tree membership and cross-source validation.

## Environmental and cost sources

Runtime environmental requests and curated design data cite their source in the API response. The application currently uses Open-Meteo historical and forecast APIs, SoilGrids WCS, Nominatim, Overpass, FAO ECOCROP, EUFORGEN, Plants of the World Online, and official Sicilian regional price books. Their values are not redistributed as a bulk third-party dataset.

## Existing vegetation and water context

- [Copernicus Sentinel-2 Level-2A via Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a): surface-reflectance scenes, SCL cloud mask, NDVI, NDMI, NDWI and BSI. Existing vegetation uses up to eight usable observations separated by at least 28 days, rather than an average from adjacent acquisitions.
- [Copernicus Sentinel-1 RTC via Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/dataset/sentinel-1-rtc): VV/VH observations from the same relative orbit. Growup reports a backscatter anomaly against the recent baseline and does not present it as volumetric soil moisture.
- [Impact Observatory / Microsoft / Esri 10 m Annual Land Use Land Cover V2](https://planetarycomputer.microsoft.com/dataset/io-lulc-annual-v02): 2021–2023 tree-class consensus, CC BY 4.0.
- [ESA WorldCover 2021 v200](https://planetarycomputer.microsoft.com/dataset/esa-worldcover): 10 m tree-cover class derived from Sentinel-1 and Sentinel-2, CC BY 4.0.
- [Copernicus HRL Woody Vegetation Layer 2021](https://land.copernicus.eu/en/products/high-resolution-layer-small-landscape-features/woody-vegetation-layer-2021): official 5 m WMS, including isolated trees and permanent woody crops.
- Google satellite imagery: high-resolution visual validation of the parcel boundary. It is not redistributed or used as an unlicensed analytical raster.

The classifier combines independent tree/woody classes with absolute and field-relative multi-date NDVI persistence. Connected pixels become protected polygons with a 2.5 m safety buffer. Layout generation and manual placement both reject coordinates inside those polygons. Parcels above the accepted woody-cover threshold are rejected from blank-slate generation.

## Cost basis

- Sicilian Agriculture Price Book 2023: plant stock, planting operations, dripline, mainline, fittings, pump and controller rates.
- Sicilian common agricultural labour table: EUR 24.91 per person-hour; the referenced table validity extends through 2026.
- Regional planning water baseline: EUR 0.42/m³, explicitly editable and not represented as a verified parcel contract.

Runtime results preserve the source URL, version, observation date, confidence and resolution where applicable.

## Internal planning assistant

- [DeepSeek API](https://api-docs.deepseek.com/): JSON-only planning proposals over the current project context and the curated design-ready species catalogue.
- The model cannot directly mutate project state. Growup resolves species against its own catalogue, validates variants, years and workspace sections, rejects unsafe palettes, and shows all actions for explicit confirmation.
- The API credential remains server-side and is not included in project state, browser configuration, logs or exports.
