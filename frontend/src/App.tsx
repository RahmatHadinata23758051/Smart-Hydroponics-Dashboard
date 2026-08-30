import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import {
  Activity, AgricultureAnalytics, ChartLine, CheckmarkFilled, Chip, ConnectionSignal,
  Dashboard, DataBase, Humidity, Light, Meter, Notification, Power, Radio, RainDrop,
  Temperature, TemperatureWater, WarningAltFilled, Wifi, Windy,
} from '@carbon/icons-react'
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import greenhouseImage from './assets/hydroponic-greenhouse.webp'
import { useHydroData } from './useHydroData'
import type { HistoryRange } from './useHydroData'
import type { ChartPoint } from './types'

gsap.registerPlugin(ScrollTrigger, useGSAP)

type Icon = ComponentType<{ size?: number | string; className?: string }>
type SensorKey = 'ec' | 'tds' | 'ph' | 'water_t' | 'air_t' | 'air_rh' | 'lux' | 'level_pct'

type SensorDefinition = {
  key: SensorKey
  label: string
  shortLabel: string
  unit: string
  icon: Icon
  domain: [number | 'auto', number | 'auto']
  ideal: string
}

const navItems = [
  { label: 'Ringkasan', target: 'ringkasan' },
  { label: 'Tren sensor', target: 'tren-sensor' },
  { label: 'Sistem air', target: 'sistem' },
  { label: 'Diagnostik', target: 'diagnostik' },
]

const historyRanges: { value: HistoryRange; label: string; detail: string }[] = [
  { value: '1h', label: '1 jam', detail: 'Interval 1 menit' },
  { value: '24h', label: '24 jam', detail: 'Interval 5 menit' },
  { value: '30d', label: '30 hari', detail: 'Interval 1 jam' },
]

const sensorDefinitions: SensorDefinition[] = [
  { key: 'ec', label: 'EC nutrisi', shortLabel: 'EC nutrisi', unit: 'µS/cm', icon: Activity, domain: [0, 3000], ideal: 'Rentang kerja 1.500 sampai 2.000' },
  { key: 'ph', label: 'Keasaman larutan', shortLabel: 'pH larutan', unit: 'pH', icon: AgricultureAnalytics, domain: [3, 11], ideal: 'Rentang kerja 5,5 sampai 6,8' },
  { key: 'level_pct', label: 'Level tandon', shortLabel: 'Level tandon', unit: '%', icon: Meter, domain: [0, 100], ideal: 'Aman pada level 30% atau lebih' },
  { key: 'tds', label: 'Total zat terlarut', shortLabel: 'TDS', unit: 'ppm', icon: DataBase, domain: [0, 1500], ideal: 'Rentang kerja 750 sampai 1.000' },
  { key: 'water_t', label: 'Suhu larutan', shortLabel: 'Suhu larutan', unit: '°C', icon: TemperatureWater, domain: [15, 35], ideal: 'Rentang kerja 20 sampai 28°C' },
  { key: 'air_t', label: 'Suhu greenhouse', shortLabel: 'Suhu udara', unit: '°C', icon: Temperature, domain: [20, 40], ideal: 'Rentang kerja 24 sampai 30°C' },
  { key: 'air_rh', label: 'Kelembapan udara', shortLabel: 'Kelembapan', unit: '% RH', icon: Humidity, domain: [0, 100], ideal: 'Rentang kerja 60 sampai 80%' },
  { key: 'lux', label: 'Intensitas cahaya', shortLabel: 'Cahaya', unit: 'lux', icon: Light, domain: [0, 'auto'], ideal: 'Pembacaan sensor lux RS-485' },
]

const relayItems = [
  { name: 'Pompa nutrisi', note: 'Auto-cutoff 5 detik', icon: RainDrop },
  { name: 'Misting', note: 'Auto-cutoff 30 detik', icon: Humidity },
  { name: 'Exhaust fan', note: 'Auto-cutoff 10 menit', icon: Windy },
  { name: 'Grow light', note: 'Kontrol manual', icon: Light },
]

function formatValue(value: number | null | undefined, key: SensorKey) {
  if (value === null || value === undefined) return 'N/A'
  if (key === 'lux' || key === 'ec' || key === 'tds') {
    return value.toLocaleString('id-ID', { maximumFractionDigits: 0 })
  }
  return value.toLocaleString('id-ID', {
    minimumFractionDigits: key === 'ph' ? 2 : 1,
    maximumFractionDigits: key === 'ph' ? 2 : 1,
  })
}

