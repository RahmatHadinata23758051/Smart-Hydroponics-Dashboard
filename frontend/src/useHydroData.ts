import { useCallback, useEffect, useState } from 'react'
import { io } from 'socket.io-client'
import type { AlarmRecord, ChartPoint, DeviceStatus, MqttStatus, RelayState, Telemetry } from './types'

const API = import.meta.env.VITE_API_URL || ''
const EMPTY_RELAYS: RelayState = [false, false, false, false]

type HistoryRow = Partial<Telemetry> & {
  _field?: keyof Telemetry
  _value?: number
  _time?: string
  relay1?: number
  relay2?: number
  relay3?: number
  relay4?: number
}

function parseDate(value?: string) {
  if (!value) return new Date(0)
  return new Date(value.includes('T') ? value : value.replace(' ', 'T'))
}

function toChartPoint(row: HistoryRow): ChartPoint {
  const timestamp = row.timestamp || row._time || ''
  const time = parseDate(timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
  return {
    timestamp,
    time,
    ip: row.ip || '',
    air_t: row.air_t ?? null,
    air_rh: row.air_rh ?? null,
    lux: row.lux ?? null,
    ec: row.ec ?? null,
    tds: row.tds ?? null,
    ph: row.ph ?? null,
    water_t: row.water_t ?? null,
    dist_mm: row.dist_mm ?? null,
    level_pct: row.level_pct ?? null,
    relay: [row.relay1 ?? 0, row.relay2 ?? 0, row.relay3 ?? 0, row.relay4 ?? 0],
  }
}

function normalizeHistory(rows: HistoryRow[]): ChartPoint[] {
  if (!rows.length) return []

  let normalized: ChartPoint[]
  if (rows.some(row => row._field && row._time)) {
    const points = new Map<string, HistoryRow>()
    for (const row of rows) {
      if (!row._time || !row._field) continue
      const point = points.get(row._time) || { timestamp: row._time }
      ;(point as Record<string, unknown>)[row._field] = row._value ?? null
      points.set(row._time, point)
    }
    normalized = [...points.values()].map(toChartPoint)
  } else {
    normalized = rows.map(toChartPoint)
  }

  return normalized
    .filter(point => point.timestamp)
    .sort((a, b) => parseDate(a.timestamp).getTime() - parseDate(b.timestamp).getTime())
    .slice(-120)
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json() as Promise<T>
}

export function useHydroData() {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null)
  const [status, setStatus] = useState<DeviceStatus | null>(null)
  const [mqtt, setMqtt] = useState<MqttStatus | null>(null)
  const [history, setHistory] = useState<ChartPoint[]>([])
  const [alarms, setAlarms] = useState<AlarmRecord[]>([])
  const [relays, setRelays] = useState<RelayState>(EMPTY_RELAYS)
  const [socketConnected, setSocketConnected] = useState(false)
  const [backendAvailable, setBackendAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')

  const ingest = useCallback((data: Telemetry) => {
    setTelemetry(data)
    if (Array.isArray(data.relay) && data.relay.length === 4) {
      setRelays(data.relay.map(Boolean) as RelayState)
    }
    setHistory(items => {
      const point = toChartPoint(data)
      if (items.at(-1)?.timestamp === point.timestamp) return items
      return [...items.slice(-119), point]
    })
  }, [])

  useEffect(() => {
    let active = true

    Promise.allSettled([
      getJson<{ data: Telemetry | null }>('/api/v1/telemetry/latest'),
      getJson<{ data: HistoryRow[] }>('/api/v1/telemetry/history?range=-24h&interval=5m'),
      getJson<{ data: { device: DeviceStatus | null; mqtt: MqttStatus } }>('/api/v1/diagnostics/health'),
      getJson<{ data: Record<string, string> }>('/api/v1/relays/state'),
      getJson<{ data: AlarmRecord[] }>('/api/v1/alarms?limit=8'),
    ]).then(results => {
      if (!active) return
      const [latestResult, historyResult, healthResult, relayResult, alarmResult] = results
      const successful = results.some(result => result.status === 'fulfilled')
      setBackendAvailable(successful)

      if (historyResult.status === 'fulfilled') setHistory(normalizeHistory(historyResult.value.data || []))
      if (latestResult.status === 'fulfilled' && latestResult.value.data) setTelemetry(latestResult.value.data)
      if (healthResult.status === 'fulfilled') {
        setStatus(healthResult.value.data.device)
        setMqtt(healthResult.value.data.mqtt)
      }
      if (relayResult.status === 'fulfilled' && relayResult.value.data) {
        const value = relayResult.value.data
        setRelays([1, 2, 3, 4].map(index => value[`relay${index}`] === 'ON') as RelayState)
      }
      if (alarmResult.status === 'fulfilled') setAlarms(alarmResult.value.data || [])
      setLoading(false)
    })

    const socket = io(API || window.location.origin, {
      transports: ['websocket'], timeout: 3000, reconnectionDelay: 3000,
    })
    socket.on('connect', () => { setSocketConnected(true); setBackendAvailable(true) })
    socket.on('disconnect', () => setSocketConnected(false))
    socket.on('connect_error', () => setSocketConnected(false))
    socket.on('telemetry:live', ingest)
    socket.on('status:live', (value: DeviceStatus) => setStatus(value))
    socket.on('device:lwt', (value: string) => {
      if (value === 'offline') setStatus(previous => previous ? { ...previous, status: 'offline' } : null)
    })
    socket.on('relay:state', (value: Record<string, string>) => {
      setRelays([1, 2, 3, 4].map(index => value[`relay${index}`] === 'ON') as RelayState)
    })
    socket.on('alarm:new', (value: AlarmRecord) => {
      setAlarms(items => [value, ...items].slice(0, 8))
    })

    return () => { active = false; socket.disconnect() }
  }, [ingest])

  const toggleRelay = useCallback(async (index: number) => {
    const action = relays[index] ? 'OFF' : 'ON'
    try {
      const response = await fetch(`${API}/api/v1/relays/${index + 1}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!response.ok) throw new Error()
      setNotice(`Perintah ${action} dikirim · menunggu konfirmasi perangkat`)
    } catch {
      setNotice('Perintah gagal dikirim. Backend atau broker MQTT tidak tersedia.')
    }
  }, [relays])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 3500)
    return () => window.clearTimeout(timer)
  }, [notice])

  return {
    telemetry, status, mqtt, history, alarms, relays, socketConnected,
    backendAvailable, loading, toggleRelay, notice,
  }
}
