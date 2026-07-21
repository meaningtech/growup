import type { DesignConfiguration, SiteProfile, SolarOrientationAssessment } from '../types';

type SolarPosition = { elevationDegrees: number; azimuthDegrees: number };

export function solarPositionNoaa(date: Date, latitudeDegrees: number, longitudeDegrees: number): SolarPosition {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = Math.floor((date.getTime() - start) / 86_400_000);
  const utcHour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const gamma = 2 * Math.PI / 365 * (day - 1 + (utcHour - 12) / 24);
  const equationOfTime = 229.18 * (
    0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma)
  );
  const declination = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const trueSolarMinutes = modulo(utcHour * 60 + equationOfTime + 4 * longitudeDegrees, 1440);
  const hourAngle = toRadians(trueSolarMinutes / 4 - 180);
  const latitude = toRadians(latitudeDegrees);
  const cosineZenith = clamp(
    Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle),
    -1,
    1,
  );
  const elevation = Math.asin(cosineZenith);
  const azimuth = modulo(toDegrees(Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(latitude) - Math.tan(declination) * Math.cos(latitude),
  )) + 180, 360);
  return { elevationDegrees: toDegrees(elevation), azimuthDegrees: azimuth };
}

export function assessSolarOrientation(
  profile: SiteProfile,
  design: DesignConfiguration,
  bearingDegrees: number,
  canopy: { heightM: number; crownDiameterM: number },
): SolarOrientationAssessment {
  const climatology = profile.solar?.hourlyClimatology ?? [];
  const contourBearing = modulo(profile.terrain.aspectDegrees + 90, 180);
  const windBearing = profile.solar?.prevailingWindDirectionDegrees === null || profile.solar?.prevailingWindDirectionDegrees === undefined
    ? null
    : modulo(profile.solar.prevailingWindDirectionDegrees + 90, 180);
  const base = {
    bearingDegrees: round(modulo(bearingDegrees, 180), 0),
    windAlignmentDegrees: windBearing === null ? null : round(axisDifference(bearingDegrees, windBearing), 1),
    contourAlignmentDegrees: round(axisDifference(bearingDegrees, contourBearing), 1),
    method: 'Open-Meteo 2021–2025 hourly radiation climatology; NOAA/Meeus solar geometry; terrain-plane incidence; geometric crown-shadow comparison',
    limitations: [
      'Comparative irradiance is not crop PAR and does not model local horizon obstructions.',
      'Crown transmittance, pruning response and leaf-area density require field calibration.',
    ],
  };
  if (profile.solar?.status !== 'available' || !climatology.length) {
    return {
      ...base,
      status: 'unavailable',
      terrainPlaneKwhM2Year: null,
      cropSolarAccessPercent: null,
      shadedCropAreaPercent: null,
      winterSunHoursPerDay: null,
      summerSunHoursPerDay: null,
      confidence: 'low',
      limitations: ['Historical hourly radiation is unavailable.', ...base.limitations],
    };
  }

  const slopeRadians = Math.atan(profile.terrain.slopePercent / 100);
  const aspectRadians = toRadians(profile.terrain.aspectDegrees);
  const planeNormal = {
    east: -Math.sin(slopeRadians) * Math.sin(aspectRadians),
    north: -Math.sin(slopeRadians) * Math.cos(aspectRadians),
    up: Math.cos(slopeRadians),
  };
  let planeWh = 0;
  let accessibleWh = 0;
  let shadeWeightedWh = 0;
  let directWh = 0;
  let winterSunHours = 0;
  let summerSunHours = 0;
  const winterDays = daysInMonth(12) + daysInMonth(1) + daysInMonth(2);
  const summerDays = daysInMonth(6) + daysInMonth(7) + daysInMonth(8);

  for (const bin of climatology) {
    const days = daysInMonth(bin.month);
    const utcOffset = europeRomeUtcOffset(bin.month);
    const date = new Date(Date.UTC(2024, bin.month - 1, 15, bin.hour - utcOffset, 30));
    const sun = solarPositionNoaa(date, profile.centroid.lat, profile.centroid.lng);
    if (sun.elevationDegrees <= 0) continue;
    const elevation = toRadians(sun.elevationDegrees);
    const azimuth = toRadians(sun.azimuthDegrees);
    const sunVector = {
      east: Math.sin(azimuth) * Math.cos(elevation),
      north: Math.cos(azimuth) * Math.cos(elevation),
      up: Math.sin(elevation),
    };
    const incidence = Math.max(0, sunVector.east * planeNormal.east + sunVector.north * planeNormal.north + sunVector.up * planeNormal.up);
    const directPlane = bin.directNormalWm2 * incidence;
    const diffusePlane = bin.diffuseWm2 * (1 + Math.cos(slopeRadians)) / 2;
    const totalPlane = directPlane + diffusePlane;
    const crossRowFactor = Math.abs(Math.sin(toRadians(sun.azimuthDegrees - bearingDegrees)));
    const projectedHeightShadow = canopy.heightM / Math.max(0.12, Math.tan(elevation)) * crossRowFactor;
    const effectiveShadowM = canopy.crownDiameterM * 0.72 + projectedHeightShadow;
    const alleyWidth = Math.max(2, design.cropAlleyWidthM || design.perimeterBandM * 2);
    const extentFactor = design.extent === 'perimeter-band' ? 0.35 : design.extent === 'selected-edges' ? 0.22 : 1;
    const shadeFraction = clamp(effectiveShadowM / alleyWidth * extentFactor, 0, 1);
    const accessible = diffusePlane + directPlane * (1 - shadeFraction);

    planeWh += totalPlane * days;
    directWh += directPlane * days;
    accessibleWh += accessible * days;
    shadeWeightedWh += directPlane * shadeFraction * days;
    const isSunlit = totalPlane >= 120 && shadeFraction < 0.5;
    if ([12, 1, 2].includes(bin.month)) {
      if (isSunlit) winterSunHours += days;
    }
    if ([6, 7, 8].includes(bin.month)) {
      if (isSunlit) summerSunHours += days;
    }
  }

  return {
    ...base,
    status: 'available',
    terrainPlaneKwhM2Year: round(planeWh / 1000, 0),
    cropSolarAccessPercent: round(accessibleWh / Math.max(1, planeWh) * 100, 1),
    shadedCropAreaPercent: round(shadeWeightedWh / Math.max(1, directWh) * 100, 1),
    winterSunHoursPerDay: round(winterSunHours / winterDays, 1),
    summerSunHoursPerDay: round(summerSunHours / summerDays, 1),
    confidence: profile.terrain.evidence.confidence === 'low' ? 'low' : 'medium',
  };
}

