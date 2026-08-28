// =====================================================================
//  telemetry.ts — Definisi tipe data & antarmuka payload IoT Hidroponik
//  Sinkron dengan Firmware ESP32-S3 HydroController
// =====================================================================

export interface TelemetryPayload {
  timestamp: string;
  ip: string;
  air_t: number | null;
  air_rh: number | null;
  lux: number | null;
  ec: number | null;
  tds: number | null;
  ph: number | null;
  water_t: number | null;
  dist_mm: number | null;
  level_pct: number | null;
  relay: [number, number, number, number]; // [pompa_nutrisi, misting, exhaust_fan, lampu_grow] (0/1)
}

export interface DeviceStatusPayload {
  status: 'online' | 'offline';
  timestamp: string;
  ip: string;
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

export interface AlarmPayload {
  code: string;
  state: 'active' | 'clear';
  level: 'critical' | 'warning';
  ts: number;
}

export interface EventPayload {
  kind: 'boot' | 'relay' | 'guard_trip' | 'reset' | 'maint' | 'alarm' | string;
  detail: string;
  ts: number;
  buffered?: boolean;
}

export type RelayChannel = 1 | 2 | 3 | 4;
export type RelayAction = 'ON' | 'OFF' | 'TOGGLE';

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
