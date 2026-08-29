export interface Telemetry {
  timestamp: string
  ip: string
  air_t: number | null
  air_rh: number | null
  lux: number | null
  ec: number | null
  tds: number | null
  ph: number | null
  water_t: number | null
  dist_mm: number | null
  level_pct: number | null
  relay: [number, number, number, number]
  relay_known?: boolean
}

export interface DeviceStatus {
  status: 'online' | 'offline'
  timestamp: string
  ip: string
  uptime_s: number
  rssi: number
  heap: number
  bus_tx: number
  bus_err: number
  bus_err_pct: number
  maint: number
}

export interface ChartPoint extends Telemetry { time: string }
export type RelayState = [boolean, boolean, boolean, boolean]

export interface AlarmRecord {
  id: number
  code: string
  level: 'critical' | 'warning'
  state: 'active' | 'clear'
  description: string
  triggered_at: string
  cleared_at?: string | null
}

export interface MqttStatus {
  connected: boolean
  broker: string
  client_id: string
}
