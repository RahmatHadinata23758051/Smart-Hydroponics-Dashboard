import { InfluxDB, Point, QueryApi, WriteApi } from '@influxdata/influxdb-client';
import { env } from '../config/env.js';
import { logger } from '../core/logger.js';
import { TelemetryPayload, DeviceStatusPayload } from '../types/telemetry.js';
import { sqliteRepo } from './sqlite.js';

const TELEMETRY_FIELDS = [
  'air_t', 'air_rh', 'lux', 'ec', 'tds', 'ph', 'water_t', 'dist_mm', 'level_pct',
] as const;

type TelemetryField = typeof TELEMETRY_FIELDS[number];
type SqliteTelemetryRow = Record<TelemetryField, number | null> & {
  timestamp: string;
  ip: string;
  relay1: number;
  relay2: number;
  relay3: number;
  relay4: number;
};

const DURATION_UNITS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

function durationToMs(value: string, fallback: number) {
  const match = value.trim().match(/^-?(\d+)(s|m|h|d)$/);
  if (!match) return fallback;
  return Number(match[1]) * DURATION_UNITS[match[2]];
}

function parseDbTimestamp(ts: string): number {
  if (!ts) return NaN;
  if (ts.endsWith('Z') || ts.includes('+')) return new Date(ts).getTime();
  if (ts.includes('T')) return new Date(ts + 'Z').getTime();
  return new Date(ts.replace(' ', 'T') + 'Z').getTime();
}

