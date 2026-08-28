import { describe, it, expect } from 'vitest';
import { TelemetryPayload } from '../src/types/telemetry.js';

describe('Telemetry Payload Type & Logic Tests', () => {
  it('should correctly handle a valid firmware payload', () => {
    const rawPayload: TelemetryPayload = {
      timestamp: '2026-08-28 15:55:00',
      ip: '192.168.1.100',
      air_t: 28.5,
      air_rh: 75.2,
      lux: 15420,
      ec: 1850,
      tds: 925,
      ph: 6.35,
      water_t: 26.40,
      dist_mm: 350,
      level_pct: 69.2,
      relay: [0, 0, 1, 0],
    };

    expect(rawPayload.ip).toBe('192.168.1.100');
    expect(rawPayload.air_t).toBe(28.5);
    expect(rawPayload.ph).toBe(6.35);
    expect(rawPayload.relay).toEqual([0, 0, 1, 0]);
    expect(rawPayload.tds).toBe(Math.round(rawPayload.ec! * 0.5));
  });

  it('should safely support nullable / NaN converted sensor values', () => {
    const nullPayload: TelemetryPayload = {
      timestamp: 'UP:01:23:45',
      ip: '0.0.0.0',
      air_t: null,
      air_rh: null,
      lux: null,
      ec: null,
      tds: null,
      ph: null,
      water_t: null,
      dist_mm: null,
      level_pct: null,
      relay: [0, 0, 0, 0],
    };

    expect(nullPayload.air_t).toBeNull();
    expect(nullPayload.ph).toBeNull();
    expect(nullPayload.timestamp).toContain('UP:');
  });
});
