import { env } from '../config/env.js';
import { logger } from '../core/logger.js';
import { RelayChannel, RelayAction } from '../types/telemetry.js';
import { sqliteRepo } from '../database/sqlite.js';
import { mqttService } from './mqtt.service.js';

export const RELAY_NAMES: Record<RelayChannel, string> = {
  1: 'pompa_nutrisi',
  2: 'misting',
  3: 'exhaust_fan',
  4: 'lampu_grow',
};

export class ActuatorService {
  /**
   * Mengirim perintah ke kanal relay tertentu (1..4)
   */
  public static sendRelayCommand(channel: RelayChannel, action: RelayAction, source: 'web' | 'mqtt_sync' = 'web'): boolean {
    if (channel < 1 || channel > 4) {
      logger.error(`Invalid relay channel requested: ${channel}`);
      return false;
    }

    const topic = `${env.MQTT_RELAY_TOPIC}/${channel}`;
    const relayName = RELAY_NAMES[channel];

    logger.info(`[ACTUATOR] Sending Relay Command -> Topic: ${topic} | Command: ${action} | Channel: ${channel} (${relayName})`);

    const success = mqttService.publish(topic, action);

    if (success) {
      // Catat ke log relay
      sqliteRepo.insertRelayLog({
        channel,
        relay_name: relayName,
        action,
        source,
        timestamp: new Date().toISOString(),
      });
    }

    return success;
  }

  /**
   * Mengirim perintah ke seluruh relay sekaligus
   */
  public static sendAllRelayCommand(action: RelayAction, source: 'web' | 'mqtt_sync' = 'web'): boolean {
    const topic = `${env.MQTT_RELAY_TOPIC}/all`;
    logger.info(`[ACTUATOR] Sending ALL Relay Command -> Topic: ${topic} | Command: ${action}`);

    const success = mqttService.publish(topic, action);

    if (success) {
      for (let ch = 1; ch <= 4; ch++) {
        sqliteRepo.insertRelayLog({
          channel: ch as RelayChannel,
          relay_name: RELAY_NAMES[ch as RelayChannel],
          action,
          source,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return success;
  }

  /**
   * Mengirim perintah sistem (RESET, MAINT_ON, MAINT_OFF)
   */
  public static sendSystemCommand(command: 'RESET' | 'MAINT_ON' | 'MAINT_OFF'): boolean {
    const topic = `${env.MQTT_BASE_TOPIC}/cmd`;
    logger.info(`[ACTUATOR] Sending System Command -> Topic: ${topic} | Command: ${command}`);

    const success = mqttService.publish(topic, command);

    if (success) {
      sqliteRepo.insertSystemEvent({
        kind: 'system_cmd',
        detail: `Sent ${command} from web dashboard`,
        is_buffered: false,
        timestamp: new Date().toISOString(),
      });
    }

    return success;
  }
}
