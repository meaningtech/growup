import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MACHINERY_CONFIGURATION,
  machineryConfigurationFromPreset,
  machineryEnvelope,
  normalizeMachineryConfiguration,
} from './machinery';

describe('machinery configuration', () => {
  it('keeps manoeuvring-space reservations disabled until explicitly enabled', () => {
    expect(DEFAULT_MACHINERY_CONFIGURATION.enabled).toBe(false);
    expect(normalizeMachineryConfiguration().enabled).toBe(false);
    expect(normalizeMachineryConfiguration({ presetId: 'new-holland-t4f' }).enabled).toBe(false);
    expect(machineryEnvelope(normalizeMachineryConfiguration())).toEqual({
      corridorWidthM: 0,
      headlandDepthM: 0,
      turningAreaRadiusM: 0,
    });
  });

  it('reserves a measured envelope after an explicit machine selection', () => {
    const configuration = machineryConfigurationFromPreset('new-holland-t4f');
    expect(configuration.enabled).toBe(true);
    const envelope = machineryEnvelope(configuration);
    expect(envelope.corridorWidthM).toBeCloseTo(3.4, 6);
    expect(envelope.headlandDepthM).toBeCloseTo(6.45, 6);
    expect(envelope.turningAreaRadiusM).toBeCloseTo(3.55, 6);
  });
});