function querySqliteTelemetry(range: string, interval: string) {
  const rangeMs = durationToMs(range, 24 * 3_600_000);
  const intervalMs = Math.max(durationToMs(interval, 5 * 60_000), 1000);
  const now = new Date();
  const from = new Date(now.getTime() - rangeMs);

  const rows = sqliteRepo.getTelemetryRange(
    from.toISOString(),
    now.toISOString(),
  ) as SqliteTelemetryRow[];

  const buckets = new Map<number, {
    timestamp: string;
    ip: string;
    relays: [number, number, number, number];
    totals: Record<TelemetryField, { sum: number; count: number }>;
  }>();

  for (const row of rows) {
    const time = parseDbTimestamp(row.timestamp);
    if (!Number.isFinite(time)) continue;
    const bucketTime = Math.floor(time / intervalMs) * intervalMs;
    let bucket = buckets.get(bucketTime);

    if (!bucket) {
      bucket = {
        timestamp: new Date(bucketTime).toISOString(),
        ip: row.ip,
        relays: [row.relay1, row.relay2, row.relay3, row.relay4],
        totals: Object.fromEntries(
          TELEMETRY_FIELDS.map(field => [field, { sum: 0, count: 0 }]),
        ) as Record<TelemetryField, { sum: number; count: number }>,
      };
      buckets.set(bucketTime, bucket);
    }

    bucket.ip = row.ip || bucket.ip;
    bucket.relays = [row.relay1, row.relay2, row.relay3, row.relay4];
    for (const field of TELEMETRY_FIELDS) {
      const value = row[field];
      if (value === null || value === undefined || !Number.isFinite(Number(value))) continue;
      bucket.totals[field].sum += Number(value);
      bucket.totals[field].count += 1;
    }
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .slice(-720)
    .map(([, bucket]) => ({
      timestamp: bucket.timestamp,
      ip: bucket.ip,
      ...Object.fromEntries(TELEMETRY_FIELDS.map(field => {
        const value = bucket.totals[field];
        return [field, value.count ? value.sum / value.count : null];
      })),
      relay1: bucket.relays[0],
      relay2: bucket.relays[1],
      relay3: bucket.relays[2],
      relay4: bucket.relays[3],
    }));
}

class InfluxService {
  private client: InfluxDB | null = null;
  private writeApi: WriteApi | null = null;
  private queryApi: QueryApi | null = null;
  private isEnabled: boolean = false;

  constructor() {
    this.init();
  }

  private init() {
    if (!env.INFLUX_TOKEN || env.INFLUX_TOKEN.trim() === '') {
      logger.warn('InfluxDB token not set. Telemetry will fall back to SQLite time-series storage.');
      this.isEnabled = false;
      return;
    }

    try {
      this.client = new InfluxDB({ url: env.INFLUX_URL, token: env.INFLUX_TOKEN });
      this.writeApi = this.client.getWriteApi(env.INFLUX_ORG, env.INFLUX_BUCKET, 'ns', {
        writeFailed: (error, _lines, retryAttempts) => {
          logger.warn(`InfluxDB background write failed (attempt ${retryAttempts}): ${error.message}`);
        },
      });
      this.queryApi = this.client.getQueryApi(env.INFLUX_ORG);
      this.isEnabled = true;
      logger.info(`InfluxDB client connected to ${env.INFLUX_URL} (Org: ${env.INFLUX_ORG}, Bucket: ${env.INFLUX_BUCKET})`);
    } catch (err) {
      logger.error('Failed to initialize InfluxDB client. Falling back to SQLite:', err);
      this.isEnabled = false;
    }
  }

  public writeTelemetry(t: TelemetryPayload) {
    // 1. Selalu catat ke SQLite untuk local fast lookup / fallback
    try {
      sqliteRepo.insertTelemetry(t);
    } catch (err) {
      logger.error('Error inserting telemetry to SQLite:', err);
    }

    // 2. Jika InfluxDB aktif, tulis point time-series sebagai Database Utama
    if (!this.isEnabled || !this.writeApi) return;

    try {
      const pointTime = t.timestamp ? new Date(t.timestamp) : new Date();
      const point = new Point('hydro_telemetry')
        .timestamp(Number.isFinite(pointTime.getTime()) ? pointTime : new Date())
        .tag('device_id', 'hydro-s3-01')
        .tag('ip', t.ip || '0.0.0.0');

      if (t.air_t !== null && t.air_t !== undefined) point.floatField('air_t', t.air_t);
      if (t.air_rh !== null && t.air_rh !== undefined) point.floatField('air_rh', t.air_rh);
      if (t.lux !== null && t.lux !== undefined) point.floatField('lux', t.lux);
      if (t.ec !== null && t.ec !== undefined) point.floatField('ec', t.ec);
      if (t.tds !== null && t.tds !== undefined) point.floatField('tds', t.tds);
      if (t.ph !== null && t.ph !== undefined) point.floatField('ph', t.ph);
      if (t.water_t !== null && t.water_t !== undefined) point.floatField('water_t', t.water_t);
      if (t.dist_mm !== null && t.dist_mm !== undefined) point.floatField('dist_mm', t.dist_mm);
      if (t.level_pct !== null && t.level_pct !== undefined) point.floatField('level_pct', t.level_pct);

      if (Array.isArray(t.relay) && t.relay.length === 4) {
        point.intField('relay_pump', t.relay[0] ? 1 : 0);
        point.intField('relay_mist', t.relay[1] ? 1 : 0);
        point.intField('relay_fan', t.relay[2] ? 1 : 0);
        point.intField('relay_light', t.relay[3] ? 1 : 0);
      }

      this.writeApi.writePoint(point);
      this.writeApi.flush().catch((err) => {
        logger.debug('InfluxDB flush warning:', err.message);
      });
    } catch (err) {
      logger.error('Failed to write point to InfluxDB:', err);
    }
  }

  public writeHeartbeat(hb: DeviceStatusPayload) {
    if (!this.isEnabled || !this.writeApi) return;

    try {
      const point = new Point('hydro_heartbeat')
        .timestamp(new Date())
        .tag('device_id', 'hydro-s3-01')
        .tag('status', hb.status)
        .intField('uptime_s', hb.uptime_s)
        .intField('rssi', hb.rssi)
        .intField('heap', hb.heap)
        .intField('bus_tx', hb.bus_tx)
        .intField('bus_err', hb.bus_err)
        .floatField('bus_err_pct', hb.bus_err_pct)
        .intField('maint', hb.maint);

      this.writeApi.writePoint(point);
      this.writeApi.flush().catch((err) => {
        logger.debug('InfluxDB heartbeat flush warning:', err.message);
      });
    } catch (err) {
      logger.error('Failed to write heartbeat to InfluxDB:', err);
    }
  }

  public async queryTelemetry(range: string = '-24h', interval: string = '5m') {
    if (!this.isEnabled || !this.queryApi) {
      return querySqliteTelemetry(range, interval);
    }

    const fluxQuery = `
      from(bucket: "${env.INFLUX_BUCKET}")
        |> range(start: ${range})
        |> filter(fn: (r) => r["_measurement"] == "hydro_telemetry")
        |> aggregateWindow(every: ${interval}, fn: mean, createEmpty: false)
        |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
        |> sort(columns: ["_time"])
    `;

    try {
      const rows: any[] = [];
      await new Promise<void>((resolve, reject) => {
        this.queryApi!.queryRows(fluxQuery, {
          next(row, tableMetadata) {
            const obj = tableMetadata.toObject(row);
            rows.push({
              timestamp: obj._time,
              air_t: obj.air_t ?? null,
              air_rh: obj.air_rh ?? null,
              lux: obj.lux ?? null,
              ec: obj.ec ?? null,
              tds: obj.tds ?? null,
              ph: obj.ph ?? null,
              water_t: obj.water_t ?? null,
              dist_mm: obj.dist_mm ?? null,
              level_pct: obj.level_pct ?? null,
              relay1: obj.relay_pump ? 1 : 0,
              relay2: obj.relay_mist ? 1 : 0,
              relay3: obj.relay_fan ? 1 : 0,
              relay4: obj.relay_light ? 1 : 0,
            });
          },
          error(error) {
            reject(error);
          },
          complete() {
            resolve();
          },
        });
      });

      // Jika InfluxDB berhasil mengembalikan data, langsung gunakan data InfluxDB
      if (rows.length > 0) {
        return rows;
      }

      // Fallback ke SQLite jika InfluxDB baru saja di-deploy dan belum punya histori lama
      return querySqliteTelemetry(range, interval);
    } catch (err) {
      logger.error('Influx query error, falling back to SQLite:', err);
      return querySqliteTelemetry(range, interval);
    }
  }
}

export const influxService = new InfluxService();