function formatDateTime(value?: string) {
  if (!value) return 'Menunggu data pertama'
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('id-ID', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function formatChartTick(value: string, range: HistoryRange) {
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return value
  if (range === '30d') {
    return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })
  }
  return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
}

function formatChartTooltip(value: string, range: HistoryRange) {
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    ...(range === '30d' ? {} : { hour: '2-digit', minute: '2-digit' }),
  })
}

function getSensorState(key: SensorKey, value: number | null | undefined) {
  if (value === null || value === undefined) return { label: 'Belum tersedia', state: 'missing' }
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
  return checks[key]
    ? { label: 'Dalam rentang', state: 'good' }
    : { label: 'Perlu diperiksa', state: 'warn' }
}

function formatUptime(seconds?: number) {
  if (seconds === undefined) return 'N/A'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return days > 0 ? `${days} hari ${hours} jam` : `${hours} jam ${minutes} menit`
}

function MetricCard({ definition, value, featured, loading }: {
  definition: SensorDefinition
  value: number | null | undefined
  featured?: boolean
  loading: boolean
}) {
  const state = getSensorState(definition.key, value)
  const CardIcon = definition.icon
  return (
    <article className={`metric-card ${featured ? 'featured' : 'compact'}`}>
      <div className="metric-label"><CardIcon size={20} /><span>{definition.shortLabel}</span></div>
      {loading && value === undefined ? (
        <div className="value-skeleton" aria-label="Memuat data sensor" />
      ) : (
        <div className="metric-reading">
          <strong>{formatValue(value, definition.key)}</strong>
          <span>{value === null || value === undefined ? '' : definition.unit}</span>
        </div>
      )}
      <div className={`metric-status ${state.state}`}><i />{state.label}</div>
    </article>
  )
}

function SensorTooltip({ active, payload, label, unit, range }: {
  active?: boolean
  payload?: { value: number }[]
  label?: string
  unit: string
  range: HistoryRange
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <span>{label ? formatChartTooltip(label, range) : ''}</span>
      <strong>{payload[0].value.toLocaleString('id-ID')} <small>{unit}</small></strong>
    </div>
  )
}

function ViewportVideo({ src, poster, className, onError }: {
  src: string
  poster?: string
  className?: string
  onError?: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      video.pause()
      return
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        void video.play().catch(() => undefined)
      } else {
        video.pause()
      }
    }, { rootMargin: '160px 0px', threshold: 0.01 })

    observer.observe(video)
    return () => observer.disconnect()
  }, [src])

  return (
    <video
      ref={videoRef}
      className={className}
      muted
      loop
      playsInline
      preload="metadata"
      poster={poster}
      onError={onError}
    >
      <source src={src} type="video/mp4" />
    </video>
  )
}

function SensorChart({ definition, data, loading, range, liveValue }: {
  definition: SensorDefinition
  data: ChartPoint[]
  loading: boolean
  range: HistoryRange
  liveValue?: number | null
}) {
  const available = data.filter(point => point[definition.key] !== null && point[definition.key] !== undefined)
  const current = (available.at(-1)?.[definition.key] ?? liveValue) as number | undefined
  const gradientId = `sensor-fill-${definition.key}`

  return (
    <article className={`sensor-chart chart-${definition.key}`} aria-label={`Grafik ${definition.label}`}>
      <header>
        <div>
          <span>{definition.label}</span>
          <strong>{formatValue(current, definition.key)} <small>{current === undefined ? '' : definition.unit}</small></strong>
        </div>
        <ChartLine size={20} />
      </header>
      <div className="chart-canvas">
        {available.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 12, right: 6, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#198038" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#198038" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#dfe7df" strokeDasharray="2 4" />
              <XAxis
                dataKey="timestamp"
                axisLine={false}
                tickLine={false}
                minTickGap={50}
                tick={{ fill: '#6b756d', fontSize: 10 }}
                tickFormatter={(value: string) => formatChartTick(value, range)}
              />
              <YAxis
                domain={definition.domain}
                axisLine={false}
                tickLine={false}
                width={38}
                tick={{ fill: '#6b756d', fontSize: 10 }}
                tickFormatter={(value: number) => value >= 1000 ? `${value / 1000}k` : `${value}`}
              />
              <Tooltip content={<SensorTooltip unit={definition.unit} range={range} />} cursor={{ stroke: '#198038', strokeOpacity: 0.35 }} />
              <Area
                type="monotone"
                dataKey={definition.key}
                connectNulls={false}
                stroke="#198038"
                strokeWidth={2.25}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{ r: 4, fill: '#198038', stroke: '#f8fbf7', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className={`chart-empty ${loading ? 'loading' : ''}`}>
            <Radio size={20} />
            <span>{loading ? 'Mengambil histori sensor' : 'Belum cukup data dari backend'}</span>
          </div>
        )}
      </div>
      <footer><span>{definition.ideal}</span><b>{available.length} sampel</b></footer>
    </article>
  )
}

