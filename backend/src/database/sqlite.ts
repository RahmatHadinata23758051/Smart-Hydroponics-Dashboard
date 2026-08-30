import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env.js';
import { logger } from '../core/logger.js';
import {
  TelemetryPayload,
  AlarmLogRecord,
  RelayLogRecord,
  SystemEventRecord
} from '../types/telemetry.js';

// Pastikan direktori database ada
const dbDir = path.dirname(env.SQLITE_FULL_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db: DatabaseType = new Database(env.SQLITE_FULL_PATH);

// Aktifkan WAL mode untuk konkurensi read/write tinggi
db.pragma('journal_mode = WAL');

// Inisialisasi skema tabel
export function initSQLiteSchema() {
  logger.info(`Initialising SQLite database at: ${env.SQLITE_FULL_PATH}`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS telemetry_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      ip TEXT,
      air_t REAL,
      air_rh REAL,
      lux REAL,
      ec REAL,
      tds REAL,
      ph REAL,
      water_t REAL,
      dist_mm REAL,
      level_pct REAL,
      relay1 INTEGER DEFAULT 0,
      relay2 INTEGER DEFAULT 0,
      relay3 INTEGER DEFAULT 0,
      relay4 INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON telemetry_records(timestamp);
    CREATE INDEX IF NOT EXISTS idx_telemetry_created_at ON telemetry_records(created_at);

    CREATE TABLE IF NOT EXISTS alarms_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      level TEXT NOT NULL,
      state TEXT NOT NULL,
      description TEXT,
      triggered_at TEXT NOT NULL,
      cleared_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_alarms_code ON alarms_history(code);
    CREATE INDEX IF NOT EXISTS idx_alarms_state ON alarms_history(state);

    CREATE TABLE IF NOT EXISTS relay_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel INTEGER NOT NULL,
      relay_name TEXT NOT NULL,
      action TEXT NOT NULL,
      source TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS system_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      detail TEXT NOT NULL,
      is_buffered INTEGER DEFAULT 0,
      timestamp TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  logger.info('SQLite schema initialised successfully.');
}

// ---------------------------------------------------- Repository Methods
export const sqliteRepo = {
  // Telemetri
  insertTelemetry: (t: TelemetryPayload) => {
    const stmt = db.prepare(`
      INSERT INTO telemetry_records (
        timestamp, ip, air_t, air_rh, lux, ec, tds, ph, water_t, dist_mm, level_pct,
        relay1, relay2, relay3, relay4
      ) VALUES (
        @timestamp, @ip, @air_t, @air_rh, @lux, @ec, @tds, @ph, @water_t, @dist_mm, @level_pct,
        @relay1, @relay2, @relay3, @relay4
      )
    `);

    stmt.run({
      timestamp: t.timestamp,
      ip: t.ip,
      air_t: t.air_t,
      air_rh: t.air_rh,
      lux: t.lux,
      ec: t.ec,
      tds: t.tds,
      ph: t.ph,
      water_t: t.water_t,
      dist_mm: t.dist_mm,
      level_pct: t.level_pct,
      relay1: t.relay[0] ? 1 : 0,
      relay2: t.relay[1] ? 1 : 0,
      relay3: t.relay[2] ? 1 : 0,
      relay4: t.relay[3] ? 1 : 0,
    });
  },

  getLatestTelemetry: (): TelemetryPayload | null => {
    const row = db.prepare(`
      SELECT * FROM telemetry_records ORDER BY id DESC LIMIT 1
    `).get() as any;

    if (!row) return null;

    return {
      timestamp: row.timestamp,
      ip: row.ip,
      air_t: row.air_t,
      air_rh: row.air_rh,
      lux: row.lux,
      ec: row.ec,
      tds: row.tds,
      ph: row.ph,
      water_t: row.water_t,
      dist_mm: row.dist_mm,
      level_pct: row.level_pct,
      relay: [row.relay1, row.relay2, row.relay3, row.relay4],
    };
  },

  getTelemetryHistory: (limit = 100, offset = 0) => {
    return db.prepare(`
      SELECT * FROM telemetry_records ORDER BY id DESC LIMIT ? OFFSET ?
    `).all(limit, offset);
  },

  getTelemetryRange: (from: string, to: string) => {
    // Normalisasi format pencarian untuk mengakomodasi format ISO dan space-separated
    const fromSpace = from.includes('T') ? from.replace('T', ' ').slice(0, 19) : from;
    const toSpace = to.includes('T') ? to.replace('T', ' ').slice(0, 19) : to;
    const fromIso = from.includes('T') ? from : from.replace(' ', 'T') + 'Z';
    const toIso = to.includes('T') ? to : to.replace(' ', 'T') + 'Z';

    return db.prepare(`
      SELECT * FROM telemetry_records
      WHERE (timestamp BETWEEN ? AND ?) OR (timestamp BETWEEN ? AND ?)
      ORDER BY timestamp ASC, id ASC
    `).all(fromSpace, toSpace, fromIso, toIso);
  },

  // Alarms
  insertAlarm: (alarm: { code: string; level: 'critical' | 'warning'; state: 'active' | 'clear'; description: string; timestamp: string }) => {
    if (alarm.state === 'active') {
      const stmt = db.prepare(`
        INSERT INTO alarms_history (code, level, state, description, triggered_at)
        VALUES (?, ?, 'active', ?, ?)
      `);
      stmt.run(alarm.code, alarm.level, alarm.description, alarm.timestamp);
    } else {
      // Resolve active alarm
      const stmt = db.prepare(`
        UPDATE alarms_history
        SET state = 'clear', cleared_at = ?
        WHERE code = ? AND state = 'active'
      `);
      stmt.run(alarm.timestamp, alarm.code);
    }
  },

  getAlarms: (limit = 50) => {
    return db.prepare(`
      SELECT * FROM alarms_history ORDER BY id DESC LIMIT ?
    `).all(limit);
  },

  // Relay Logs
  insertRelayLog: (log: RelayLogRecord) => {
    const stmt = db.prepare(`
      INSERT INTO relay_logs (channel, relay_name, action, source, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(log.channel, log.relay_name, log.action, log.source, log.timestamp);
  },

  getRelayLogs: (limit = 50) => {
    return db.prepare(`
      SELECT * FROM relay_logs ORDER BY id DESC LIMIT ?
    `).all(limit);
  },

  // System Events
  insertSystemEvent: (ev: SystemEventRecord) => {
    const stmt = db.prepare(`
      INSERT INTO system_events (kind, detail, is_buffered, timestamp)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(ev.kind, ev.detail, ev.is_buffered ? 1 : 0, ev.timestamp);
  },

  getSystemEvents: (limit = 50) => {
    return db.prepare(`
      SELECT * FROM system_events ORDER BY id DESC LIMIT ?
    `).all(limit);
  }
};
