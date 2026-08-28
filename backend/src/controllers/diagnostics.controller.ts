import { Request, Response } from 'express';
import { mqttService } from '../services/mqtt.service.js';
import { sqliteRepo } from '../database/sqlite.js';

export const diagnosticsController = {
  getDeviceHealth: (req: Request, res: Response) => {
    const status = mqttService.latestDeviceStatus;
    const mqttInfo = mqttService.getStatus();

    return res.status(200).json({
      success: true,
      data: {
        device: status,
        mqtt: mqttInfo,
        server: {
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
          nodeVersion: process.version,
        },
      },
    });
  },

  getAlarms: (req: Request, res: Response) => {
    const limit = Number(req.query.limit) || 50;
    const alarms = sqliteRepo.getAlarms(limit);

    return res.status(200).json({
      success: true,
      data: alarms,
      count: alarms.length,
    });
  },

  getRelayLogs: (req: Request, res: Response) => {
    const limit = Number(req.query.limit) || 50;
    const logs = sqliteRepo.getRelayLogs(limit);

    return res.status(200).json({
      success: true,
      data: logs,
      count: logs.length,
    });
  },

  getSystemEvents: (req: Request, res: Response) => {
    const limit = Number(req.query.limit) || 50;
    const events = sqliteRepo.getSystemEvents(limit);

    return res.status(200).json({
      success: true,
      data: events,
      count: events.length,
    });
  },
};
