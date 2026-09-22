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

// =====================================================================
//  Utilitas
// =====================================================================

/**
 * Parse JSON aman — mengembalikan null bila bukan JSON valid.
 * Firmware mengirim plain text untuk beberapa topik (misal: "offline", "ON"),
 * sehingga kita TIDAK boleh langsung JSON.parse().
 */
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

// =====================================================================
//  MqttService
//
//  Subscribe ke:
//    1. {MQTT_BASE_TOPIC}/# — topik utama firmware (hydroponik/unit01/#)
//    2. Legacy topics — perangkat lain yang masih publish ke prefix lama
//
//  Topik firmware (dari config.c & HydroController.ino):
//    {BASE}/status     → heartbeat JSON (retained) + LWT {"status":"offline"}
//    {BASE}/telemetry  → telemetri agregat JSON (sensor + relay + dosing)
//    {BASE}/alarm      → alarm individual JSON
//    {BASE}/event      → event JSON (boot, relay, guard_trip, dose_*, manual_*)
//    {BASE}/cmd        → (subscribe) menerima perintah: r1on, r1off, reset, dll.
// =====================================================================

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
  private relayFeedbackKnown: [boolean, boolean, boolean, boolean] = [false, false, false, false];
  private lastMainTelemetryAt: number = 0;
  private lastMainHeartbeatAt: number = 0;
  private lastControllerReadyEmitted: boolean | null = null;
  private readonly feedbackTimeoutMs = 150_000;

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

      // Build subscription list
      const topicSet = new Set<string>([
        // Topik utama firmware — hydroponik/unit01/#
        `${env.MQTT_BASE_TOPIC}/#`,
      ]);

      // Legacy topics dari perangkat lain (jika dikonfigurasi)
      const legacyTopics = env.MQTT_LEGACY_TOPICS
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);

      for (const lt of legacyTopics) {
        topicSet.add(`${lt}/#`);
      }

      const topics = Array.from(topicSet);

      this.client?.subscribe(topics, (err) => {
        if (err) logger.error('Failed to subscribe to MQTT topics:', err);
        else logger.info('📡 Subscribed to live topics:', { topics });
      });
    });

    this.client.on('message', (topic, payload, packet) => {
      this.handleIncomingMessage(topic, payload.toString(), packet.retain);
    });

    this.client.on('error', (err) => {
      logger.error('MQTT Connection Error:', err);
    });

    this.client.on('offline', () => {
      this.isConnected = false;
      this.lastMainHeartbeatAt = 0;
      this.lastMainTelemetryAt = 0;
      if (this.latestDeviceStatus?.status === 'online') {
        this.latestDeviceStatus = { ...this.latestDeviceStatus, status: 'offline' };
        this.notifySubscribers('status', this.latestDeviceStatus);
        this.notifySubscribers('device_lwt', { status: 'offline' });
      }
      logger.warn('MQTT Client went offline. Reconnecting in 5s...');
    });

    this.client.on('reconnect', () => {
      logger.info('Reconnecting to MQTT broker...');
    });

    const freshnessTimer = setInterval(() => {
      if (this.latestDeviceStatus?.status === 'online' && !this.isDeviceOnline()) {
        this.latestDeviceStatus = { ...this.latestDeviceStatus, status: 'offline' };
        this.notifySubscribers('status', this.latestDeviceStatus);
        this.notifySubscribers('device_lwt', { status: 'offline' });
      }
      const ready = this.isControllerReady();
      if (ready !== this.lastControllerReadyEmitted) {
        this.lastControllerReadyEmitted = ready;
        this.notifySubscribers('controller_ready', ready);
      }
    }, 10_000);
    freshnessTimer.unref();
  }

  // =====================================================================
  //  Inisialisasi telemetry cache
  // =====================================================================

  private ensureLatestTelemetry(): TelemetryPayload {
    if (!this.latestTelemetry) {
      this.latestTelemetry = {
        timestamp: new Date().toISOString(),
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

  // =====================================================================
  //  Dispatcher pesan masuk — route berdasar suffix topik
  // =====================================================================

  private handleIncomingMessage(topic: string, msgStr: string, retained = false) {
    const raw = msgStr.trim();
    logger.debug(`[MQTT RX] Topic: ${topic} | Msg: ${raw}`);

    try {
      // -------------------------------------------------------------------
      // 1. Telemetri Agregat
      //    Topic: {BASE}/telemetry
      //    Firmware publishTelemetry() L936-967
      // -------------------------------------------------------------------
      if (topic === `${env.MQTT_BASE_TOPIC}/telemetry`) {
        const data = safeJsonParse<TelemetryPayload>(raw);
        if (data) {
          if (!Array.isArray(data.relay) || data.relay.length !== 4 ||
              !data.relay.every(value => value === 0 || value === 1)) {
            logger.warn('Ignoring telemetry with invalid relay feedback array.');
            return;
          }
          // Field yang firmware TIDAK kirim — kita tambahkan
          data.timestamp = new Date().toISOString();
          data.ip = this.latestDeviceStatus?.ip || '0.0.0.0';
          data.relay_known = true;

          this.latestTelemetry = data;
          this.relayFeedbackKnown = [true, true, true, true];
          this.relayStateReceived = true;
          this.lastMainTelemetryAt = Date.now();
          this.latestRelayState = {
            relay1: data.relay[0] ? 'ON' : 'OFF',
            relay2: data.relay[1] ? 'ON' : 'OFF',
            relay3: data.relay[2] ? 'ON' : 'OFF',
            relay4: data.relay[3] ? 'ON' : 'OFF',
          };

          influxService.writeTelemetry(data);
          this.notifySubscribers('relay_state', this.latestRelayState);
          this.notifySubscribers('telemetry', data);
        }
        return;
      }

      // -------------------------------------------------------------------
      // 2. Sensor Individual (legacy — dari perangkat lain, bukan HydroController)
      //    Topic: {legacy_prefix}/sensor1..6
      //    Dipertahankan untuk backward compatibility.
      // -------------------------------------------------------------------
      if (/\/sensor[1-6]$/.test(topic) && this.lastMainTelemetryAt > 0 &&
          Date.now() - this.lastMainTelemetryAt <= this.feedbackTimeoutMs) {
        // Jangan campur pembacaan legacy ke snapshot controller utama yang masih hidup.
        return;
      }
      if (topic.endsWith('/sensor1') || topic.endsWith('/sensor2')) {
        const data = safeJsonParse<any>(raw);
        if (data) {
          const tele = this.ensureLatestTelemetry();
          if (data.temp !== undefined) tele.air_t = Number(data.temp);
          if (data.hum !== undefined) tele.air_rh = Number(data.hum);
          tele.timestamp = new Date().toISOString();
          tele.relay_known = false;
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
          tele.timestamp = new Date().toISOString();
          tele.relay_known = false;
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
          tele.timestamp = new Date().toISOString();
          tele.relay_known = false;
          influxService.writeTelemetry(tele);
          this.notifySubscribers('telemetry', tele);
        }
        return;
      }

      if (topic.endsWith('/sensor5')) {
        // Sensor Hujan (rain detector) — log saja
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
          tele.timestamp = new Date().toISOString();
          tele.relay_known = false;
          influxService.writeTelemetry(tele);
          this.notifySubscribers('telemetry', tele);
        }
        return;
      }

      // -------------------------------------------------------------------
      // 3. Relay Individual Channel State (legacy)
      //    Topic: {legacy_prefix}/relay/1/state ... /relay/4/state
      //    Firmware HydroController TIDAK publish ke topik ini.
      //    Dipertahankan untuk backward compatibility dengan perangkat lain.
      // -------------------------------------------------------------------
      const relayChannelMatch = topic.match(/\/relay\/([1-4])\/state$/);
      if (relayChannelMatch) {
        // State dari perangkat legacy tidak boleh menimpa empat relay controller utama.
        return;
      }

      // -------------------------------------------------------------------
      // 4. Relay Aggregate State (legacy)
      //    Topic: {legacy_prefix}/relay/state
      // -------------------------------------------------------------------
      if (topic.endsWith('/relay/state')) {
        // Prefix legacy tetap disubscribe untuk sensor, bukan sumber feedback relay utama.
        return;
      }

      // -------------------------------------------------------------------
      // 5. Status / LWT (Heartbeat & Controller LWT)
      //    Topic: {BASE}/status
      //
      //    Firmware publishHeartbeat() L969-979:
      //    {"status":"online","uptime_s":3600,"rssi":-42,"heap":240000,
      //     "bus_tx":5000,"bus_err":12,"bus_err_pct":0.24,"maint":0}
      //
      //    LWT (offline): {"status":"offline"}
      //
      //    Plain text "offline"/"online" dari perangkat legacy juga di-handle.
      // -------------------------------------------------------------------
      if (topic === `${env.MQTT_BASE_TOPIC}/status`) {
        const lower = raw.toLowerCase();

        // Plain text LWT (legacy)
        if (lower === 'offline' || lower === 'online') {
          if (retained && lower === 'online') return;
          logger.info(`[MQTT] Controller LWT Status -> ${lower} (Topic: ${topic})`);
          this.lastMainHeartbeatAt = lower === 'online' ? Date.now() : 0;
          if (this.latestDeviceStatus) {
            this.latestDeviceStatus.status = lower as 'online' | 'offline';
          } else {
            this.latestDeviceStatus = {
              status: lower as 'online' | 'offline',
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

        // JSON heartbeat (firmware format)
        const data = safeJsonParse<DeviceStatusPayload>(raw);
        if (data && typeof data === 'object') {
          if (retained && data.status === 'online') return;
          // Firmware tidak mengirim timestamp/ip — kita tambahkan
          if (!data.timestamp) {
            data.timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
          }
          this.latestDeviceStatus = data;
          this.lastMainHeartbeatAt = data.status === 'online' ? Date.now() : 0;
          influxService.writeHeartbeat(data);
          this.notifySubscribers('status', data);

          // Jika status = online setelah offline, notify subscribers
          if (data.status === 'online') {
            this.notifySubscribers('device_lwt', { status: 'online' });
          }
        }
        return;
      }

      // -------------------------------------------------------------------
      // 6. Alarms
      //    Topic: {BASE}/alarm
      //    Firmware publishAlarm() L893-904:
      //    {"code":"C01a","state":"active","level":"critical","ts":12345}
      // -------------------------------------------------------------------
      if (topic === `${env.MQTT_BASE_TOPIC}/alarm`) {
        const data = safeJsonParse<AlarmPayload>(raw);
        if (data) {
          const record = AlarmService.processAlarm(data);
          this.notifySubscribers('alarm', record);
        }
        return;
      }

      // -------------------------------------------------------------------
      // 7. Events
      //    Topic: {BASE}/event
      //    Firmware publishEvent() L884-891:
      //    {"kind":"relay","detail":"pompa_nutrisi","ts":12345}
      //    {"kind":"dose_start","detail":"","ts":12345}
      //    {"kind":"manual_on","detail":"misting","ts":12345}
      //    {"kind":"guard_trip","detail":"exhaust_fan","ts":12345,"buffered":true}
      // -------------------------------------------------------------------
      if (topic === `${env.MQTT_BASE_TOPIC}/event`) {
        const data = safeJsonParse<EventPayload>(raw);
        if (data) {
          sqliteRepo.insertSystemEvent({
            kind: data.kind,
            detail: data.detail,
            is_buffered: !!data.buffered,
            timestamp: new Date(data.ts > 1000000000000 ? data.ts : Date.now()).toISOString(),
          });

          // Tanggapi feedback event dari firmware secara reaktif
          const relayMap: Record<string, 1 | 2 | 3 | 4> = {
            pompa_nutrisi: 1,
            misting: 2,
            exhaust_fan: 3,
            lampu_grow: 4,
          };
          const ch = relayMap[data.detail];
          // Event yang tertunda atau hanya berjenis "relay" tidak memuat keadaan akhir.
          // Keduanya tidak boleh dipakai untuk menyimpulkan ON/OFF saat ini.
          if (!data.buffered && ch) {
            if (data.kind === 'relay' || data.kind === 'manual_expire') {
              this.relayFeedbackKnown[ch - 1] = false;
              this.relayStateReceived = this.relayFeedbackKnown.every(Boolean);
            } else if (data.kind === 'manual_on' || data.kind === 'dwin_manual_on') {
              this.updateRelayState(ch, 'ON');
            } else if (data.kind === 'manual_off' || data.kind === 'dwin_manual_off' ||
                       data.kind === 'manual_denied' || data.kind === 'dwin_manual_denied' ||
                       data.kind === 'guard_trip') {
              this.updateRelayState(ch, 'OFF');
            }
          } else if (!data.buffered && data.kind === 'manual_auto') {
            this.relayFeedbackKnown = [false, false, false, false];
            this.relayStateReceived = false;
          }

          this.notifySubscribers('event', data);
        }
        return;
      }
    } catch (err) {
      logger.error(`Error processing message on topic ${topic}:`, err);
    }
  }

  // =====================================================================
  //  Public API
  // =====================================================================

  public updateRelayState(channel: 1 | 2 | 3 | 4, action: 'ON' | 'OFF') {
    this.relayFeedbackKnown[channel - 1] = true;
    this.relayStateReceived = this.relayFeedbackKnown.every(Boolean);
    const key = `relay${channel}` as keyof RelayStatePayload;
    if (key in this.latestRelayState) {
      (this.latestRelayState as any)[key] = action;
    }
    if (this.relayStateReceived) {
      this.notifySubscribers('relay_state', this.latestRelayState);
    }
  }

  public isDeviceOnline(): boolean {
    return this.isConnected && this.latestDeviceStatus?.status === 'online' &&
      this.lastMainHeartbeatAt > 0 && Date.now() - this.lastMainHeartbeatAt <= this.feedbackTimeoutMs;
  }

  public isControllerReady(): boolean {
    return this.isDeviceOnline() && this.relayStateReceived &&
      this.lastMainTelemetryAt > 0 && Date.now() - this.lastMainTelemetryAt <= this.feedbackTimeoutMs;
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
      controllerReady: this.isControllerReady(),
      broker: `${env.MQTT_HOST}:${env.MQTT_PORT}`,
      client_id: env.MQTT_CLIENT_ID,
    };
  }
}

export const mqttService = new MqttService();
