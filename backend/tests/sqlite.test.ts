import { describe, it, expect, beforeAll } from 'vitest';
import { initSQLiteSchema, sqliteRepo } from '../src/database/sqlite.js';
import { TelemetryPayload } from '../src/types/telemetry.js';

describe('SQLite Database & Repository Tests', () => {
  beforeAll(() => {
    initSQLiteSchema();
  });

  it('should insert and retrieve telemetry record', () => {
    const payload: TelemetryPayload = {
      timestamp: '2026-08-28 16:00:00',
      ip: '192.168.1.120',
      air_t: 29.1,
      air_rh: 72.4,
      lux: 25000,
      ec: 1900,
      tds: 950,
      ph: 6.4,
      water_t: 25.8,
      dist_mm: 300,
      level_pct: 76.9,
      relay: [1, 0, 1, 0],
    };

    sqliteRepo.insertTelemetry(payload);
    const latest = sqliteRepo.getLatestTelemetry();

    expect(latest).toBeDefined();
    expect(latest?.air_t).toBe(29.1);
    expect(latest?.ph).toBe(6.4);
    expect(latest?.relay).toEqual([1, 0, 1, 0]);
  });

  it('should insert alarm and resolve alarm correctly', () => {
    // 1. Insert Active Alarm
    sqliteRepo.insertAlarm({
      code: 'C10',
      level: 'critical',
      state: 'active',
      description: 'Level Tandon Kritis (< 10%) - Pompa Dikunci',
      timestamp: '2026-08-28 16:05:00',
    });

    let alarms = sqliteRepo.getAlarms(10);
    const c10Alarm = alarms.find((a: any) => a.code === 'C10' && a.state === 'active');
    expect(c10Alarm).toBeDefined();

    // 2. Resolve Alarm
    sqliteRepo.insertAlarm({
      code: 'C10',
      level: 'critical',
      state: 'clear',
      description: 'Level Tandon Kritis (< 10%) - Pompa Dikunci',
      timestamp: '2026-08-28 16:10:00',
    });

    alarms = sqliteRepo.getAlarms(10);
    const resolvedAlarm = alarms.find((a: any) => a.code === 'C10' && a.state === 'clear');
    expect(resolvedAlarm).toBeDefined();
    expect(resolvedAlarm.cleared_at).toBe('2026-08-28 16:10:00');
  });

  it('should insert and retrieve relay logs', () => {
    sqliteRepo.insertRelayLog({
      channel: 1,
      relay_name: 'pompa_nutrisi',
      action: 'ON',
      source: 'web',
      timestamp: new Date().toISOString(),
    });

    const logs = sqliteRepo.getRelayLogs(5);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].relay_name).toBe('pompa_nutrisi');
  });
});
