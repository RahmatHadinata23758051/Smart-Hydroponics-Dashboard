import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { initSQLiteSchema, sqliteRepo } from '../src/database/sqlite.js';
import { mqttService } from '../src/services/mqtt.service.js';
import { ActuatorService } from '../src/services/actuator.service.js';

describe('Comprehensive End-to-End Feature Verification', () => {
  beforeAll(() => {
    initSQLiteSchema();
  });

  describe('1. Health & Meta Endpoints', () => {
    it('GET / should return service info', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Smart Hydroponics IoT Dashboard API');
    });

    it('GET /api/v1/health should return ok and timestamp', async () => {
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.timestamp).toBeDefined();
    });
  });

  describe('2. Telemetry Ingestion, History & CSV Export', () => {
    it('should store telemetry and return via GET /api/v1/telemetry/latest', async () => {
      sqliteRepo.insertTelemetry({
        timestamp: '2026-08-28 16:30:00',
        ip: '192.168.0.180',
        air_t: 28.5,
        air_rh: 65.0,
        lux: 18000,
        ec: 1750,
        tds: 875,
        ph: 6.15,
        water_t: 26.2,
        dist_mm: 550,
        level_pct: 45.0,
        relay: [0, 1, 0, 0],
      });

      const res = await request(app).get('/api/v1/telemetry/latest');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.ip).toBe('192.168.0.180');
      expect(res.body.data.air_t).toBe(28.5);
      expect(res.body.data.relay).toEqual([0, 1, 0, 0]);
    });

    it('GET /api/v1/telemetry/history should return historical rows', async () => {
      const res = await request(app).get('/api/v1/telemetry/history?range=-1h&interval=1m');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('GET /api/v1/telemetry/export should return valid CSV content', async () => {
      const res = await request(app).get('/api/v1/telemetry/export');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain('Air Temp (C)');
      expect(res.text).toContain('pH');
      expect(res.text).toContain('Level (%)');
    });
  });

  describe('3. Relay Control & Command Validation', () => {
    it('GET /api/v1/relays/state should return current relay states', async () => {
      const res = await request(app).get('/api/v1/relays/state');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('relay1');
      expect(res.body.data).toHaveProperty('relay2');
      expect(res.body.data).toHaveProperty('relay3');
      expect(res.body.data).toHaveProperty('relay4');
    });

    it('POST /api/v1/relays/1/command should validate action and record log', async () => {
      // Mock mqttService.publish to return true in test environment
      const originalPublish = mqttService.publish;
      mqttService.publish = () => true;

      const res = await request(app)
        .post('/api/v1/relays/1/command')
        .send({ action: 'ON' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.channel).toBe(1);
      expect(res.body.action).toBe('ON');

      // Verify log recorded in SQLite
      const logs = sqliteRepo.getRelayLogs(5);
      expect(logs.some((l: any) => l.channel === 1 && l.action === 'ON')).toBe(true);

      mqttService.publish = originalPublish;
    });

    it('POST /api/v1/relays/all/command should accept valid action', async () => {
      const originalPublish = mqttService.publish;
      mqttService.publish = () => true;

      const res = await request(app)
        .post('/api/v1/relays/all/command')
        .send({ action: 'OFF' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      mqttService.publish = originalPublish;
    });

    it('POST /api/v1/system/command should support RESET, MAINT_ON, MAINT_OFF', async () => {
      const originalPublish = mqttService.publish;
      mqttService.publish = () => true;

      const res1 = await request(app).post('/api/v1/system/command').send({ command: 'RESET' });
      expect(res1.status).toBe(200);
      expect(res1.body.success).toBe(true);

      const res2 = await request(app).post('/api/v1/system/command').send({ command: 'MAINT_ON' });
      expect(res2.status).toBe(200);

      const res3 = await request(app).post('/api/v1/system/command').send({ command: 'MAINT_OFF' });
      expect(res3.status).toBe(200);

      mqttService.publish = originalPublish;
    });
  });

  describe('4. Diagnostics, Alarms, and System Events', () => {
    it('GET /api/v1/diagnostics/health should return complete diagnostics metadata', async () => {
      const res = await request(app).get('/api/v1/diagnostics/health');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.server.uptime).toBeGreaterThanOrEqual(0);
      expect(res.body.data.mqtt).toBeDefined();
    });

    it('GET /api/v1/alarms should return alarm logs', async () => {
      const res = await request(app).get('/api/v1/alarms?limit=20');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('GET /api/v1/relays/logs should return relay logs', async () => {
      const res = await request(app).get('/api/v1/relays/logs?limit=20');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('GET /api/v1/events should return system events audit', async () => {
      const res = await request(app).get('/api/v1/events?limit=20');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('5. Error Handling & 404', () => {
    it('GET /api/v1/unknown-endpoint should return 404', async () => {
      const res = await request(app).get('/api/v1/unknown-endpoint');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });
});
