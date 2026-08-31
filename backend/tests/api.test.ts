import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { initSQLiteSchema } from '../src/database/sqlite.js';
import { authService } from '../src/services/auth.service.js';

describe('REST API Endpoints Tests', () => {
  const token = authService.generateToken({ username: 'admin', role: 'admin', displayName: 'Admin' });

  beforeAll(() => {
    initSQLiteSchema();
  });

  it('GET /api/v1/health should return status ok', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toContain('Smart Hydroponics');
  });

  it('GET /api/v1/telemetry/latest should return latest telemetry data', async () => {
    const res = await request(app).get('/api/v1/telemetry/latest');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
  });

  it('GET /api/v1/diagnostics/health should return hardware and mqtt status', async () => {
    const res = await request(app).get('/api/v1/diagnostics/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.mqtt).toBeDefined();
    expect(res.body.data.server).toBeDefined();
  });

  it('GET /api/v1/alarms should return alarm list', async () => {
    const res = await request(app).get('/api/v1/alarms');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST /api/v1/relays/99/command should return 400 for invalid channel', async () => {
    const res = await request(app)
      .post('/api/v1/relays/99/command')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'ON' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/v1/system/command should return 400 for invalid command', async () => {
    const res = await request(app)
      .post('/api/v1/system/command')
      .set('Authorization', `Bearer ${token}`)
      .send({ command: 'INVALID_CMD' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
