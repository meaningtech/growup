import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  decodePngRgba,
  fetchNasaLandscapeContext,
  matchColorEntry,
  parseGibsColormap,
} from './gibsEvidence';

function pngRgba(r: number, g: number, b: number, a: number) {
  const raw = Buffer.from([0, r, g, b, a]);
  const idat = deflateSync(raw);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const chunks = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))];
  return Buffer.concat(chunks);
}

function chunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcSource = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcSource), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const colormapXml = `<?xml version="1.0"?>
<ColorMaps>
  <ColorMap title="Rain Rate" units="mm/hr">
    <Entries>
      <ColorMapEntry rgb="128,128,128" transparent="true" nodata="true" ref="0"/>
      <ColorMapEntry rgb="0,118,78" transparent="false" value="[0.1,0.2)" ref="1"/>
    </Entries>
    <Legend type="continuous">
      <LegendEntry rgb="128,128,128" tooltip="No Data" id="0"/>
      <LegendEntry rgb="0,118,78" tooltip="0.1-0.2" id="1"/>
    </Legend>
  </ColorMap>
</ColorMaps>`;

describe('NASA GIBS complementary screening', () => {
  it('maps a GIBS colormap RGB bin to a scaled value without inventing a default', () => {
    const entries = parseGibsColormap(colormapXml);
    expect(matchColorEntry(entries, 0, 118, 78, 255)).toEqual(expect.objectContaining({
      label: '0.1-0.2',
      value: expect.closeTo(0.15, 5),
      unit: 'mm/hr',
      nodata: false,
    }));
    expect(matchColorEntry(entries, 0, 0, 0, 0)?.nodata).toBe(true);
  });

  it('decodes a 1x1 GIBS PNG sample', () => {
    expect(decodePngRgba(pngRgba(0, 118, 78, 255))).toEqual({ r: 0, g: 118, b: 78, a: 255 });
  });

  it('samples GIBS layers as extra evidence and never reports Open-Meteo rainfall', async () => {
    const png = pngRgba(0, 118, 78, 255);
    const context = await fetchNasaLandscapeContext({ lat: 36.921, lng: 14.753 }, async (input) => {
      const url = String(input);
      if (url.includes('/colormaps/')) return new Response(colormapXml, { status: 200, headers: { 'Content-Type': 'text/xml' } });
      if (url.includes('GetMap')) return new Response(png, { status: 200, headers: { 'Content-Type': 'image/png' } });
      throw new Error(`unexpected ${url}`);
    }, { now: () => new Date('2026-08-25T08:00:00.000Z') });

    expect(context.status).toBe('available');
    expect(context.observedAt).toBe('2026-08-24');
    expect(context.samples).toHaveLength(5);
    expect(context.samples.every((sample) => sample.status === 'available')).toBe(true);
    expect(context.samples[0]).toEqual(expect.objectContaining({
      id: 'precipitation',
      value: expect.closeTo(0.15, 5),
      unit: 'mm/hr',
      layer: 'IMERG_Precipitation_Rate',
    }));
    expect(context.samples.map((sample) => sample.evidence.source).join(' ')).not.toMatch(/Open-Meteo|SoilGrids|Sentinel-2/);
    expect(JSON.stringify(context.samples)).not.toContain('annualPrecipitationMm');
    expect(context.limitations.some((item) => item.includes('do not replace Open-Meteo'))).toBe(true);
  });
});
