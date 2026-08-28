import { InfluxDB, Point, QueryApi, WriteApi } from '@influxdata/influxdb-client';
import { env } from '../config/env.js';
import { logger } from '../core/logger.js';
import { TelemetryPayload, DeviceStatusPayload } from '../types/telemetry.js';
import { sqliteRepo } from './sqlite.js';

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
      this.writeApi = this.client.getWriteApi(env.INFLUX_ORG, env.INFLUX_BUCKET, 'ns');
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
        .tag('ip', t.ip);

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
      this.writeApi.flush();
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
      this.writeApi.flush();
    } catch (err) {
      logger.error('Failed to write heartbeat to InfluxDB:', err);
    }
  }

  public async queryTelemetry(range: string = '-24h', interval: string = '5m') {
    if (!this.isEnabled || !this.queryApi) {
      // Fallback query to SQLite
      return sqliteRepo.getTelemetryHistory(200);
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
      return sqliteRepo.getTelemetryHistory(200);
    }
  }
}

export const influxService = new InfluxService();
