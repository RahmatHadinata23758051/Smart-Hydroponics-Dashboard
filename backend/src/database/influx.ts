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

function toLocalSqliteTimestamp(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19).replace('T', ' ');
}

function querySqliteTelemetry(range: string, interval: string) {
  const rangeMs = durationToMs(range, 24 * 3_600_000);
  const intervalMs = Math.max(durationToMs(interval, 5 * 60_000), 1000);
  const now = new Date();
  const from = new Date(now.getTime() - rangeMs);
  const rows = sqliteRepo.getTelemetryRange(
    toLocalSqliteTimestamp(from),
    toLocalSqliteTimestamp(now),
  ) as SqliteTelemetryRow[];

  const buckets = new Map<number, {
    timestamp: string;
    ip: string;
    relays: [number, number, number, number];
    totals: Record<TelemetryField, { sum: number; count: number }>;
  }>();

  for (const row of rows) {
    const time = new Date(row.timestamp.replace(' ', 'T')).getTime();
    if (!Number.isFinite(time)) continue;
    const bucketTime = Math.floor(time / intervalMs) * intervalMs;
    let bucket = buckets.get(bucketTime);

    if (!bucket) {
      bucket = {
        timestamp: toLocalSqliteTimestamp(new Date(bucketTime)),
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
          logger.warn(`InfluxDB background write failed (attempt ${retryAttempts}):`, error.message);
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

    // 2. Jika InfluxDB aktif, tulis point time-series
    if (!this.isEnabled || !this.writeApi) return;

    try {
      const point = new Point('hydro_telemetry')
        .tag('device_id', 'hydro-s3-01')
        .tag('ip', t.ip || '0.0.0.0');

      if (t.air_t !== null) point.floatField('air_t', t.air_t);
      if (t.air_rh !== null) point.floatField('air_rh', t.air_rh);
      if (t.lux !== null) point.floatField('lux', t.lux);
      if (t.ec !== null) point.floatField('ec', t.ec);
      if (t.tds !== null) point.floatField('tds', t.tds);
      if (t.ph !== null) point.floatField('ph', t.ph);
      if (t.water_t !== null) point.floatField('water_t', t.water_t);
      if (t.dist_mm !== null) point.floatField('dist_mm', t.dist_mm);
      if (t.level_pct !== null) point.floatField('level_pct', t.level_pct);

      point.intField('relay_pump', t.relay[0]);
      point.intField('relay_mist', t.relay[1]);
      point.intField('relay_fan', t.relay[2]);
      point.intField('relay_light', t.relay[3]);

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
        |> yield(name: "mean")
    `;

    try {
      const rows: any[] = [];
      await new Promise<void>((resolve, reject) => {
        this.queryApi!.queryRows(fluxQuery, {
          next(row, tableMetadata) {
            rows.push(tableMetadata.toObject(row));
          },
          error(error) {
            reject(error);
          },
          complete() {
            resolve();
          },
        });
      });
      return rows;
    } catch (err) {
      logger.error('Influx query error, falling back to SQLite:', err);
      return querySqliteTelemetry(range, interval);
    }
  }
}

export const influxService = new InfluxService();
