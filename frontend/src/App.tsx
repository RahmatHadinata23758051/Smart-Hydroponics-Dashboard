import { useMemo, useState, type ComponentType } from 'react'
import {
  Activity, AlertTriangle, Antenna, BarChart3, BellRing, CircuitBoard,
  Droplets, FlaskConical, Gauge, LayoutDashboard, Lightbulb, Menu, Power,
  Radio, Server, Sprout, Thermometer, Waves, Wifi, Wind, X, Zap,
} from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useHydroData } from './useHydroData'
import type { ChartPoint, Telemetry } from './types'

type Icon = ComponentType<{ size?: number; strokeWidth?: number }>
type SensorKey = 'ec' | 'tds' | 'ph' | 'water_t' | 'air_t' | 'air_rh' | 'lux' | 'level_pct'

const navItems: { label: string; target: string; icon: Icon }[] = [
  { label: 'Ringkasan', target: 'ringkasan', icon: LayoutDashboard },
  { label: 'Tren sensor', target: 'tren-sensor', icon: BarChart3 },
  { label: 'Tandon', target: 'tandon', icon: Waves },
  { label: 'Aktuator', target: 'aktuator', icon: Zap },
  { label: 'Diagnostik', target: 'diagnostik', icon: CircuitBoard },
]

const sensorDefinitions: { key: SensorKey; label: string; shortLabel: string; unit: string; color: string; icon: Icon; domain: [number | 'auto', number | 'auto']; ideal: string }[] = [
  { key: 'ec', label: 'EC nutrisi', shortLabel: 'EC', unit: 'µS/cm', color: '#b9ff43', icon: Activity, domain: [0, 3000], ideal: 'Ideal 1.500–2.000' },
  { key: 'tds', label: 'Total zat terlarut', shortLabel: 'TDS', unit: 'ppm', color: '#ffcf4a', icon: FlaskConical, domain: [0, 1500], ideal: 'Ideal 750–1.000' },
  { key: 'ph', label: 'Keasaman larutan', shortLabel: 'pH', unit: 'pH', color: '#4ff0c8', icon: FlaskConical, domain: [3, 11], ideal: 'Ideal 5,5–6,8' },
  { key: 'water_t', label: 'Suhu larutan', shortLabel: 'Air', unit: '°C', color: '#40c9ff', icon: Thermometer, domain: [15, 35], ideal: 'Ideal 20–28°C' },
  { key: 'air_t', label: 'Suhu greenhouse', shortLabel: 'Udara', unit: '°C', color: '#ff875c', icon: Thermometer, domain: [20, 40], ideal: 'Ideal 24–30°C' },
  { key: 'air_rh', label: 'Kelembapan udara', shortLabel: 'RH', unit: '%', color: '#5ea6ff', icon: Droplets, domain: [0, 100], ideal: 'Ideal 60–80%' },
  { key: 'lux', label: 'Intensitas cahaya', shortLabel: 'Cahaya', unit: 'lux', color: '#ffe66b', icon: Lightbulb, domain: [0, 'auto'], ideal: 'Sensor lux RS-485' },
  { key: 'level_pct', label: 'Level tandon', shortLabel: 'Level', unit: '%', color: '#9e7bff', icon: Gauge, domain: [0, 100], ideal: 'Aman di atas 30%' },
]

const relayItems = [
  { name: 'Pompa nutrisi', note: 'Auto-cutoff 5 detik', icon: Waves },
  { name: 'Misting', note: 'Auto-cutoff 30 detik', icon: Droplets },
  { name: 'Exhaust fan', note: 'Auto-cutoff 10 menit', icon: Wind },
  { name: 'Grow light', note: 'Kontrol manual', icon: Lightbulb },
]

