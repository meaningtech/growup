export type InfoSourceGroupId = 'land' | 'imagery' | 'catalogue';

export type InfoDataSource = {
  id: string;
  name: string;
  href: string;
};

export const INFO_DATA_SOURCE_GROUPS: Array<{ id: InfoSourceGroupId; sources: InfoDataSource[] }> = [
  {
    id: 'land',
    sources: [
      { id: 'openMeteoClimate', name: 'Open-Meteo Historical Weather API', href: 'https://open-meteo.com/' },
      { id: 'openMeteoSolar', name: 'Open-Meteo hourly radiation', href: 'https://open-meteo.com/' },
      { id: 'openMeteoTerrain', name: 'Open-Meteo elevation API', href: 'https://open-meteo.com/' },
      { id: 'googleElevation', name: 'Google Maps Elevation API', href: 'https://developers.google.com/maps/documentation/elevation/overview' },
      { id: 'soilGrids', name: 'ISRIC SoilGrids', href: 'https://www.isric.org/explore/soilgrids' },
      { id: 'bedrock', name: 'ISRIC / Shangguan depth to bedrock', href: 'https://www.isric.org/' },
      { id: 'whymap', name: 'BGR / UNESCO WHYMAP', href: 'https://www.whymap.org/' },
    ],
  },
  {
    id: 'imagery',
    sources: [
      { id: 'sentinel2', name: 'Copernicus Sentinel-2 L2A', href: 'https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a' },
      { id: 'sentinel1', name: 'Copernicus Sentinel-1 RTC', href: 'https://planetarycomputer.microsoft.com/dataset/sentinel-1-rtc' },
      { id: 'lulc', name: 'Impact Observatory 10 m LULC', href: 'https://planetarycomputer.microsoft.com/dataset/io-lulc-annual-v02' },
      { id: 'worldCover', name: 'ESA WorldCover 2021', href: 'https://planetarycomputer.microsoft.com/dataset/esa-worldcover' },
      { id: 'woodyLayer', name: 'Copernicus HRL Woody Vegetation', href: 'https://land.copernicus.eu/en/products/high-resolution-layer-small-landscape-features/woody-vegetation-layer-2021' },
      { id: 'googleMaps', name: 'Google Maps satellite', href: 'https://www.google.com/maps' },
      { id: 'esri', name: 'Esri World Imagery', href: 'https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9' },
      { id: 'gibs', name: 'NASA GIBS', href: 'https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api' },
      { id: 'firms', name: 'NASA FIRMS', href: 'https://firms.modaps.eosdis.nasa.gov/' },
      { id: 'effis', name: 'EFFIS Fire Weather Index', href: 'https://forest-fire.emergency.copernicus.eu/' },
    ],
  },
  {
    id: 'catalogue',
    sources: [
      { id: 'nominatim', name: 'Nominatim / OpenStreetMap', href: 'https://nominatim.org/' },
      { id: 'googleGeocoding', name: 'Google Geocoding API', href: 'https://developers.google.com/maps/documentation/geocoding' },
      { id: 'overpass', name: 'OpenStreetMap Overpass', href: 'https://overpass-api.de/' },
      { id: 'switchboard', name: 'Agroforestry Species Switchboard 4.0', href: 'https://doi.org/10.5281/zenodo.15628568' },
      { id: 'globunt', name: 'GlobalUsefulNativeTrees', href: 'https://doi.org/10.5281/zenodo.7994433' },
      { id: 'ecocrop', name: 'FAO ECOCROP', href: 'https://gaez.fao.org/pages/ecocrop' },
      { id: 'euforgen', name: 'EUFORGEN', href: 'https://www.euforgen.org/' },
      { id: 'powo', name: 'Plants of the World Online', href: 'https://powo.science.kew.org/' },
      { id: 'sicilianPrices', name: 'Sicilian agriculture price book', href: 'https://www.regione.sicilia.it/' },
      { id: 'assistant', name: 'DeepSeek API', href: 'https://api-docs.deepseek.com/' },
    ],
  },
];
