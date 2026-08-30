import { env } from '../config/env.js';
import { logger } from '../core/logger.js';
import { RelayChannel, RelayAction, SystemCommand } from '../types/telemetry.js';
import { sqliteRepo } from '../database/sqlite.js';
import { mqttService } from './mqtt.service.js';

/**
 * Nama relay sesuai firmware config.c L37-38
 */
export const RELAY_NAMES: Record<RelayChannel, string> = {
  1: 'pompa_nutrisi',
  2: 'misting',
  3: 'exhaust_fan',
  4: 'lampu_grow',
};

/**
 * Topik CMD firmware — semua perintah (relay + sistem) dikirim ke sini.
 * Firmware: onMqtt() subscribe ke "{MQTT_BASE}/cmd"
 * Lihat: HydroController.ino L982-1029
 */
function getCmdTopic(): string {
  return `${env.MQTT_BASE_TOPIC}/cmd`;
}

export class ActuatorService {
  /**
   * Mengirim perintah ke kanal relay tertentu (1..4)
   *
   * Firmware format (HydroController.ino L987-1004):
   *   "r1on"  → relay 1 ON (manual override)
   *   "r1off" → relay 1 OFF
   *   "r2on"  → relay 2 ON
   *   ...dst
   *
   * Perintah dikirim ke topik CMD, BUKAN topik relay terpisah.
   */
  public static sendRelayCommand(channel: RelayChannel, action: RelayAction, source: 'web' | 'mqtt_sync' = 'web'): boolean {
    if (channel < 1 || channel > 4) {
      logger.error(`Invalid relay channel requested: ${channel}`);
      return false;
    }

    const relayName = RELAY_NAMES[channel];
    const cmdTopic = getCmdTopic();

    // Format perintah sesuai firmware: "r{ch}on" / "r{ch}off"
    const cmdPayload = `r${channel}${action.toLowerCase()}`;

    logger.info(`[ACTUATOR] Sending Relay Command -> Topic: ${cmdTopic} | Payload: "${cmdPayload}" | Channel: ${channel} (${relayName})`);

    const ok = mqttService.publish(cmdTopic, cmdPayload);

    if (ok) {
      // Perbarui relay state seketika dan broadcast via WebSocket (0ms lag)
      mqttService.updateRelayState(channel, action);

      sqliteRepo.insertRelayLog({
        channel,
        relay_name: relayName,
        action,
        source,
        timestamp: new Date().toISOString(),
      });
    }

    return ok;
  }

  /**
   * Mengirim perintah ke seluruh relay sekaligus.
   *
   * Firmware tidak punya perintah "all ON" / "all OFF" eksplisit.
   * Untuk mematikan semua dan kembali ke otomatis, kirim "auto".
   * Untuk ON/OFF individual, kirim per-channel.
   */
  public static sendAllRelayCommand(action: RelayAction, source: 'web' | 'mqtt_sync' = 'web'): boolean {
    const cmdTopic = getCmdTopic();

    // Untuk OFF semua, cara firmware yang benar = kirim "auto" (kembali ke otomatis)
    if (action === 'OFF') {
      logger.info(`[ACTUATOR] Sending AUTO (all off + return to auto) -> Topic: ${cmdTopic}`);
      const ok = mqttService.publish(cmdTopic, 'auto');
      if (ok) {
        for (let ch = 1; ch <= 4; ch++) {
          mqttService.updateRelayState(ch as RelayChannel, 'OFF');
          sqliteRepo.insertRelayLog({
            channel: ch as RelayChannel,
            relay_name: RELAY_NAMES[ch as RelayChannel],
            action: 'OFF',
            source,
            timestamp: new Date().toISOString(),
          });
        }
      }
      return ok;
    }

    // Untuk ON semua, kirim per-channel
    logger.info(`[ACTUATOR] Sending ALL Relay ON -> Topic: ${cmdTopic}`);
    let anySuccess = false;
    for (let ch = 1; ch <= 4; ch++) {
      const cmdPayload = `r${ch}on`;
      const ok = mqttService.publish(cmdTopic, cmdPayload);
      if (ok) {
        anySuccess = true;
        mqttService.updateRelayState(ch as RelayChannel, 'ON');
        sqliteRepo.insertRelayLog({
          channel: ch as RelayChannel,
          relay_name: RELAY_NAMES[ch as RelayChannel],
          action: 'ON',
          source,
          timestamp: new Date().toISOString(),
        });
      }
    }
    return anySuccess;
  }

  /**
   * Mengirim perintah sistem ke firmware.
   *
   * Firmware onMqtt() (HydroController.ino L1013-1028):
   *   "reset"     → reset semua latch, alarm, guard, dose lock
   *   "maint_on"  → aktifkan mode pemeliharaan (bungkam alarm)
   *   "maint_off" → matikan mode pemeliharaan
   *   "auto"      → kembalikan semua relay ke kendali otomatis
   *
   * PENTING: Semua lowercase — firmware pakai strcmp().
   */
  public static sendSystemCommand(command: SystemCommand): boolean {
    const cmdTopic = getCmdTopic();

    logger.info(`[ACTUATOR] Sending System Command -> Topic: ${cmdTopic} | Command: ${command}`);

    const ok = mqttService.publish(cmdTopic, command);

    if (ok) {
      sqliteRepo.insertSystemEvent({
        kind: 'system_cmd',
        detail: `Sent "${command}" from web dashboard`,
        is_buffered: false,
        timestamp: new Date().toISOString(),
      });
    }

    return ok;
  }

  /**
   * Kembalikan semua relay ke kendali otomatis.
   * Shortcut untuk sendSystemCommand('auto').
   */
  public static sendAutoCommand(): boolean {
    return ActuatorService.sendSystemCommand('auto');
  }
}
