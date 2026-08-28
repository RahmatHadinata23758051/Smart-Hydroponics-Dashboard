import { Request, Response } from 'express';
import { ActuatorService } from '../services/actuator.service.js';
import { RelayChannel, RelayAction } from '../types/telemetry.js';
import { mqttService } from '../services/mqtt.service.js';

export const actuatorController = {
  getRelayStates: (req: Request, res: Response) => {
    return res.status(200).json({
      success: true,
      data: mqttService.latestRelayState,
    });
  },

  triggerRelay: (req: Request, res: Response) => {
    const channel = Number(req.params.channel) as RelayChannel;
    const { action } = req.body as { action: RelayAction };

    if (![1, 2, 3, 4].includes(channel)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid relay channel. Must be 1, 2, 3, or 4.',
      });
    }

    if (!['ON', 'OFF', 'TOGGLE'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid action. Must be ON, OFF, or TOGGLE.',
      });
    }

    const ok = ActuatorService.sendRelayCommand(channel, action, 'web');

    if (!ok) {
      return res.status(503).json({
        success: false,
        error: 'Failed to dispatch command to MQTT broker. Check broker connection.',
      });
    }

    return res.status(200).json({
      success: true,
      message: `Command ${action} sent to Relay ${channel}.`,
      channel,
      action,
    });
  },

  triggerAllRelays: (req: Request, res: Response) => {
    const { action } = req.body as { action: RelayAction };

    if (!['ON', 'OFF', 'TOGGLE'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid action. Must be ON, OFF, or TOGGLE.',
      });
    }

    const ok = ActuatorService.sendAllRelayCommand(action, 'web');

    if (!ok) {
      return res.status(503).json({
        success: false,
        error: 'Failed to dispatch command to MQTT broker.',
      });
    }

    return res.status(200).json({
      success: true,
      message: `Command ${action} sent to all relays.`,
      action,
    });
  },

  triggerSystemCommand: (req: Request, res: Response) => {
    const { command } = req.body as { command: 'RESET' | 'MAINT_ON' | 'MAINT_OFF' };

    if (!['RESET', 'MAINT_ON', 'MAINT_OFF'].includes(command)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid system command. Must be RESET, MAINT_ON, or MAINT_OFF.',
      });
    }

    const ok = ActuatorService.sendSystemCommand(command);

    if (!ok) {
      return res.status(503).json({
        success: false,
        error: 'Failed to send system command to MQTT broker.',
      });
    }

    return res.status(200).json({
      success: true,
      message: `System command ${command} sent successfully.`,
      command,
    });
  },
};
