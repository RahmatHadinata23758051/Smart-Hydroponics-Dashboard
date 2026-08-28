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

      // Subscribe ke topik telemetri, status, alarm, dan relay
      const topics = [
        `${env.MQTT_BASE_TOPIC}/telemetry`,
        `${env.MQTT_BASE_TOPIC}/status`,
        `${env.MQTT_BASE_TOPIC}/alarm`,
        `${env.MQTT_BASE_TOPIC}/event`,
        `${env.MQTT_RELAY_TOPIC}/state`,
        `${env.MQTT_RELAY_TOPIC}/status`,
        `${env.MQTT_RELAY_TOPIC}/+/state`,
      ];

      this.client?.subscribe(topics, (err) => {
        if (err) logger.error('Failed to subscribe to MQTT topics:', err);
        else logger.info('📡 Subscribed to MQTT topics:', { topics });
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

  private handleIncomingMessage(topic: string, msgStr: string) {
    logger.debug(`[MQTT RX] Topic: ${topic} | Msg: ${msgStr}`);

    try {
      if (topic === `${env.MQTT_BASE_TOPIC}/telemetry`) {
        const data: TelemetryPayload = JSON.parse(msgStr);
        this.latestTelemetry = data;

        // Update relay cache from telemetry
        if (Array.isArray(data.relay) && data.relay.length === 4) {
          this.latestRelayState = {
            relay1: data.relay[0] ? 'ON' : 'OFF',
            relay2: data.relay[1] ? 'ON' : 'OFF',
            relay3: data.relay[2] ? 'ON' : 'OFF',
            relay4: data.relay[3] ? 'ON' : 'OFF',
          };
        }

        // Asynchronous storage
        influxService.writeTelemetry(data);
        this.notifySubscribers('telemetry', data);
      }

      else if (topic === `${env.MQTT_BASE_TOPIC}/status`) {
        const data: DeviceStatusPayload = JSON.parse(msgStr);
        this.latestDeviceStatus = data;
        influxService.writeHeartbeat(data);
        this.notifySubscribers('status', data);
      }

      else if (topic === `${env.MQTT_RELAY_TOPIC}/state`) {
        const data = JSON.parse(msgStr);
        this.latestRelayState = {
          relay1: data.relay1 || this.latestRelayState.relay1,
          relay2: data.relay2 || this.latestRelayState.relay2,
          relay3: data.relay3 || this.latestRelayState.relay3,
          relay4: data.relay4 || this.latestRelayState.relay4,
          rssi: data.rssi,
        };
        this.notifySubscribers('relay_state', this.latestRelayState);
      }

      else if (topic === `${env.MQTT_RELAY_TOPIC}/status`) {
        const status = msgStr.trim();
        logger.info(`[MQTT] Controller LWT Status: ${status}`);
        if (this.latestDeviceStatus) {
          this.latestDeviceStatus.status = status === 'online' ? 'online' : 'offline';
        }
        this.notifySubscribers('device_lwt', { status });
      }

      else if (topic === `${env.MQTT_BASE_TOPIC}/alarm`) {
        const data: AlarmPayload = JSON.parse(msgStr);
        const record = AlarmService.processAlarm(data);
        this.notifySubscribers('alarm', record);
      }

      else if (topic === `${env.MQTT_BASE_TOPIC}/event`) {
        const data: EventPayload = JSON.parse(msgStr);
        sqliteRepo.insertSystemEvent({
          kind: data.kind,
          detail: data.detail,
          is_buffered: !!data.buffered,
          timestamp: new Date(data.ts > 1000000000000 ? data.ts : Date.now()).toISOString(),
        });
        this.notifySubscribers('event', data);
      }
    } catch (err) {
      logger.error(`Error parsing message on topic ${topic}:`, err);
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
