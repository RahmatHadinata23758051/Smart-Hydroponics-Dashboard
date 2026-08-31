import { Router } from 'express';
import { telemetryController } from '../controllers/telemetry.controller.js';
import { actuatorController } from '../controllers/actuator.controller.js';
import { diagnosticsController } from '../controllers/diagnostics.controller.js';
import authRoutes from './auth.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

// --- Authentication Endpoints
router.use('/auth', authRoutes);

// --- Health Check
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Smart Hydroponics IoT Backend Service',
  });
});

// --- Telemetry Endpoints
router.get('/telemetry/latest', telemetryController.getLatest);
router.get('/telemetry/history', telemetryController.getHistory);
router.get('/telemetry/export', telemetryController.exportCsv);

// --- Actuator & Relay Endpoints
router.get('/relays/state', actuatorController.getRelayStates);
router.post('/relays/all/command', authMiddleware, actuatorController.triggerAllRelays);
router.post('/relays/:channel/command', authMiddleware, actuatorController.triggerRelay);
router.post('/system/command', authMiddleware, actuatorController.triggerSystemCommand);

// --- Diagnostics & Logs Endpoints
router.get('/diagnostics/health', diagnosticsController.getDeviceHealth);
router.get('/alarms', diagnosticsController.getAlarms);
router.get('/relays/logs', diagnosticsController.getRelayLogs);
router.get('/events', diagnosticsController.getSystemEvents);

export default router;
