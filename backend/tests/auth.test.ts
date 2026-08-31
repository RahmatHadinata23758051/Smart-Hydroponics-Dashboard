import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { authService } from '../src/services/auth.service.js';
import { mqttService } from '../src/services/mqtt.service.js';

import { initSQLiteSchema } from '../src/database/sqlite.js';

describe('Authentication & Authorization Suite', () => {
  let validToken: string;

  beforeAll(() => {
    initSQLiteSchema();
    const user = { username: 'admin', role: 'admin' as const, displayName: 'Administrator' };
    validToken = authService.generateToken(user);
  });

  describe('1. POST /api/v1/auth/login', () => {
    it('should reject login with missing fields', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject login with wrong password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'admin', password: 'wrongpassword' });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should authenticate successfully with correct admin credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'admin', password: 'polinela-hydro-2026' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.username).toBe('admin');
      expect(res.body.user.role).toBe('admin');
    });
  });

  describe('2. GET /api/v1/auth/me', () => {
    it('should reject without token', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should return user profile with valid Bearer token', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${validToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.username).toBe('admin');
    });
  });

  describe('3. Protected Actuator Commands with Auth Middleware', () => {
    it('should block relay command without authorization header', async () => {
      const res = await request(app)
        .post('/api/v1/relays/1/command')
        .send({ action: 'ON' });
      expect(res.status).toBe(401);
    });

    it('should allow relay command with valid token', async () => {
      const originalPublish = mqttService.publish;
      mqttService.publish = () => true;

      const res = await request(app)
        .post('/api/v1/relays/1/command')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ action: 'ON' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      mqttService.publish = originalPublish;
    });
  });
});