function parseTime(value?: string) {
  if (!value) return null
  const parsed = new Date(value.includes('T') ? value : value.replace(' ', 'T'))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatValue(value: number | null | undefined, key: SensorKey) {
  if (value === null || value === undefined) return '—'
  if (key === 'lux' || key === 'ec' || key === 'tds') return value.toLocaleString('id-ID', { maximumFractionDigits: 0 })
  return value.toLocaleString('id-ID', { minimumFractionDigits: key === 'ph' ? 2 : 1, maximumFractionDigits: key === 'ph' ? 2 : 1 })
}

function getSensorState(key: SensorKey, value: number | null | undefined) {
  if (value === null || value === undefined) return { label: 'Data belum tersedia', state: 'missing' }
  const checks: Record<SensorKey, boolean> = {
    ec: value >= 1500 && value <= 2000,
    tds: value >= 750 && value <= 1000,
    ph: value >= 5.5 && value <= 6.8,
    water_t: value >= 20 && value <= 28,
    air_t: value >= 24 && value <= 30,
    air_rh: value >= 60 && value <= 80,
    lux: value > 0,
    level_pct: value >= 30,
  }
  return checks[key] ? { label: 'Dalam rentang', state: 'good' } : { label: 'Di luar rentang', state: 'warn' }
}

function formatUptime(seconds?: number) {
  if (seconds === undefined) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return days > 0 ? `${days}h ${hours}j` : `${hours}j ${minutes}m`
}

function Sidebar({ open, close, backendOnline, mqttOnline }: { open: boolean; close: () => void; backendOnline: boolean; mqttOnline: boolean }) {
  return (
    <>
      <button className={`sidebar-scrim ${open ? 'is-open' : ''}`} onClick={close} aria-label="Tutup navigasi" />
      <aside className={`sidebar ${open ? 'is-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><Sprout size={23} strokeWidth={2.5} /></div>
          <div><strong>HYDRA</strong><span>MONITORING SYSTEM</span></div>
          <button className="mobile-close" onClick={close} aria-label="Tutup menu"><X size={20} /></button>
        </div>

        <nav className="nav" aria-label="Navigasi dashboard">
          <p className="nav-eyebrow">Dashboard</p>
          {navItems.map(({ label, target, icon: NavIcon }, index) => (
            <a className={`nav-item ${index === 0 ? 'active' : ''}`} href={`#${target}`} key={target} onClick={close}>
              <NavIcon size={19} strokeWidth={1.8} /><span>{label}</span>
            </a>
          ))}
        </nav>

        <div className="sidebar-health">
          <p>Jalur data</p>
          <div><span><Server size={15} />Backend API</span><b className={backendOnline ? 'online' : 'offline'}>{backendOnline ? 'Terhubung' : 'Terputus'}</b></div>
          <div><span><Radio size={15} />Broker MQTT</span><b className={mqttOnline ? 'online' : 'offline'}>{mqttOnline ? 'Terhubung' : 'Terputus'}</b></div>
        </div>
        <div className="sidebar-foot"><CircuitBoard size={16} /><span>ESP32-S3 · RS-485</span></div>
      </aside>
    </>
  )
}

function MetricCard({ definition, value }: { definition: typeof sensorDefinitions[number]; value: number | null | undefined }) {
  const state = getSensorState(definition.key, value)
  const CardIcon = definition.icon
  return (
    <article className="metric-card" style={{ '--sensor': definition.color } as React.CSSProperties}>
      <div className="metric-top"><span>{definition.shortLabel}</span><div className="metric-icon"><CardIcon size={18} /></div></div>
      <div className="metric-value"><strong>{formatValue(value, definition.key)}</strong><span>{value === null || value === undefined ? '' : definition.unit}</span></div>
      <p className={`metric-state ${state.state}`}><i />{state.label}</p>
    </article>
  )
}

function SensorTooltip({ active, payload, label, unit }: { active?: boolean; payload?: { value: number }[]; label?: string; unit: string }) {
  if (!active || !payload?.length) return null
  return <div className="chart-tooltip"><span>{label}</span><strong>{payload[0].value.toLocaleString('id-ID')} <small>{unit}</small></strong></div>
}

function SensorChart({ definition, data }: { definition: typeof sensorDefinitions[number]; data: ChartPoint[] }) {
  const available = data.filter(point => point[definition.key] !== null && point[definition.key] !== undefined)
  const current = available.at(-1)?.[definition.key] as number | undefined
  const gradientId = `gradient-${definition.key}`
  return (
    <article className="sensor-chart" style={{ '--sensor': definition.color } as React.CSSProperties}>
      <header>
        <div><span>{definition.label}</span><strong>{formatValue(current, definition.key)} <small>{current === undefined ? '' : definition.unit}</small></strong></div>
        <i />
      </header>
      <div className="mini-chart">
        {available.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 2, left: -29, bottom: 0 }}>
              <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={definition.color} stopOpacity={.34} /><stop offset="100%" stopColor={definition.color} stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,.055)" strokeDasharray="3 5" />
              <XAxis dataKey="time" axisLine={false} tickLine={false} minTickGap={55} tick={{ fill: '#65716a', fontSize: 9 }} />
              <YAxis domain={definition.domain} axisLine={false} tickLine={false} tick={{ fill: '#65716a', fontSize: 9 }} width={48} />
              <Tooltip content={<SensorTooltip unit={definition.unit} />} cursor={{ stroke: definition.color, strokeOpacity: .3 }} />
              <Area type="monotone" dataKey={definition.key} connectNulls={false} stroke={definition.color} strokeWidth={2} fill={`url(#${gradientId})`} dot={false} activeDot={{ r: 3, fill: definition.color, stroke: '#0b100e', strokeWidth: 2 }} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : <div className="chart-empty"><Radio size={18} /><span>Belum cukup data dari sensor</span></div>}
      </div>
      <footer><span>{definition.ideal}</span><b>{available.length} sampel</b></footer>
    </article>
  )
}

