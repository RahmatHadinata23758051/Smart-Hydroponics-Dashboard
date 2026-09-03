import {
  Activity, Humidity, Light, Meter, Radio, RainDrop, Temperature, Windy,
} from '@carbon/icons-react'
import type { ComponentType } from 'react'
import type { RelayState, Telemetry } from '../types'

type Icon = ComponentType<{ size?: number | string; className?: string }>

type GreenhouseTwinProps = {
  telemetry: Telemetry | null
  relays: RelayState
  relayKnown: boolean
  deviceOnline: boolean
}

type LiveReadingProps = {
  icon: Icon
  label: string
  value: number | null | undefined
  unit: string
  digits?: number
}

const actuatorDefinitions = [
  { label: 'Pompa nutrisi', className: 'nutrient', icon: RainDrop },
  { label: 'Misting', className: 'misting', icon: Humidity },
  { label: 'Exhaust fan', className: 'exhaust', icon: Windy },
  { label: 'Grow light', className: 'grow-light', icon: Light },
] as const

function formatReading(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A'
  return value.toLocaleString('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function LiveReading({ icon: ReadingIcon, label, value, unit, digits }: LiveReadingProps) {
  const available = value !== null && value !== undefined && Number.isFinite(value)
  return (
    <div className={`twin-reading ${available ? '' : 'missing'}`}>
      <ReadingIcon size={18} />
      <span>{label}</span>
      <strong>{formatReading(value, digits)}{available ? <small>{unit}</small> : null}</strong>
    </div>
  )
}

export function GreenhouseTwin({ telemetry, relays, relayKnown, deviceOnline }: GreenhouseTwinProps) {
  const feedbackLive = relayKnown && deviceOnline
  const actuatorOn = relays.map(state => feedbackLive && state)
  const levelAvailable = telemetry?.level_pct !== null && telemetry?.level_pct !== undefined
  const safeLevel = levelAvailable
    ? Math.min(100, Math.max(0, telemetry.level_pct as number))
    : 0
  const levelState = !levelAvailable
    ? 'Belum terbaca'
    : safeLevel < 10
      ? 'Kritis'
      : safeLevel < 30
        ? 'Rendah'
        : 'Aman'

  return (
    <article className={`greenhouse-twin ${feedbackLive ? 'feedback-live' : 'feedback-stale'}`}>
      <header className="twin-header">
        <div>
          <span>Representasi sistem</span>
          <h3>Digital twin greenhouse</h3>
          <p>Gerak aktuator dan tinggi larutan mengikuti feedback perangkat yang diterima backend.</p>
        </div>
        <div className={`twin-link-state ${feedbackLive ? 'online' : ''}`}>
          <Radio size={18} />
          <span>{feedbackLive ? 'Feedback langsung' : 'Menunggu perangkat'}</span>
        </div>
      </header>

      <div className="twin-board">
        <div className="twin-reading-rail" aria-label="Pembacaan lingkungan greenhouse">
          <LiveReading icon={Temperature} label="Suhu udara" value={telemetry?.air_t} unit="°C" />
          <LiveReading icon={Humidity} label="Kelembapan" value={telemetry?.air_rh} unit="% RH" />
          <LiveReading icon={Light} label="Cahaya" value={telemetry?.lux} unit=" lux" digits={0} />
          <LiveReading icon={Activity} label="EC nutrisi" value={telemetry?.ec} unit=" µS/cm" digits={0} />
        </div>

        <div className="twin-stage" aria-label="Simulasi langsung kondisi greenhouse">
          <div className="greenhouse-frame" aria-hidden="true">
            <i className="frame-roof frame-roof-left" />
            <i className="frame-roof frame-roof-right" />
            <i className="frame-post frame-post-left" />
            <i className="frame-post frame-post-center" />
            <i className="frame-post frame-post-right" />
            <i className="frame-floor" />
          </div>

          <div className={`grow-fixture ${actuatorOn[3] ? 'is-on' : ''}`}>
            <div className="grow-light-label">
              <Light size={17} />
              <span>Grow light</span>
              <strong>{feedbackLive ? (actuatorOn[3] ? 'AKTIF' : 'SIAGA') : '--'}</strong>
            </div>
            <div className="grow-lamp"><i /></div>
            <div className="grow-rays"><i /><i /><i /><i /><i /></div>
          </div>

          <div className={`misting-line ${actuatorOn[1] ? 'is-on' : ''}`}>
            <div className="misting-label">
              <Humidity size={16} />
              <span>Misting</span>
              <strong>{feedbackLive ? (actuatorOn[1] ? 'AKTIF' : 'SIAGA') : '--'}</strong>
            </div>
            <div className="mist-pipe" />
            <div className="mist-nozzles" aria-hidden="true">
              {Array.from({ length: 5 }, (_, index) => (
                <span key={index}><i /><em /><b /><b /><b /></span>
              ))}
            </div>
          </div>

          <div className={`exhaust-unit ${actuatorOn[2] ? 'is-on' : ''}`}>
            <div className="fan-shell" aria-hidden="true">
              <div className="fan-blades"><i /><i /><i /><i /></div>
              <span />
            </div>
            <div className="device-caption">
              <span>Exhaust</span>
              <strong>{feedbackLive ? (actuatorOn[2] ? 'AKTIF' : 'SIAGA') : '--'}</strong>
            </div>
          </div>

          <div className="crop-system" aria-hidden="true">
            <div className="crop-row">
              {Array.from({ length: 7 }, (_, index) => (
                <span className="crop-plant" key={index}>
                  <i className="plant-stem" />
                  <b className="plant-leaf leaf-left" />
                  <b className="plant-leaf leaf-right" />
                  <b className="plant-leaf leaf-top" />
                  <em className="plant-cup" />
                  <small className="plant-roots" />
                </span>
              ))}
            </div>
            <div className="nft-channel"><i /></div>
            <span className="crop-caption">NFT cultivation line</span>
          </div>

          <div className={`mix-station ${actuatorOn[0] ? 'is-dosing' : ''}`} aria-label="Tandon larutan pekat nutrisi A dan B">
            <span className="mix-title">Nutrisi pekat</span>
            <div className="mix-vessels" aria-hidden="true">
              <div className="mix-vessel mix-a"><i /><strong>A</strong><span>Mix A</span></div>
              <div className="mix-vessel mix-b"><i /><strong>B</strong><span>Mix B</span></div>
            </div>
            <div className="dosing-lines" aria-hidden="true"><i /><i /><b /></div>
          </div>

          <div className={`nutrient-pump ${actuatorOn[0] ? 'is-on' : ''}`}>
            <div className="pump-core" aria-hidden="true"><RainDrop size={23} /></div>
            <div className="device-caption">
              <span>Pompa nutrisi</span>
              <strong>{feedbackLive ? (actuatorOn[0] ? 'AKTIF' : 'SIAGA') : '--'}</strong>
            </div>
          </div>

          <div className={`circulation-route ${actuatorOn[0] ? 'is-on' : ''}`} aria-hidden="true">
            <i /><b />
          </div>

          <div className={`twin-reservoir ${levelAvailable ? '' : 'missing'}`}>
            <div className="reservoir-label">
              <div><Meter size={17} /><span>Tandon nutrisi</span></div>
              <strong>{levelAvailable ? `${formatReading(safeLevel)}%` : 'N/A'}</strong>
            </div>
            <div className="twin-tank">
              <div className="twin-water" style={{ transform: `scaleY(${safeLevel / 100})` }}><i /></div>
              <div className="tank-guides" aria-hidden="true"><i /><i /><i /></div>
              <span>{levelState}</span>
            </div>
            <p>{deviceOnline ? 'Level sensor langsung' : 'Pembacaan terakhir'}</p>
          </div>
        </div>

        <div className="twin-actuator-ledger" aria-label="Status aktuator aktual">
          {actuatorDefinitions.map(({ label, className, icon: ActuatorIcon }, index) => {
            const on = actuatorOn[index]
            return (
              <div className={`twin-actuator-state ${className} ${on ? 'is-on' : ''}`} key={label}>
                <ActuatorIcon size={19} />
                <span>{label}</span>
                <strong>{feedbackLive ? (on ? 'ON' : 'OFF') : 'N/A'}</strong>
              </div>
            )
          })}
        </div>
      </div>
    </article>
  )
}
