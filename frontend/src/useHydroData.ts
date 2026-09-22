import { useCallback, useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import type { AlarmRecord, AuthUser, ChartPoint, DeviceStatus, MqttStatus, RelayState, Telemetry } from './types'

function getApiUrl(): string {
  const envUrl = (import.meta.env.VITE_API_URL || '').replace(/^["']+|["']+$/g, '').trim()
  if (envUrl && envUrl.startsWith('http')) {
    return envUrl
  }
  return ''
}

const API = getApiUrl()
const EMPTY_RELAYS: RelayState = [false, false, false, false]
type RelayCommand = 'ON' | 'OFF'
type PendingRelays = [RelayCommand | null, RelayCommand | null, RelayCommand | null, RelayCommand | null]

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

function parseDate(input?: string): Date {
  if (!input) return new Date(NaN)
  if (input.includes('T') || input.endsWith('Z')) return new Date(input)
  return new Date(`${input.replace(' ', 'T')}Z`)
}

function toChartPoint(item: Partial<Telemetry> & { timestamp?: string }): ChartPoint {
  const ts = item.timestamp || new Date().toISOString()
  const date = parseDate(ts)
  const time = Number.isNaN(date.getTime())
    ? '--:--'
    : date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })

  return {
    timestamp: ts,
    time,
    ip: item.ip || '0.0.0.0',
    air_t: item.air_t ?? null,
    air_rh: item.air_rh ?? null,
    lux: item.lux ?? null,
    ec: item.ec ?? null,
    tds: item.tds ?? null,
    ph: item.ph ?? null,
    water_t: item.water_t ?? null,
    dist_mm: item.dist_mm ?? null,
    level_pct: item.level_pct ?? null,
    relay: item.relay ?? [0, 0, 0, 0],
    relay_known: item.relay_known ?? false,
  }
}

function normalizeHistory(raw: unknown): ChartPoint[] {
  if (!Array.isArray(raw)) return []

  const rows = raw as HistoryRow[]
  if (rows.length === 0) return []

  let normalized: ChartPoint[] = []
  if ('_field' in rows[0]) {
    const grouped = new Map<string, Partial<Telemetry>>()
    for (const row of rows) {
      if (!row._time || !row._field) continue
      const bucket = grouped.get(row._time) || { timestamp: row._time }
      if (row._value !== undefined && row._value !== null) {
        ;(bucket as Record<string, unknown>)[row._field] = row._value
      }
      grouped.set(row._time, bucket)
    }
    normalized = Array.from(grouped.values()).map(toChartPoint)
  } else {
    normalized = rows.map(toChartPoint)
  }

  return normalized
    .filter(point => point.timestamp)
    .sort((a, b) => parseDate(a.timestamp).getTime() - parseDate(b.timestamp).getTime())
    .slice(-720)
}

async function getJson<T>(path: string, signal?: AbortSignal, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const response = await fetch(`${API}${path}`, { signal, headers })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json() as Promise<T>
}

export function useHydroData() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem('hydra_auth_token')
    } catch {
      return null
    }
  })
  const [authLoading, setAuthLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  const [telemetry, setTelemetry] = useState<Telemetry | null>(null)
  const [status, setStatus] = useState<DeviceStatus | null>(null)
  const [mqtt, setMqtt] = useState<MqttStatus | null>(null)
  const [history, setHistory] = useState<ChartPoint[]>([])
  const [alarms, setAlarms] = useState<AlarmRecord[]>([])
  const [relays, setRelays] = useState<RelayState>(EMPTY_RELAYS)
  const [relayKnown, setRelayKnown] = useState(false)
  const [pendingRelays, setPendingRelays] = useState<PendingRelays>([null, null, null, null])
  const [controllerReady, setControllerReady] = useState(false)
  const [socketConnected, setSocketConnected] = useState(false)
  const [backendAvailable, setBackendAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyRange, setHistoryRange] = useState<HistoryRange>('24h')
  const historyRangeRef = useRef<HistoryRange>('24h')
  const [notice, setNotice] = useState('')
  const confirmedRelaysRef = useRef<RelayState>(EMPTY_RELAYS)
  const pendingRef = useRef<PendingRelays>([null, null, null, null])
  const pendingTimersRef = useRef<Array<number | null>>([null, null, null, null])
  const hasSocketFeedbackRef = useRef(false)
  const hasSocketStatusRef = useRef(false)

  const finishPending = useCallback((index: number, outcome: 'confirmed' | 'rejected' | 'timeout' | 'failed' | 'disconnected') => {
    const action = pendingRef.current[index]
    if (!action) return
    pendingRef.current[index] = null
    const timer = pendingTimersRef.current[index]
    if (timer !== null) window.clearTimeout(timer)
    pendingTimersRef.current[index] = null
    setPendingRelays([...pendingRef.current] as PendingRelays)

    const channel = index + 1
    if (outcome === 'confirmed') setNotice(`Feedback perangkat menunjukkan Relay ${channel} ${action}.`)
    if (outcome === 'rejected') setNotice(`Perangkat menolak perintah Relay ${channel}. Periksa pengaman alat.`)
    if (outcome === 'timeout') setNotice(`Belum ada konfirmasi Relay ${channel}. Periksa kondisi fisik sebelum mencoba lagi.`)
    if (outcome === 'failed') setNotice(`Perintah Relay ${channel} gagal dikirim. Tidak ada perubahan status yang diasumsikan.`)
    if (outcome === 'disconnected') setNotice(`Koneksi terputus; perintah Relay ${channel} belum terverifikasi.`)
  }, [])

  const acceptRelayFeedback = useCallback((next: RelayState) => {
    confirmedRelaysRef.current = next
    setRelays(next)
    setRelayKnown(true)
    next.forEach((isOn, index) => {
      const pending = pendingRef.current[index]
      if (pending && (pending === 'ON') === isOn) finishPending(index, 'confirmed')
    })
  }, [finishPending])

  const acceptRelayChannel = useCallback((index: number, isOn: boolean) => {
    const next = [...confirmedRelaysRef.current] as RelayState
    next[index] = isOn
    confirmedRelaysRef.current = next
    setRelays(next)
    const pending = pendingRef.current[index]
    if (pending && (pending === 'ON') === isOn) finishPending(index, 'confirmed')
  }, [finishPending])

  useEffect(() => () => {
    pendingTimersRef.current.forEach(timer => {
      if (timer !== null) window.clearTimeout(timer)
    })
  }, [])

  useEffect(() => {
    historyRangeRef.current = historyRange
  }, [historyRange])

  const ingest = useCallback((data: Telemetry) => {
    setTelemetry(data)
    if (data.relay_known === true && Array.isArray(data.relay) && data.relay.length === 4) {
      hasSocketFeedbackRef.current = true
      acceptRelayFeedback(data.relay.map(Boolean) as RelayState)
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
  }, [acceptRelayFeedback])

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
        if (!hasSocketStatusRef.current) setStatus(healthResult.value.data.device)
        setMqtt(healthResult.value.data.mqtt)
      }
      if (!hasSocketFeedbackRef.current && relayResult.status === 'fulfilled' && relayResult.value.known && relayResult.value.data) {
        const value = relayResult.value.data
        acceptRelayFeedback([1, 2, 3, 4].map(index => value[`relay${index}`] === 'ON') as RelayState)
      }
      if (alarmResult.status === 'fulfilled') setAlarms(alarmResult.value.data || [])
      setLoading(false)
    })

    const socket = API
      ? io(API, { path: '/socket.io', transports: ['websocket', 'polling'], timeout: 5000, reconnectionDelay: 2000 })
      : io({ path: '/socket.io', transports: ['websocket', 'polling'], timeout: 5000, reconnectionDelay: 2000 })
    socket.on('connect', () => { setSocketConnected(true); setBackendAvailable(true) })
    socket.on('disconnect', () => {
      setSocketConnected(false)
      setControllerReady(false)
      pendingRef.current.forEach((pending, index) => {
        if (pending) finishPending(index, 'disconnected')
      })
    })
    socket.on('connect_error', () => { setSocketConnected(false); setControllerReady(false) })
    socket.on('telemetry:live', ingest)
    socket.on('status:live', (value: DeviceStatus) => {
      hasSocketStatusRef.current = true
      setStatus(value)
      if (value.status === 'offline') {
        setControllerReady(false)
        pendingRef.current.forEach((pending, index) => {
          if (pending) finishPending(index, 'disconnected')
        })
      }
    })
    socket.on('controller:ready', (ready: boolean) => setControllerReady(ready))
    socket.on('device:lwt', (value: { status: 'online' | 'offline' }) => {
      if (value.status === 'offline') {
        hasSocketStatusRef.current = true
        setStatus(previous => previous ? { ...previous, status: 'offline' } : null)
        setControllerReady(false)
        pendingRef.current.forEach((pending, index) => {
          if (pending) finishPending(index, 'disconnected')
        })
      }
    })
    socket.on('relay:state', (value: Record<string, string>) => {
      hasSocketFeedbackRef.current = true
      acceptRelayFeedback([1, 2, 3, 4].map(index => value[`relay${index}`] === 'ON') as RelayState)
    })
    socket.on('event:new', (event: { kind: string; detail: string; buffered?: boolean }) => {
      if (event.buffered) return
      const relayNameMap: Record<string, number> = {
        pompa_nutrisi: 0,
        misting: 1,
        exhaust_fan: 2,
        lampu_grow: 3,
      }
      const chIndex = relayNameMap[event.detail]
      if (chIndex !== undefined) {
        if (event.kind === 'manual_on' || event.kind === 'dwin_manual_on') {
          acceptRelayChannel(chIndex, true)
        } else if (event.kind === 'manual_off' || event.kind === 'dwin_manual_off' ||
                   event.kind === 'guard_trip' || event.kind === 'manual_denied' ||
                   event.kind === 'dwin_manual_denied') {
          const rejected = event.kind === 'manual_denied' || event.kind === 'dwin_manual_denied' ||
            event.kind === 'guard_trip'
          if (rejected) finishPending(chIndex, 'rejected')
          acceptRelayChannel(chIndex, false)
          if (event.kind === 'guard_trip') setNotice(`Pengaman mematikan ${event.detail}. Periksa alat sebelum menyalakan kembali.`)
          if (event.kind === 'manual_denied' || event.kind === 'dwin_manual_denied') {
            setNotice(`Perangkat menolak aktivasi ${event.detail} (Safety Lock aktif).`)
          }
        }
      }
    })
    socket.on('alarm:new', (value: AlarmRecord) => {
      setAlarms(items => [value, ...items].slice(0, 8))
    })

    return () => { active = false; socket.disconnect() }
  }, [acceptRelayChannel, acceptRelayFeedback, finishPending, ingest])

  // Verify existing token on initial load
  useEffect(() => {
    let active = true
    async function verifyAuth() {
      const savedToken = localStorage.getItem('hydra_auth_token')
      if (!savedToken) {
        if (active) {
          setAuthLoading(false)
          setIsAuthenticated(false)
        }
        return
      }

      try {
        const res = await fetch(`${API}/api/v1/auth/me`, {
          headers: { Authorization: `Bearer ${savedToken}` },
        })
        if (res.ok) {
          const data = await res.json()
          if (active) {
            setUser(data.user)
            setToken(savedToken)
            setIsAuthenticated(true)
          }
        } else {
          localStorage.removeItem('hydra_auth_token')
          if (active) {
            setToken(null)
            setUser(null)
            setIsAuthenticated(false)
          }
        }
      } catch {
        if (active) {
          setToken(savedToken)
          setIsAuthenticated(true)
        }
      } finally {
        if (active) setAuthLoading(false)
      }
    }

    verifyAuth()
    return () => { active = false }
  }, [])

  const login = useCallback(async (username: string, password: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Username atau kata sandi salah.')
      }

      localStorage.setItem('hydra_auth_token', data.token)
      setToken(data.token)
      setUser(data.user)
      setIsAuthenticated(true)
      setNotice(`Selamat datang, ${data.user.displayName || data.user.username}!`)
      return true
    } catch (err: any) {
      throw new Error(err.message || 'Gagal terhubung ke backend server.')
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      if (token) {
        await fetch(`${API}/api/v1/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
      }
    } catch {
      // Ignore network errors on logout
    } finally {
      localStorage.removeItem('hydra_auth_token')
      setToken(null)
      setUser(null)
      setIsAuthenticated(false)
      setNotice('Anda telah keluar dari sistem.')
    }
  }, [token])

  const toggleRelay = useCallback(async (index: number) => {
    if (index < 0 || index > 3 || pendingRef.current[index]) return
    if (!controllerReady || !socketConnected || !backendAvailable || status?.status !== 'online' || !relayKnown) {
      setNotice('Kontrol terkunci karena feedback langsung dari perangkat belum tersedia.')
      return
    }
    const action: RelayCommand = confirmedRelaysRef.current[index] ? 'OFF' : 'ON'
    pendingRef.current[index] = action
    setPendingRelays([...pendingRef.current] as PendingRelays)
    pendingTimersRef.current[index] = window.setTimeout(() => finishPending(index, 'timeout'), 12_000)

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`

      const response = await fetch(`${API}/api/v1/relays/${index + 1}/command`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action }),
      })
      if (!response.ok) throw new Error()
      if (pendingRef.current[index]) setNotice(`Perintah ${action} dikirim; menunggu feedback Relay ${index + 1}.`)
    } catch {
      finishPending(index, 'failed')
    }
  }, [backendAvailable, controllerReady, finishPending, relayKnown, socketConnected, status?.status, token])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 3500)
    return () => window.clearTimeout(timer)
  }, [notice])

  return {
    user, token, authLoading, isAuthenticated, login, logout,
    telemetry, status, mqtt, history, alarms, relays, relayKnown, pendingRelays, controllerReady, socketConnected,
    backendAvailable, loading, historyLoading, historyRange, setHistoryRange,
    toggleRelay, notice,
  }
}
