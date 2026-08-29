import { useCallback, useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import type { AlarmRecord, ChartPoint, DeviceStatus, MqttStatus, RelayState, Telemetry } from './types'

const API = import.meta.env.VITE_API_URL || ''
const EMPTY_RELAYS: RelayState = [false, false, false, false]

export type HistoryRange = '1h' | '24h' | '30d'

const HISTORY_QUERY: Record<HistoryRange, {
  range: string
  interval: string
  rangeMs: number
  intervalMs: number
}> = {
  '1h': { range: '-1h', interval: '1m', rangeMs: 60 * 60_000, intervalMs: 60_000 },
  '24h': { range: '-24h', interval: '5m', rangeMs: 24 * 60 * 60_000, intervalMs: 5 * 60_000 },
  '30d': { range: '-30d', interval: '1h', rangeMs: 30 * 24 * 60 * 60_000, intervalMs: 60 * 60_000 },
}

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
    .slice(-720)
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API}${path}`, { signal })
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
  const [relayKnown, setRelayKnown] = useState(false)
  const [socketConnected, setSocketConnected] = useState(false)
  const [backendAvailable, setBackendAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyRange, setHistoryRange] = useState<HistoryRange>('24h')
  const historyRangeRef = useRef<HistoryRange>('24h')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    historyRangeRef.current = historyRange
  }, [historyRange])

  const ingest = useCallback((data: Telemetry) => {
    setTelemetry(data)
    if (data.relay_known === true && Array.isArray(data.relay) && data.relay.length === 4) {
      setRelays(data.relay.map(Boolean) as RelayState)
      setRelayKnown(true)
    }
    setHistory(items => {
      const preset = HISTORY_QUERY[historyRangeRef.current]
      const point = toChartPoint(data)
      const pointTime = parseDate(point.timestamp).getTime()
      if (!Number.isFinite(pointTime)) return items

      const cutoff = Date.now() - preset.rangeMs
      const visibleItems = items.filter(item => parseDate(item.timestamp).getTime() >= cutoff)
      if (pointTime < cutoff) return visibleItems

      const pointBucket = Math.floor(pointTime / preset.intervalMs)
      const lastPoint = visibleItems.at(-1)
      const lastBucket = lastPoint
        ? Math.floor(parseDate(lastPoint.timestamp).getTime() / preset.intervalMs)
        : null

      if (lastPoint && lastBucket === pointBucket) {
        return [...visibleItems.slice(0, -1), { ...lastPoint, ...point, timestamp: lastPoint.timestamp }]
      }

      return [...visibleItems, point].slice(-720)
    })
  }, [])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const query = HISTORY_QUERY[historyRange]
    setHistoryLoading(true)
    setHistory([])

    getJson<{ data: HistoryRow[] }>(
      `/api/v1/telemetry/history?range=${query.range}&interval=${query.interval}`,
      controller.signal,
    )
      .then(result => {
        if (!active) return
        setHistory(normalizeHistory(result.data || []))
        setBackendAvailable(true)
      })
      .catch(error => {
        if (!active) return
        if (error instanceof Error && error.name === 'AbortError') return
        setHistory([])
      })
      .finally(() => {
        if (active) setHistoryLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [historyRange])

  useEffect(() => {
    let active = true

    Promise.allSettled([
      getJson<{ data: Telemetry | null }>('/api/v1/telemetry/latest'),
      getJson<{ data: { device: DeviceStatus | null; mqtt: MqttStatus } }>('/api/v1/diagnostics/health'),
      getJson<{ data: Record<string, string> | null; known: boolean }>('/api/v1/relays/state'),
      getJson<{ data: AlarmRecord[] }>('/api/v1/alarms?limit=8'),
    ]).then(results => {
      if (!active) return
      const [latestResult, healthResult, relayResult, alarmResult] = results
      const successful = results.some(result => result.status === 'fulfilled')
      setBackendAvailable(successful)

      if (latestResult.status === 'fulfilled' && latestResult.value.data) setTelemetry(latestResult.value.data)
      if (healthResult.status === 'fulfilled') {
        setStatus(healthResult.value.data.device)
        setMqtt(healthResult.value.data.mqtt)
      }
      if (relayResult.status === 'fulfilled' && relayResult.value.known && relayResult.value.data) {
        const value = relayResult.value.data
        setRelays([1, 2, 3, 4].map(index => value[`relay${index}`] === 'ON') as RelayState)
        setRelayKnown(true)
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
      setRelayKnown(true)
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
      setNotice(`Perintah ${action} dikirim. Menunggu konfirmasi perangkat.`)
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
    telemetry, status, mqtt, history, alarms, relays, relayKnown, socketConnected,
    backendAvailable, loading, historyLoading, historyRange, setHistoryRange,
    toggleRelay, notice,
  }
}
