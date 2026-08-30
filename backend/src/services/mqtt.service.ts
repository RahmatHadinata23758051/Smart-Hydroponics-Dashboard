import mqtt, { MqttClient } from 'mqtt';
import { env } from '../config/env.js';
import { logger } from '../core/logger.js';
import {
  TelemetryPayload,
  DeviceStatusPayload,
  RelayStatePayload,
  AlarmPayload,
  EventPayload
} from '../types/telemetry.js';
import { influxService } from '../database/influx.js';
import { sqliteRepo } from '../database/sqlite.js';
import { AlarmService } from './alarm.service.js';

export type MessageCallback = (channel: string, payload: any) => void;

function safeJsonParse<T = any>(str: string): T | null {
  try {
    const trimmed = str.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return null;
    }
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

class MqttService {
  private client: MqttClient | null = null;
  private isConnected: boolean = false;
  private subscribers: MessageCallback[] = [];

  // In-Memory Live Cache
  public latestTelemetry: TelemetryPayload | null = null;
  public latestDeviceStatus: DeviceStatusPayload | null = null;
  public latestRelayState: RelayStatePayload = {
    relay1: 'OFF',
    relay2: 'OFF',
    relay3: 'OFF',
    relay4: 'OFF',
  };
  public relayStateReceived: boolean = false;

  public init() {
    const brokerUrl = `mqtt://${env.MQTT_HOST}:${env.MQTT_PORT}`;
    logger.info(`Connecting to MQTT Broker: ${brokerUrl} (User: ${env.MQTT_USERNAME})...`);

    this.client = mqtt.connect(brokerUrl, {
      clientId: env.MQTT_CLIENT_ID,
      username: env.MQTT_USERNAME,
      password: env.MQTT_PASSWORD,
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: 30000,
    });

    this.client.on('connect', () => {
      this.isConnected = true;
      logger.info('✅ MQTT Broker connected successfully!');

      // Subscribe ke seluruh variasi topik (mendukung hidroponik/lab dan polinela/lab)
      const topicSet = new Set<string>([
        `${env.MQTT_BASE_TOPIC}/#`,
        `${env.MQTT_RELAY_TOPIC}/#`,
        'hidroponik/lab/#',
        'hidroponik/lab/relay/#',
        'polinela/lab/#',
        'polinela/lab/relay/#',
      ]);

      const topics = Array.from(topicSet);

      this.client?.subscribe(topics, (err) => {
        if (err) logger.error('Failed to subscribe to MQTT topics:', err);
        else logger.info('📡 Subscribed to live topics:', { topics });
      });
    });

    this.client.on('message', (topic, payload) => {
      this.handleIncomingMessage(topic, payload.toString());
    });

    this.client.on('error', (err) => {
      logger.error('MQTT Connection Error:', err);
    });

    this.client.on('offline', () => {
      this.isConnected = false;
      logger.warn('MQTT Client went offline. Reconnecting in 5s...');
    });

    this.client.on('reconnect', () => {
      logger.info('Reconnecting to MQTT broker...');
    });
  }

  private ensureLatestTelemetry(): TelemetryPayload {
    if (!this.latestTelemetry) {
      this.latestTelemetry = {
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
        ip: this.latestDeviceStatus?.ip || '0.0.0.0',
        air_t: null,
        air_rh: null,
        lux: null,
        ec: null,
        tds: null,
        ph: null,
        water_t: null,
        dist_mm: null,
        level_pct: null,
        relay: [
          this.latestRelayState.relay1 === 'ON' ? 1 : 0,
          this.latestRelayState.relay2 === 'ON' ? 1 : 0,
          this.latestRelayState.relay3 === 'ON' ? 1 : 0,
          this.latestRelayState.relay4 === 'ON' ? 1 : 0,
        ],
        relay_known: this.relayStateReceived,
      };
    }
    return this.latestTelemetry;
  }

  private handleIncomingMessage(topic: string, msgStr: string) {
    const raw = msgStr.trim();
    logger.debug(`[MQTT RX] Topic: ${topic} | Msg: ${raw}`);

    try {
      // -----------------------------------------------------------------------
      // 1. Telemetri Agregat Utama (misal: hidroponik/lab/telemetry atau polinela/lab/telemetry)
      // -----------------------------------------------------------------------
      if (topic.endsWith('/telemetry')) {
        const data = safeJsonParse<TelemetryPayload>(raw);
        if (data) {
          data.relay_known = true;
          this.latestTelemetry = data;
          this.relayStateReceived = true;

          if (Array.isArray(data.relay) && data.relay.length === 4) {
            this.latestRelayState = {
              relay1: data.relay[0] ? 'ON' : 'OFF',
              relay2: data.relay[1] ? 'ON' : 'OFF',
              relay3: data.relay[2] ? 'ON' : 'OFF',
              relay4: data.relay[3] ? 'ON' : 'OFF',
            };
          }

          influxService.writeTelemetry(data);
          this.notifySubscribers('telemetry', data);
        }
        return;
      }

      // -----------------------------------------------------------------------
      // 2. Parser Topik Sensor Individual (sensor1 - sensor6)
      // -----------------------------------------------------------------------
      if (topic.endsWith('/sensor1') || topic.endsWith('/sensor2')) {
        const data = safeJsonParse<any>(raw);
        if (data) {
          const tele = this.ensureLatestTelemetry();
          if (data.temp !== undefined) tele.air_t = Number(data.temp);
          if (data.hum !== undefined) tele.air_rh = Number(data.hum);
          tele.timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
          influxService.writeTelemetry(tele);
          this.notifySubscribers('telemetry', tele);
        }
        return;
      }

      if (topic.endsWith('/sensor3')) {
        const data = safeJsonParse<any>(raw);
        if (data) {
          const tele = this.ensureLatestTelemetry();
          if (data.tempair !== undefined) tele.water_t = Number(data.tempair);
          if (data.ec !== undefined) tele.ec = Number(data.ec);
          if (data.tds !== undefined) tele.tds = Number(data.tds);
          tele.timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
          influxService.writeTelemetry(tele);
          this.notifySubscribers('telemetry', tele);
        }
        return;
      }

      if (topic.endsWith('/sensor4')) {
        const data = safeJsonParse<any>(raw);
        if (data) {
          const tele = this.ensureLatestTelemetry();
          if (data.suhu !== undefined) tele.water_t = Number(data.suhu);
          if (data.ph !== undefined) tele.ph = Number(data.ph);
          tele.timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
          influxService.writeTelemetry(tele);
          this.notifySubscribers('telemetry', tele);
        }
        return;
      }

      if (topic.endsWith('/sensor5')) {
        // Sensor Hujan (rain detector)
        const data = safeJsonParse<any>(raw);
        logger.debug('[MQTT RX] Sensor5 (Rain):', data);
        return;
      }

      if (topic.endsWith('/sensor6')) {
        const data = safeJsonParse<any>(raw);
        if (data) {
          const tele = this.ensureLatestTelemetry();
          if (data.jarak !== undefined) tele.dist_mm = Number(data.jarak);
          if (data.level !== undefined) tele.level_pct = Number(data.level);
          tele.timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
          influxService.writeTelemetry(tele);
          this.notifySubscribers('telemetry', tele);
        }
        return;
      }

      // -----------------------------------------------------------------------
      // 3. Relay Individual Channel State: .../relay/1/state s.d. .../relay/4/state
      // -----------------------------------------------------------------------
      const relayChannelMatch = topic.match(/\/relay\/([1-4])\/state$/);
      if (relayChannelMatch) {
        const ch = relayChannelMatch[1];
        let state: 'ON' | 'OFF' = 'OFF';
        const json = safeJsonParse<any>(raw);
        if (json && typeof json === 'object') {
          state = (json.state || json.action || 'OFF').toString().trim().toUpperCase() === 'ON' ? 'ON' : 'OFF';
        } else {
          state = raw.toUpperCase() === 'ON' ? 'ON' : 'OFF';
        }

        this.relayStateReceived = true;
        if (ch === '1') this.latestRelayState.relay1 = state;
        if (ch === '2') this.latestRelayState.relay2 = state;
        if (ch === '3') this.latestRelayState.relay3 = state;
        if (ch === '4') this.latestRelayState.relay4 = state;

        if (this.latestTelemetry) {
          this.latestTelemetry.relay = [
            this.latestRelayState.relay1 === 'ON' ? 1 : 0,
            this.latestRelayState.relay2 === 'ON' ? 1 : 0,
            this.latestRelayState.relay3 === 'ON' ? 1 : 0,
            this.latestRelayState.relay4 === 'ON' ? 1 : 0,
          ];
          this.latestTelemetry.relay_known = true;
        }

        this.notifySubscribers('relay_state', this.latestRelayState);
        return;
      }

      // -----------------------------------------------------------------------
      // 4. Relay Aggregate State: .../relay/state
      // -----------------------------------------------------------------------
      if (topic.endsWith('/relay/state')) {
        const data = safeJsonParse<any>(raw);
        if (data && typeof data === 'object') {
          this.relayStateReceived = true;
          this.latestRelayState = {
            relay1: data.relay1 || this.latestRelayState.relay1,
            relay2: data.relay2 || this.latestRelayState.relay2,
            relay3: data.relay3 || this.latestRelayState.relay3,
            relay4: data.relay4 || this.latestRelayState.relay4,
            rssi: data.rssi !== undefined ? Number(data.rssi) : this.latestRelayState.rssi,
          };

          if (this.latestTelemetry) {
            this.latestTelemetry.relay = [
              this.latestRelayState.relay1 === 'ON' ? 1 : 0,
              this.latestRelayState.relay2 === 'ON' ? 1 : 0,
              this.latestRelayState.relay3 === 'ON' ? 1 : 0,
              this.latestRelayState.relay4 === 'ON' ? 1 : 0,
            ];
            this.latestTelemetry.relay_known = true;
          }

          this.notifySubscribers('relay_state', this.latestRelayState);
        }
        return;
      }

      // -----------------------------------------------------------------------
      // 5. Status / LWT (Heartbeat & Controller LWT)
      // -----------------------------------------------------------------------
      if (topic.endsWith('/status')) {
        // Cek jika status adalah plain text LWT (misal: "offline" atau "online")
        const lower = raw.toLowerCase();
        if (lower === 'offline' || lower === 'online') {
          logger.info(`[MQTT] Controller LWT Status -> ${lower} (Topic: ${topic})`);
          if (this.latestDeviceStatus) {
            this.latestDeviceStatus.status = lower as 'online' | 'offline';
          } else {
            this.latestDeviceStatus = {
              status: lower as 'online' | 'offline',
              ip: '0.0.0.0',
              uptime_s: 0,
              rssi: 0,
              heap: 0,
              bus_tx: 0,
              bus_err: 0,
              bus_err_pct: 0,
              maint: 0,
            };
          }
          this.notifySubscribers('device_lwt', { status: lower });
          this.notifySubscribers('status', this.latestDeviceStatus);
          return;
        }

        // Cek jika status adalah JSON object (Heartbeat payload)
        const data = safeJsonParse<DeviceStatusPayload>(raw);
        if (data && typeof data === 'object') {
          this.latestDeviceStatus = data;
          influxService.writeHeartbeat(data);
          this.notifySubscribers('status', data);
        }
        return;
      }

      // -----------------------------------------------------------------------
      // 6. Alarms & Events
      // -----------------------------------------------------------------------
      if (topic.endsWith('/alarm')) {
        const data = safeJsonParse<AlarmPayload>(raw);
        if (data) {
          const record = AlarmService.processAlarm(data);
          this.notifySubscribers('alarm', record);
        }
        return;
      }

      if (topic.endsWith('/event')) {
        const data = safeJsonParse<EventPayload>(raw);
        if (data) {
          sqliteRepo.insertSystemEvent({
            kind: data.kind,
            detail: data.detail,
            is_buffered: !!data.buffered,
            timestamp: new Date(data.ts > 1000000000000 ? data.ts : Date.now()).toISOString(),
          });
          this.notifySubscribers('event', data);
        }
        return;
      }
    } catch (err) {
      logger.error(`Error processing message on topic ${topic}:`, err);
    }
  }

  public subscribeEvents(cb: MessageCallback) {
    this.subscribers.push(cb);
  }

  private notifySubscribers(channel: string, payload: any) {
    for (const cb of this.subscribers) {
      try {
        cb(channel, payload);
      } catch (err) {
        logger.error('Subscriber callback error:', err);
      }
    }
  }

  public publish(topic: string, message: string): boolean {
    if (!this.client || !this.isConnected) {
      logger.warn(`Cannot publish to ${topic}: MQTT client not connected.`);
      return false;
    }
    this.client.publish(topic, message, { qos: 1 });
    return true;
  }

  public getStatus() {
    return {
      connected: this.isConnected,
      broker: `${env.MQTT_HOST}:${env.MQTT_PORT}`,
      client_id: env.MQTT_CLIENT_ID,
    };
  }
}

export const mqttService = new MqttService();