export function orientationScore(assessment: SolarOrientationAssessment, design: DesignConfiguration): number {
  if (assessment.status !== 'available') return 50;
  const solar = assessment.cropSolarAccessPercent ?? 50;
  const contour = 100 - assessment.contourAlignmentDegrees / 90 * 100;
  const wind = assessment.windAlignmentDegrees === null ? 50 : 100 - assessment.windAlignmentDegrees / 90 * 100;
  if (design.orientationObjective === 'contour') return round(contour * 0.7 + solar * 0.3, 0);
  if (design.orientationObjective === 'wind-protection') return round(wind * 0.75 + solar * 0.25, 0);
  if (design.orientationObjective === 'operations') return round(solar * 0.55 + contour * 0.45, 0);
  return round(solar * 0.75 + contour * 0.25, 0);
}

function europeRomeUtcOffset(month: number) { return month >= 4 && month <= 10 ? 2 : 1; }
function daysInMonth(month: number) { return [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]; }
function axisDifference(a: number, b: number) { const difference = Math.abs(modulo(a, 180) - modulo(b, 180)); return Math.min(difference, 180 - difference); }
function modulo(value: number, divisor: number) { return ((value % divisor) + divisor) % divisor; }
function toRadians(value: number) { return value * Math.PI / 180; }
function toDegrees(value: number) { return value * 180 / Math.PI; }
function clamp(value: number, minimum: number, maximum: number) { return Math.max(minimum, Math.min(maximum, value)); }
function round(value: number, digits: number) { return Number(value.toFixed(digits)); }