function Reservoir({ level, waterTemp, distance }: { level: number | null | undefined; waterTemp: number | null | undefined; distance: number | null | undefined }) {
  const safeLevel = level ?? 0
  const state = level === null || level === undefined ? 'Belum terbaca' : level < 10 ? 'Kritis' : level < 30 ? 'Rendah' : 'Aman'
  return (
    <article className="panel reservoir-panel" id="tandon">
      <div className="panel-heading"><div><p className="eyebrow">WATER SYSTEM</p><h2>Tandon nutrisi</h2></div><Waves size={21} /></div>
      <div className={`tank-stage ${level === null || level === undefined ? 'no-data' : ''}`}>
        <div className="tank-scale"><span>100</span><span>75</span><span>50</span><span>25</span><span>0</span></div>
        <div className="tank">
          <div className="tank-water" style={{ height: `${safeLevel}%` }}><span /><span /><span /></div>
          <div className="tank-reading"><strong>{level === null || level === undefined ? '—' : level.toFixed(1)}</strong><span>{level === null || level === undefined ? '' : '%'}</span></div>
        </div>
      </div>
      <div className="reservoir-stats">
        <div><span>Status</span><strong>{state}</strong></div>
        <div><span>Suhu air</span><strong>{waterTemp === null || waterTemp === undefined ? '—' : `${waterTemp.toFixed(1)}°C`}</strong></div>
        <div><span>Jarak laser</span><strong>{distance === null || distance === undefined ? '—' : `${distance.toFixed(0)} mm`}</strong></div>
      </div>
    </article>
  )
}

