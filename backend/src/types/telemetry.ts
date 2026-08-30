// =====================================================================
//  telemetry.ts — Definisi tipe data & antarmuka payload IoT Hidroponik
//  Sinkron dengan Firmware ESP32-S3 HydroController
//
//  Referensi firmware:
//    publishTelemetry()  → HydroController.ino L936-967
//    publishHeartbeat()  → HydroController.ino L969-979
//    onMqtt()            → HydroController.ino L982-1029
//    publishAlarm()      → HydroController.ino L893-904
//    publishEvent()      → HydroController.ino L884-891
// =====================================================================

/**
 * Payload telemetri agregat dari firmware.
 * Topic: {MQTT_BASE}/telemetry
 *
 * Firmware TIDAK mengirim `timestamp` dan `ip` — field ini di-set oleh backend.
 * Field `dose_state`, `dose_count`, `manual`, `lock`, `alarm_n`, `alarms`
 * ditambahkan langsung oleh firmware.
 */
export interface TelemetryPayload {
  // Di-set oleh backend, bukan firmware
  timestamp?: string;
  ip?: string;

  // Sensor readings (null = sensor offline/invalid)
  air_t: number | null;
  air_rh: number | null;
  lux: number | null;
  ec: number | null;
  tds: number | null;
  ph: number | null;
  water_t: number | null;
  dist_mm: number | null;
  level_pct: number | null;

  // Relay state array: [pompa_nutrisi, misting, exhaust_fan, lampu_grow] (0/1)
  relay: [number, number, number, number];
  relay_known?: boolean; // true hanya setelah feedback relay/telemetry aktual diterima

  // Dosing state machine (dari firmware)
  dose_state?: 'idle' | 'dosing' | 'mixing' | 'locked' | string;
  dose_count?: number;

  // Manual override state array: [pompa_nutrisi, misting, exhaust_fan, lampu_grow] (0/1)
  manual?: [number, number, number, number];

  // Lock reason (non-empty saat dose_state == 'locked')
  lock?: string;

  // Active alarm summary
  alarm_n?: number;
  alarms?: string; // comma-separated alarm codes, e.g. "C01a,W02"
}

/**
 * Payload heartbeat/status dari firmware.
 * Topic: {MQTT_BASE}/status (retained)
 *
 * LWT payload saat offline: {"status":"offline"}
 * Firmware TIDAK mengirim `ip` dan `timestamp`.
 */
export interface DeviceStatusPayload {
  status: 'online' | 'offline';
  timestamp?: string;  // di-set oleh backend
  ip?: string;         // di-set oleh backend
  uptime_s: number;
  rssi: number;
  heap: number;
  bus_tx: number;
  bus_err: number;
  bus_err_pct: number;
  maint: number; // 0 = normal, 1 = maintenance mode
}

export interface RelayStatePayload {
  relay1: 'ON' | 'OFF';
  relay2: 'ON' | 'OFF';
  relay3: 'ON' | 'OFF';
  relay4: 'ON' | 'OFF';
  rssi?: number;
}

/**
 * Payload alarm dari firmware.
 * Topic: {MQTT_BASE}/alarm
 */
export interface AlarmPayload {
  code: string;        // e.g. "C01a", "W02", "C09"
  state: 'active' | 'clear';
  level: 'critical' | 'warning';
  ts: number;          // millis() — bukan epoch
}

/**
 * Payload event dari firmware.
 * Topic: {MQTT_BASE}/event
 */
export interface EventPayload {
  kind: 'boot' | 'relay' | 'guard_trip' | 'reset' | 'maint' | 'alarm'
      | 'dose_start' | 'dose_end' | 'dose_lock'
      | 'manual_on' | 'manual_off' | 'manual_denied' | 'manual_expire' | 'manual_auto'
      | 'dwin_manual_on' | 'dwin_manual_off' | 'dwin_manual_denied'
      | string;
  detail: string;
  ts: number;          // millis()
  buffered?: boolean;  // true jika event tertunda dari ring buffer offline
}

export type RelayChannel = 1 | 2 | 3 | 4;

/**
 * Aksi relay yang dikirim ke firmware.
 * Firmware hanya mengerti ON/OFF (via "r{ch}on"/"r{ch}off" pada topik cmd).
 */
export type RelayAction = 'ON' | 'OFF';

/**
 * Perintah sistem yang dikenali firmware (onMqtt callback).
 * Semua lowercase — firmware membandingkan dengan strcmp().
 */
export type SystemCommand = 'reset' | 'maint_on' | 'maint_off' | 'auto';

export interface RelayLogRecord {
  id?: number;
  channel: number;
  relay_name: string;
  action: string;
  source: 'web' | 'mqtt_sync' | 'guard_trip';
  timestamp: string;
}

export interface AlarmLogRecord {
  id?: number;
  code: string;
  level: 'critical' | 'warning';
  state: 'active' | 'clear';
  description: string;
  triggered_at: string;
  cleared_at?: string | null;
}

export interface SystemEventRecord {
  id?: number;
  kind: string;
  detail: string;
  is_buffered: boolean;
  timestamp: string;
}
