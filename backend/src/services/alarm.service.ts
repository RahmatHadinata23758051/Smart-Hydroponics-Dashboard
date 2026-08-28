import { AlarmPayload, AlarmLogRecord } from '../types/telemetry.js';
import { sqliteRepo } from '../database/sqlite.js';
import { logger } from '../core/logger.js';

export const ALARM_DESCRIPTIONS: Record<string, { desc: string; level: 'critical' | 'warning' }> = {
  // Critical
  'C01a': { desc: 'EC Sangat Rendah (< 50 uS/cm) - Probe Kering / Putus', level: 'critical' },
  'C01b': { desc: 'EC Sangat Tinggi (> 2800 uS/cm)', level: 'critical' },
  'C02':  { desc: 'Lonjakan EC Drastis - Data Ditolak', level: 'critical' },
  'C04':  { desc: 'Relay Safety Guard Trip - Aktuator Dipaksa Mati', level: 'critical' },
  'C05':  { desc: 'Suhu Larutan Ekstrem (> 33 °C)', level: 'critical' },
  'C06':  { desc: 'Sensor Modbus Tidak Merespons (> 5x Gagal)', level: 'critical' },
  'C07':  { desc: 'Nilai Sensor Beku / Freeze (> 60x Identik)', level: 'critical' },
  'C08':  { desc: 'Pelampung Batas Atas Aktif (Bak Penuh)', level: 'critical' },
  'C09':  { desc: 'pH Larutan Ekstrem (< 4.5 atau > 8.0)', level: 'critical' },
  'C10':  { desc: 'Level Tandon Kritis (< 10%) - Pompa Dikunci', level: 'critical' },

  // Warning
  'W01':  { desc: 'EC di Bawah Target (< 1500 uS/cm)', level: 'warning' },
  'W02':  { desc: 'EC di Atas Target (> 2000 uS/cm)', level: 'warning' },
  'W02b': { desc: 'EC Melebihi Batas (> 2300 uS/cm)', level: 'warning' },
  'W03':  { desc: 'pH Larutan Terlalu Asam (< 5.5)', level: 'warning' },
  'W04':  { desc: 'pH Larutan Terlalu Basa (> 6.8)', level: 'warning' },
  'W06':  { desc: 'Suhu Larutan Hangat (> 30 °C)', level: 'warning' },
  'W07':  { desc: 'Suhu Larutan Dingin (< 18 °C)', level: 'warning' },
  'W08':  { desc: 'Suhu Sensor Air Menyimpang - Dugaan Sirkulasi Mati', level: 'warning' },
  'W09':  { desc: 'Suhu Udara Panas (> 32 °C)', level: 'warning' },
  'W10':  { desc: 'Suhu Udara Sangat Panas (> 35 °C)', level: 'warning' },
  'W11':  { desc: 'Kelembaban Udara Tinggi (> 85%)', level: 'warning' },
  'W12':  { desc: 'Kelembaban Udara Rendah (< 50%)', level: 'warning' },
  'W13':  { desc: 'Selisih Sensor Udara Terlalu Jauh', level: 'warning' },
  'W15':  { desc: 'Rasio Galat Bus RS-485 Tinggi (> 5%)', level: 'warning' },
  'W16':  { desc: 'WiFi Controller Terputus', level: 'warning' },
  'W20':  { desc: 'Level Air Tandon Rendah (< 30%)', level: 'warning' },
};

export class AlarmService {
  public static processAlarm(payload: AlarmPayload) {
    const meta = ALARM_DESCRIPTIONS[payload.code] || {
      desc: `Alarm ${payload.code}`,
      level: payload.level,
    };

    const record: AlarmLogRecord = {
      code: payload.code,
      level: meta.level,
      state: payload.state,
      description: meta.desc,
      triggered_at: new Date(payload.ts > 1000000000000 ? payload.ts : Date.now()).toISOString(),
    };

    logger.warn(`[ALARM ENGINE] Code: ${record.code} | State: ${record.state} | ${record.description}`);
    sqliteRepo.insertAlarm({
      code: record.code,
      level: record.level,
      state: record.state,
      description: record.description,
      timestamp: record.triggered_at,
    });

    return record;
  }
}
