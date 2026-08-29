import { Request, Response } from 'express';
import { mqttService } from '../services/mqtt.service.js';
import { sqliteRepo } from '../database/sqlite.js';
import { influxService } from '../database/influx.js';

const HISTORY_PRESETS: Record<string, string> = {
  '-1h': '1m',
  '-24h': '5m',
  '-30d': '1h',
};

export const telemetryController = {
  getLatest: (req: Request, res: Response) => {
    // Ambil dari in-memory cache atau fallback ke DB
    const data = mqttService.latestTelemetry || sqliteRepo.getLatestTelemetry();

    if (!data) {
      return res.status(200).json({
        success: true,
        data: null,
        message: 'No telemetry data received yet.',
      });
    }

    return res.status(200).json({
      success: true,
      data,
    });
  },

  getHistory: async (req: Request, res: Response) => {
    try {
      const range = (req.query.range as string) || '-24h';
      const interval = (req.query.interval as string) || HISTORY_PRESETS[range];

      if (!HISTORY_PRESETS[range] || interval !== HISTORY_PRESETS[range]) {
        return res.status(400).json({
          success: false,
          error: 'Invalid history range or interval preset.',
          allowed: Object.entries(HISTORY_PRESETS).map(([allowedRange, allowedInterval]) => ({
            range: allowedRange,
            interval: allowedInterval,
          })),
        });
      }

      // Query dari InfluxDB atau SQLite
      const data = await influxService.queryTelemetry(range, interval);

      return res.status(200).json({
        success: true,
        data,
        meta: {
          range,
          interval,
          count: Array.isArray(data) ? data.length : 0,
        },
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: err.message || 'Failed to fetch telemetry history',
      });
    }
  },

  exportCsv: (req: Request, res: Response) => {
    try {
      const from = (req.query.from as string) || new Date(Date.now() - 7 * 86400000).toISOString();
      const to = (req.query.to as string) || new Date().toISOString();

      const rows = sqliteRepo.getTelemetryRange(from, to);

      // Buat CSV string
      const headers = ['ID', 'Timestamp', 'IP', 'Air Temp (C)', 'Air RH (%)', 'Lux', 'EC (uS/cm)', 'TDS (ppm)', 'pH', 'Water Temp (C)', 'Distance (mm)', 'Level (%)', 'Relay Pump', 'Relay Mist', 'Relay Fan', 'Relay Light'];
      
      const csvLines = [headers.join(',')];

      for (const r of rows as any[]) {
        csvLines.push([
          r.id,
          `"${r.timestamp}"`,
          `"${r.ip}"`,
          r.air_t ?? '',
          r.air_rh ?? '',
          r.lux ?? '',
          r.ec ?? '',
          r.tds ?? '',
          r.ph ?? '',
          r.water_t ?? '',
          r.dist_mm ?? '',
          r.level_pct ?? '',
          r.relay1,
          r.relay2,
          r.relay3,
          r.relay4,
        ].join(','));
      }

      const csvContent = csvLines.join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="hydroponics-telemetry-${Date.now()}.csv"`);
      return res.status(200).send(csvContent);
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: err.message || 'Failed to export CSV',
      });
    }
  },
};