function Reservoir({ level, waterTemp, distance }: {
  level: number | null | undefined
  waterTemp: number | null | undefined
  distance: number | null | undefined
}) {
  const safeLevel = Math.min(100, Math.max(0, level ?? 0))
  const state = level === null || level === undefined
    ? 'Belum terbaca'
    : level < 10 ? 'Kritis' : level < 30 ? 'Rendah' : 'Aman'

  return (
    <article className="operation-panel reservoir-panel">
      <div className="panel-heading">
        <div><span>Reservoir utama</span><h3>Tandon nutrisi</h3></div>
        <RainDrop size={28} />
      </div>
      <div className="reservoir-content">
        <div className="reservoir-copy">
          <p>Level larutan dibaca langsung dari laser distance sensor. Persentase dihitung oleh perangkat sebelum dikirim ke backend.</p>
          <div className="reservoir-stats">
            <div><span>Status</span><strong className={state === 'Aman' ? 'safe' : ''}>{state}</strong></div>
            <div><span>Suhu air</span><strong>{waterTemp === null || waterTemp === undefined ? 'N/A' : `${waterTemp.toFixed(1)}°C`}</strong></div>
            <div><span>Jarak laser</span><strong>{distance === null || distance === undefined ? 'N/A' : `${distance.toFixed(0)} mm`}</strong></div>
          </div>
        </div>
        <div className="reservoir-visual">
          <div className="tank-scale"><span>100</span><span>75</span><span>50</span><span>25</span><span>0</span></div>
          <div className="tank">
            <div className="tank-water" style={{ height: `${safeLevel}%` }} />
            <div className="tank-reading">
              <strong>{level === null || level === undefined ? 'N/A' : level.toFixed(1)}</strong>
              <span>{level === null || level === undefined ? '' : '%'}</span>
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}

function RelayControl({ relays, toggle, enabled, known }: {
  relays: boolean[]
  toggle: (index: number) => void
  enabled: boolean
  known: boolean
}) {
  return (
    <article className="actuator-dock relay-panel">
      <div className="panel-heading">
        <div><span>Hardware feedback</span><h3>Kontrol aktuator</h3></div>
        <div className={`availability ${enabled && known ? 'available' : ''}`}><i />{!known ? 'Menunggu feedback' : enabled ? 'Siap' : 'Terkunci'}</div>
      </div>
      <div className="relay-accordion">
        {relayItems.map(({ name, note, icon: RelayIcon }, index) => (
          <div className={`relay-slice ${known && relays[index] ? 'on' : ''}`} key={name}>
            <div className="relay-icon"><RelayIcon size={28} /></div>
            <div className="relay-copy"><strong>{name}</strong><span>{note}</span></div>
            <div className="relay-state">
              <span>{known ? (relays[index] ? 'ON' : 'OFF') : '--'}</span>
              <button
                type="button"
                disabled={!enabled || !known}
                className={`toggle ${known && relays[index] ? 'on' : ''}`}
                onClick={() => toggle(index)}
                role="switch"
                aria-checked={relays[index]}
                aria-label={`${relays[index] ? 'Matikan' : 'Nyalakan'} ${name}`}
              ><i /></button>
            </div>
          </div>
        ))}
      </div>
      <p className="hardware-note"><Radio size={16} />{known ? 'Sakelar mengikuti feedback perangkat fisik.' : 'Belum ada status relay aktual dari perangkat.'}</p>
    </article>
  )
}

export default function App() {
  const pageRef = useRef<HTMLDivElement>(null)
  const [activeSection, setActiveSection] = useState('ringkasan')
  const [heroVideoFailed, setHeroVideoFailed] = useState(false)
  const [sensorVideoFailed, setSensorVideoFailed] = useState(false)
  const [operationsVideoFailed, setOperationsVideoFailed] = useState(false)
  const {
    telemetry, status, mqtt, history, alarms, relays, relayKnown, socketConnected,
    backendAvailable, loading, historyLoading, historyRange, setHistoryRange,
    toggleRelay, notice,
  } = useHydroData()
  const heroVideoUrl = (import.meta.env.VITE_HERO_VIDEO_URL as string | undefined)?.trim() || '/media/green_house.mp4'
  const sensorVideoUrl = (import.meta.env.VITE_SENSOR_VIDEO_URL as string | undefined)?.trim() || '/media/sensor.mp4'
  const operationsVideoUrl = (import.meta.env.VITE_OPERATIONS_VIDEO_URL as string | undefined)?.trim() || '/media/greenhouse_hydro.mp4'
  const showHeroVideo = !heroVideoFailed
  const showSensorVideo = !sensorVideoFailed
  const showOperationsVideo = !operationsVideoFailed
  const lastUpdate = useMemo(() => formatDateTime(telemetry?.timestamp), [telemetry?.timestamp])
  const deviceOnline = status?.status === 'online'
  const activeAlarms = alarms.filter(alarm => alarm.state === 'active')
  const featuredSensors = sensorDefinitions.slice(0, 3)
  const compactSensors = sensorDefinitions.slice(3)

  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
      if (visible) setActiveSection(visible.target.id)
    }, { rootMargin: '-20% 0px -62% 0px', threshold: [0, 0.15, 0.4] })

    navItems.forEach(({ target }) => {
      const section = document.getElementById(target)
      if (section) observer.observe(section)
    })
    return () => observer.disconnect()
  }, [])

  useGSAP(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) return

    let navVisible = true
    const setNavVisible = (visible: boolean) => {
      if (visible === navVisible) return
      navVisible = visible
      gsap.to('.topbar', {
        yPercent: visible ? 0 : -145,
        autoAlpha: visible ? 1 : 0,
        duration: visible ? 0.48 : 0.72,
        ease: visible ? 'power3.out' : 'power2.inOut',
        overwrite: 'auto',
      })
    }

    ScrollTrigger.create({
      start: 110,
      end: () => ScrollTrigger.maxScroll(window),
      onUpdate: self => {
        if (self.scroll() < 110) setNavVisible(true)
        else setNavVisible(self.direction < 0)
      },
    })

    const intro = gsap.timeline({ defaults: { ease: 'power3.out' } })
    intro
      .from('.hero-title .line', { yPercent: 110, duration: 0.9, stagger: 0.12 })
      .from('.hero-lead, .hero-action', { y: 24, opacity: 0, duration: 0.65, stagger: 0.1 }, '-=0.45')
      .from('.hero-visual', { scale: 0.8, opacity: 0, rotate: 3, duration: 1.05 }, '-=0.85')

    const mm = gsap.matchMedia()
    mm.add('(min-width: 1024px)', () => {
      ScrollTrigger.create({
        trigger: '.trend-layout',
        start: 'top 110px',
        end: 'bottom bottom-=80',
        pin: '.trend-intro',
        pinSpacing: false,
      })

    })
    return () => mm.revert()
  }, { scope: pageRef })

  const systemMessage = loading
    ? { title: 'Menghubungkan sistem', body: 'Mengambil pembacaan terbaru dari backend.', tone: 'neutral' }
    : !backendAvailable
      ? { title: 'Backend tidak terjangkau', body: 'Data terakhir dipertahankan sampai koneksi pulih.', tone: 'danger' }
      : activeAlarms.length
        ? { title: `${activeAlarms.length} alarm aktif`, body: activeAlarms[0]?.description || 'Periksa kondisi perangkat.', tone: 'warning' }
        : { title: 'Sistem terpantau normal', body: 'Seluruh kanal backend berhasil diperiksa.', tone: 'success' }

  return (
    <div className="app-shell" ref={pageRef}>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#ringkasan" aria-label="Hydra kembali ke ringkasan">
            <span className="brand-mark" aria-hidden="true">
              <img src="/brand/hydra-logo-mark.png" alt="" />
            </span>
            <span><strong>HYDRA</strong><small>IoT Monitoring</small></span>
          </a>
          <nav className="scroll-nav" aria-label="Navigasi dashboard">
            {navItems.map(({ label, target }) => (
              <a className={activeSection === target ? 'active' : ''} href={`#${target}`} key={target}>{label}</a>
            ))}
          </nav>
          <div className="top-status">
            <span className={`device-status ${deviceOnline ? 'online' : ''}`}><i />{deviceOnline ? 'Perangkat online' : 'Perangkat offline'}</span>
            <span className={`stream-status ${socketConnected ? 'live' : ''}`}><ConnectionSignal size={18} />{socketConnected ? 'LIVE' : 'REST'}</span>
          </div>
        </div>
      </header>

      <main className="dashboard">
        <section className="hero" id="ringkasan">
          <div className="hero-copy">
            <p className="overline"><span />Hydroponics control center</p>
            <h1 className="hero-title">
              <span className="line"><span>Kondisi <i className="inline-crop" style={{ backgroundImage: `url(${greenhouseImage})` }} aria-hidden="true" /> hidroponik</span></span>
              <span className="line"><em>saat ini.</em></span>
            </h1>
            <p className="hero-lead">Satu alur monitoring untuk larutan, iklim greenhouse, aktuator, dan kesehatan perangkat.</p>
            <a className="hero-action" href="#sensor-overview">Lihat pembacaan langsung <span>↓</span></a>
          </div>
          <div className="hero-visual" aria-hidden="true">
            {showHeroVideo ? (
              <ViewportVideo
                src={heroVideoUrl}
                poster={greenhouseImage}
                onError={() => setHeroVideoFailed(true)}
              />
            ) : <img src={greenhouseImage} alt="" />}
            <span className="visual-caption">Live cultivation system</span>
          </div>
        </section>

        <div className="data-chapters">
          <div className={`chapter-group sensor-chapter ${showSensorVideo ? 'has-chapter-video' : ''}`}>
            {showSensorVideo ? (
              <div className="chapter-video-layer" aria-hidden="true">
                <div className="chapter-video-sticky">
                  <ViewportVideo src={sensorVideoUrl} onError={() => setSensorVideoFailed(true)} />
                </div>
              </div>
            ) : null}

          <section className="sensor-overview" id="sensor-overview" aria-labelledby="sensor-title">
          <div className="system-strip">
            <div className={`summary-icon ${systemMessage.tone}`}>
              {systemMessage.tone === 'success' ? <CheckmarkFilled size={26} /> : systemMessage.tone === 'neutral' ? <Radio size={26} /> : <WarningAltFilled size={26} />}
            </div>
            <div className="summary-copy"><span>Status operasi</span><strong>{systemMessage.title}</strong><p>{systemMessage.body}</p></div>
            <dl>
              <div><dt>Backend</dt><dd>{backendAvailable ? 'Terhubung' : 'Terputus'}</dd></div>
              <div><dt>MQTT</dt><dd>{mqtt?.connected ? 'Terhubung' : 'Terputus'}</dd></div>
              <div><dt>Alarm</dt><dd>{activeAlarms.length}</dd></div>
              <div><dt>Update</dt><dd>{lastUpdate}</dd></div>
            </dl>
          </div>

          <div className="section-title compact-title">
            <div><h2 id="sensor-title">Pembacaan utama</h2><p>Nilai terbaru yang benar-benar diterima dari perangkat.</p></div>
            <span className="source-label"><DataBase size={16} />Backend telemetry</span>
          </div>
          <div className="featured-metrics">
            {featuredSensors.map(definition => (
              <MetricCard key={definition.key} definition={definition} value={telemetry?.[definition.key]} featured loading={loading} />
            ))}
          </div>
          <div className="compact-metrics">
            {compactSensors.map(definition => (
              <MetricCard key={definition.key} definition={definition} value={telemetry?.[definition.key]} loading={loading} />
            ))}
          </div>
          </section>

          <section className="section-block trend-section" id="tren-sensor">
          <div className="trend-layout">
            <div className="trend-intro">
              <span className="section-kicker"><ChartLine size={18} />Tren real-time</span>
              <h2>Setiap sensor punya ruang baca sendiri.</h2>
              <p>Satu grafik untuk satu parameter, dengan skala dan rentang kerja yang relevan.</p>
              <div className="range-filter" role="group" aria-label="Rentang waktu grafik">
                {historyRanges.map(option => (
                  <button
                    type="button"
                    key={option.value}
                    className={historyRange === option.value ? 'active' : ''}
                    aria-pressed={historyRange === option.value}
                    title={option.detail}
                    onClick={() => setHistoryRange(option.value)}
                  >{option.label}</button>
                ))}
              </div>
              <span className={`sample-count ${historyLoading ? 'loading' : ''}`}>
                {historyLoading ? 'Mengambil histori' : `${history.length} telemetry tersimpan`}
              </span>
            </div>
            <div className="charts-grid">
              {sensorDefinitions.map(definition => (
                <SensorChart
                  key={definition.key}
                  definition={definition}
                  data={history}
                  loading={historyLoading}
                  range={historyRange}
                  liveValue={telemetry?.[definition.key]}
                />
              ))}
            </div>
          </div>
          </section>
          </div>

          <div className={`chapter-group operations-chapter ${showOperationsVideo ? 'has-chapter-video' : ''}`}>
            {showOperationsVideo ? (
              <div className="chapter-video-layer" aria-hidden="true">
                <div className="chapter-video-sticky">
                  <ViewportVideo src={operationsVideoUrl} onError={() => setOperationsVideoFailed(true)} />
                </div>
              </div>
            ) : null}

          <section className="section-block system-section" id="sistem">
          <div className="section-title">
            <div><h2>Sistem air dan aktuator</h2><p>Panel lapangan dengan feedback langsung, disusun sebagai rangkaian kontrol yang bisa ditelusuri.</p></div>
            <span className="source-label"><Radio size={16} />Hardware feedback</span>
          </div>
          <div className="stack-sequence">
            <Reservoir level={telemetry?.level_pct} waterTemp={telemetry?.water_t} distance={telemetry?.dist_mm} />
            <RelayControl relays={relays} toggle={toggleRelay} enabled={backendAvailable && mqtt?.connected === true} known={relayKnown} />
          </div>
          </section>

          <section className="section-block diagnostics-section" id="diagnostik">
          <div className="section-title">
            <div><h2>Kesehatan perangkat</h2><p>Diagnostik ESP32, jalur RS-485, MQTT, dan alarm backend.</p></div>
            <span className={`health-indicator ${deviceOnline ? 'online' : ''}`}><i />{deviceOnline ? 'Perangkat sehat' : 'Perlu diperiksa'}</span>
          </div>
          <div className="diagnostics-layout">
            <article className="diagnostic-panel">
              <div className="panel-heading"><div><span>Device health</span><h3>Diagnostik perangkat</h3></div><Dashboard size={24} /></div>
              <div className="diagnostic-grid">
                <div><Wifi size={20} /><span>WiFi RSSI</span><strong>{status ? `${status.rssi} dBm` : 'N/A'}</strong></div>
                <div><ConnectionSignal size={20} /><span>Bus error</span><strong>{status ? `${status.bus_err_pct.toFixed(2)}%` : 'N/A'}</strong></div>
                <div><Activity size={20} /><span>Uptime</span><strong>{formatUptime(status?.uptime_s)}</strong></div>
                <div><Chip size={20} /><span>Free heap</span><strong>{status ? `${Math.round(status.heap / 1024)} KB` : 'N/A'}</strong></div>
                <div><DataBase size={20} /><span>Bus TX</span><strong>{status?.bus_tx.toLocaleString('id-ID') ?? 'N/A'}</strong></div>
                <div><Meter size={20} /><span>Maintenance</span><strong>{status ? (status.maint ? 'Aktif' : 'Normal') : 'N/A'}</strong></div>
              </div>
            </article>

            <article className="alarm-panel">
              <div className="panel-heading"><div><span>Backend events</span><h3>Alarm terbaru</h3></div><Notification size={24} /></div>
              <div className="alarm-list">
                {alarms.length ? alarms.slice(0, 5).map(alarm => (
                  <div className={`alarm-row ${alarm.level}`} key={`${alarm.id}-${alarm.triggered_at}`}>
                    <span className="alarm-code">{alarm.code}</span>
                    <div><strong>{alarm.description}</strong><span>{formatDateTime(alarm.triggered_at)}</span></div>
                    <em className={alarm.state}>{alarm.state === 'active' ? 'AKTIF' : 'SELESAI'}</em>
                  </div>
                )) : (
                  <div className="empty-state"><CheckmarkFilled size={24} /><div><strong>Tidak ada alarm</strong><span>Backend belum mengirim kejadian yang perlu ditinjau.</span></div></div>
                )}
              </div>
            </article>
          </div>
          </section>
          </div>
        </div>
      </main>

      <footer className="site-footer">
        <div className="footer-brand">
          <img src="/brand/hydra-favicon.png" alt="" aria-hidden="true" />
          <strong>HYDRA</strong>
        </div>
        <a href="#ringkasan">Kembali ke kondisi terbaru ↑</a>
        <span>ESP32-S3 / RS-485 / MQTT</span>
      </footer>
      {notice ? <div className="toast" role="status"><Power size={18} />{notice}</div> : null}
    </div>
  )
}
