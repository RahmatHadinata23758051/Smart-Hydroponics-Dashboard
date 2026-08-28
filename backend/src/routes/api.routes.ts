import { Router } from 'express';
import { telemetryController } from '../controllers/telemetry.controller.js';
import { actuatorController } from '../controllers/actuator.controller.js';
import { diagnosticsController } from '../controllers/diagnostics.controller.js';

const router = Router();

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
router.post('/relays/all/command', actuatorController.triggerAllRelays);
router.post('/relays/:channel/command', actuatorController.triggerRelay);
router.post('/system/command', actuatorController.triggerSystemCommand);

// --- Diagnostics & Logs Endpoints
router.get('/diagnostics/health', diagnosticsController.getDeviceHealth);
router.get('/alarms', diagnosticsController.getAlarms);
router.get('/relays/logs', diagnosticsController.getRelayLogs);
router.get('/events', diagnosticsController.getSystemEvents);

export default router;
