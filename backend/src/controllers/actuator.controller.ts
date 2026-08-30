import { Request, Response } from 'express';
import { ActuatorService } from '../services/actuator.service.js';
import { RelayChannel, RelayAction, SystemCommand } from '../types/telemetry.js';
import { mqttService } from '../services/mqtt.service.js';

export const actuatorController = {
  getRelayStates: (req: Request, res: Response) => {
    return res.status(200).json({
      success: true,
      data: mqttService.relayStateReceived ? mqttService.latestRelayState : null,
      known: mqttService.relayStateReceived,
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

    // Firmware hanya mengerti ON/OFF (via r{ch}on/r{ch}off)
    if (!['ON', 'OFF'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid action. Must be ON or OFF.',
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
      message: `Command r${channel}${action.toLowerCase()} sent to firmware.`,
      channel,
      action,
    });
  },

  triggerAllRelays: (req: Request, res: Response) => {
    const { action } = req.body as { action: RelayAction };

    if (!['ON', 'OFF'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid action. Must be ON or OFF.',
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
      message: action === 'OFF'
        ? 'Sent "auto" command — all relays returned to automatic control.'
        : `Sent r1on..r4on commands to firmware.`,
      action,
    });
  },

  /**
   * Perintah sistem ke firmware.
   *
   * API menerima UPPERCASE untuk backward compat, tapi firmware butuh lowercase.
   * Mapping:
   *   RESET     → "reset"
   *   MAINT_ON  → "maint_on"
   *   MAINT_OFF → "maint_off"
   *   AUTO      → "auto"
   */
  triggerSystemCommand: (req: Request, res: Response) => {
    const { command } = req.body as { command: string };

    // Mapping uppercase API → lowercase firmware command
    const commandMap: Record<string, SystemCommand> = {
      RESET: 'reset',
      MAINT_ON: 'maint_on',
      MAINT_OFF: 'maint_off',
      AUTO: 'auto',
      // Juga terima lowercase langsung
      reset: 'reset',
      maint_on: 'maint_on',
      maint_off: 'maint_off',
      auto: 'auto',
    };

    const firmwareCmd = commandMap[command];

    if (!firmwareCmd) {
      return res.status(400).json({
        success: false,
        error: 'Invalid system command. Must be RESET, MAINT_ON, MAINT_OFF, or AUTO.',
      });
    }

    const ok = ActuatorService.sendSystemCommand(firmwareCmd);

    if (!ok) {
      return res.status(503).json({
        success: false,
        error: 'Failed to send system command to MQTT broker.',
      });
    }

    return res.status(200).json({
      success: true,
      message: `System command "${firmwareCmd}" sent to firmware.`,
      command: firmwareCmd,
    });
  },
};