function RelayControl({ relays, toggle, enabled }: { relays: boolean[]; toggle: (index: number) => void; enabled: boolean }) {
  return (
    <article className="panel relay-panel" id="aktuator">
      <div className="panel-heading"><div><p className="eyebrow">HARDWARE FEEDBACK</p><h2>Aktuator</h2></div><span className={`safety ${enabled ? '' : 'offline'}`}><i />{enabled ? 'Kontrol tersedia' : 'Backend terputus'}</span></div>
      <div className="relay-list">
        {relayItems.map(({ name, note, icon: RelayIcon }, index) => (
          <div className="relay-row" key={name}>
            <div className={`relay-icon ${relays[index] ? 'on' : ''}`}><RelayIcon size={20} /></div>
            <div className="relay-copy"><strong>{name}</strong><span>{note}</span></div>
            <div className="relay-state"><span>{relays[index] ? 'ON' : 'OFF'}</span><button disabled={!enabled} className={`toggle ${relays[index] ? 'on' : ''}`} onClick={() => toggle(index)} role="switch" aria-checked={relays[index]} aria-label={`${relays[index] ? 'Matikan' : 'Nyalakan'} ${name}`}><i /></button></div>
          </div>
        ))}
      </div>
      <p className="relay-note"><Radio size={14} /> Posisi sakelar mengikuti feedback hardware, bukan state lokal.</p>
    </article>
  )
}

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { telemetry, status, mqtt, history, alarms, relays, socketConnected, backendAvailable, loading, toggleRelay, notice } = useHydroData()
  const lastUpdate = useMemo(() => {
    const date = parseTime(telemetry?.timestamp)
    return date ? date.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Belum ada telemetry'
  }, [telemetry?.timestamp])
  const deviceOnline = status?.status === 'online'
  const activeAlarms = alarms.filter(alarm => alarm.state === 'active')

  return (
    <div className="app-shell">
      <Sidebar open={menuOpen} close={() => setMenuOpen(false)} backendOnline={backendAvailable} mqttOnline={mqtt?.connected === true} />
      <main className="main">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMenuOpen(true)} aria-label="Buka navigasi"><Menu size={21} /></button>
          <div className="topbar-title"><strong>Smart Hydroponics</strong><span>POLINELA / MONITORING</span></div>
          <div className="top-actions">
            <div className={`connection-pill ${deviceOnline ? 'online' : 'offline'}`}><i />{deviceOnline ? 'Perangkat online' : 'Perangkat offline'}</div>
            <div className="socket-state" title="Koneksi real-time"><Radio size={16} /><span>{socketConnected ? 'LIVE' : 'REST'}</span></div>
          </div>
        </header>

        <div className="content">
          <section className="intro" id="ringkasan">
            <div><p className="kicker"><span /> TELEMETRY CONTROL ROOM</p><h1>Dashboard <em>Hidroponik</em></h1><p>Data terakhir: {lastUpdate} WIB · {telemetry?.ip ? `ESP32 ${telemetry.ip}` : 'menunggu perangkat'}</p></div>
            <div className={`system-banner ${activeAlarms.length ? 'alert' : ''}`}>
              {activeAlarms.length ? <AlertTriangle size={23} /> : <Activity size={23} />}
              <div><strong>{activeAlarms.length ? `${activeAlarms.length} alarm aktif` : 'Monitoring berjalan'}</strong><span>{loading ? 'Memuat data backend…' : activeAlarms[0]?.description || 'Semua kanal backend telah diperiksa'}</span></div>
            </div>
          </section>

          <section className="metrics-grid" aria-label="Ringkasan sensor">
            {sensorDefinitions.map(definition => <MetricCard key={definition.key} definition={definition} value={telemetry?.[definition.key] as number | null | undefined} />)}
          </section>

          <section className="chart-section" id="tren-sensor">
            <div className="section-heading"><div><p className="eyebrow"><Radio size={13} /> DATA BACKEND · 24 JAM</p><h2>Tren setiap parameter</h2></div><span>{history.length} telemetry tersimpan</span></div>
            <div className="charts-grid">
              {sensorDefinitions.map(definition => <SensorChart key={definition.key} definition={definition} data={history} />)}
            </div>
          </section>

          <section className="operations-grid">
            <Reservoir level={telemetry?.level_pct} waterTemp={telemetry?.water_t} distance={telemetry?.dist_mm} />
            <RelayControl relays={relays} toggle={toggleRelay} enabled={backendAvailable && mqtt?.connected === true} />
          </section>

          <section className="bottom-grid" id="diagnostik">
            <article className="panel diagnostics-panel">
              <div className="panel-heading"><div><p className="eyebrow">DEVICE HEALTH</p><h2>Diagnostik perangkat</h2></div><CircuitBoard size={22} /></div>
              <div className="diagnostic-grid">
                <div><Wifi size={18} /><span>WiFi RSSI</span><strong>{status ? `${status.rssi} dBm` : '—'}</strong></div>
                <div><Antenna size={18} /><span>Bus error</span><strong>{status ? `${status.bus_err_pct.toFixed(2)}%` : '—'}</strong></div>
                <div><Activity size={18} /><span>Uptime</span><strong>{formatUptime(status?.uptime_s)}</strong></div>
                <div><CircuitBoard size={18} /><span>Free heap</span><strong>{status ? `${Math.round(status.heap / 1024)} KB` : '—'}</strong></div>
                <div><Server size={18} /><span>Bus TX</span><strong>{status?.bus_tx.toLocaleString('id-ID') ?? '—'}</strong></div>
                <div><Gauge size={18} /><span>Maintenance</span><strong>{status ? (status.maint ? 'Aktif' : 'Normal') : '—'}</strong></div>
              </div>
            </article>

            <article className="panel alarm-panel">
              <div className="panel-heading"><div><p className="eyebrow">ALARM BACKEND</p><h2>Alarm terbaru</h2></div><BellRing size={21} /></div>
              <div className="alarm-list">
                {alarms.length ? alarms.slice(0, 5).map(alarm => (
                  <div className={`alarm-row ${alarm.level}`} key={`${alarm.id}-${alarm.triggered_at}`}><b>{alarm.code}</b><div><strong>{alarm.description}</strong><span>{alarm.triggered_at}</span></div><em className={alarm.state}>{alarm.state === 'active' ? 'AKTIF' : 'SELESAI'}</em></div>
                )) : <div className="empty-state"><BellRing size={22} /><span>Tidak ada alarm dari backend</span></div>}
              </div>
            </article>
          </section>
        </div>
      </main>
      {notice ? <div className="toast"><Power size={17} />{notice}</div> : null}
    </div>
  )
}
