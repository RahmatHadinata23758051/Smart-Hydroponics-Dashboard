# Smart Hydroponics Monitoring & Control System

Dokumentasi teknis arsitektur perangkat lunak, protokol komunikasi IoT, kamus data sensor, dan panduan pengoperasian sistem monitoring dan kendali hidroponik pintar.

---

## 1. Ikhtisar Sistem

Sistem ini merupakan platform telemetri dan kendali terintegrasi untuk instalasi hidroponik greenhouse. Sistem menghubungkan controller hardware berbasis mikrokontroler ESP32-S3 dengan web dashboard interaktif secara real-time melalui broker MQTT dan WebSocket.

Arsitektur dirancang untuk memisahkan jalur penayangan data cepat (hot path) dengan latensi sub-150 ms dari jalur persistensi data historikal (cold path) menggunakan penyimpanan time-series InfluxDB dan basis data relasional SQLite.

---

## 2. Arsitektur Sistem

```
+-----------------------------------------------------------------------------------+
|                              GREENHOUSE HARDWARE LAYER                            |
|                                                                                   |
|   +---------------------------------------------------------------------------+   |
|   | 7 Sensor Modbus RS-485 RTU (Suhu, RH, Lux, EC, TDS, pH, Jarak Laser mm)  |   |
|   +-------------------------------------+-------------------------------------+   |
|                                         | UART1 (9600 8N1)                        |
|                                         v                                         |
|   +---------------------------------------------------------------------------+   |
|   | Controller ESP32-S3 (HydroController) + Display DWIN HMI 5" (Modbus ID 8)  |   |
|   | 4 Kanal Relay Aktuator (Pompa Nutrisi, Misting, Exhaust Fan, Grow Light)  |   |
|   +-------------------------------------+-------------------------------------+   |
+-----------------------------------------|-----------------------------------------+
                                          | WiFi / TCP
                                          v
+-----------------------------------------------------------------------------------+
|                             MESSAGE BROKER LAYER                                  |
|                     Host: sdp.polinela.ac.id | Port: 1883                         |
|                     Base Topic: hidroponik/lab                                    |
+-----------------------------------------+-----------------------------------------+
                                          |
                +-------------------------+-------------------------+
                | MQTT Ingestion (Sub)                              | Command Dispatch (Pub)
                v                                                   v
+-----------------------------------------------------------------------------------+
|                              BACKEND SERVICE LAYER                                |
|                              (Node.js + TypeScript)                               |
|                                                                                   |
|   +--------------------------+   +--------------------+   +-------------------+   |
|   | MQTT Ingestion Service   |   | Relay Dispatcher   |   | Diagnostics &     |   |
|   | (Parser, Decoder, Cache) |   | (Safety Guard Log) |   | Alarm Engine      |   |
|   +------------+-------------+   +---------+----------+   +---------+---------+   |
|                |                           |                        |             |
|                +---------------------------+------------------------+             |
|                                            |                                      |
|                +---------------------------+------------------------+             |
|                | Hot Path (Live Stream)                             | Cold Path   |
|                v                                                    v             |
|   +--------------------------+                         +----------------------+   |
|   | WebSocket Gateway        |                         | InfluxDB v2          |   |
|   | (Socket.io Server)       |                         | (Time-Series Metric) |   |
|   +------------+-------------+                         +----------+-----------+   |
|                |                                                  |               |
|   +------------+-------------+                         +----------+-----------+   |
|   | REST API Server          |                         | SQLite Database      |   |
|   | (Express Controller)     |                         | (Logs, State, Audit) |   |
|   +------------+-------------+                         +----------------------+   |
+----------------|------------------------------------------------------------------+
                 | WebSocket Events & REST HTTP
                 v
+-----------------------------------------------------------------------------------+
|                              FRONTEND WEB LAYER                                   |
|                          (React 18 + Vite + TypeScript)                           |
|                                                                                   |
|   - Real-time Telemetry Cards (EC, TDS, pH, Suhu Air, Suhu Udara, RH, Lux, Level) |
|   - Time-Series Metric Trend Charts (Recharts Area Gradient)                      |
|   - Visualisasi Volume Tandon Air Dinamis (Reservoir Stage)                       |
|   - Sakelar Kendali Relay Interaktif dengan Umpan Balik Hardware Aktual           |
|   - Diagnostik Status Perangkat (RSSI, Heap, Bus RS-485 Error Rate, Alarms Log)   |
+-----------------------------------------------------------------------------------+
```

---

## 3. Spesifikasi Perangkat Keras & Sensor

Seluruh instrumentasi sensor terhubung melalui jaringan bus industri RS-485 Modbus RTU ke controller ESP32-S3.

| Slave ID | Model Perangkat | Parameter Terukur | Satuan & Skala | Rentang Kerja Valid |
|---|---|---|---|---|
| ID 1 | ASAIR AGH3485 | Suhu Udara, Kelembaban Udara | °C (x10), % (x10) | Suhu: -20 s.d. 70°C, RH: 0–100% |
| ID 2 | Lux Transmitter | Intensitas Cahaya, Suhu, RH | Lux (x1), °C, % | Lux: 0 s.d. 200.000 Lux |
| ID 3 | CWT-TH03S-M | Suhu Udara, Kelembaban Udara | °C (x10), % (x10) | Suhu: -20 s.d. 70°C, RH: 0–100% |
| ID 4 | ECTDS10-ISO | EC Larutan, TDS, Salinitas, Suhu Air | µS/cm (x1), ppm (x1), °C (x100) | EC: 50–5000 µS/cm, Suhu: -5 s.d. 60°C |
| ID 5 | SEN0708 | pH Larutan, Suhu Air Cadangan | pH (x100), °C (x10) | pH: 3.00–11.00, Suhu: -5 s.d. 60°C |
| ID 6 | CWT-THXXS | Kelembaban Udara, Suhu Udara | % (x10), °C (x10) | Suhu: -20 s.d. 70°C, RH: 0–100% |
| ID 7 | WitMotion WT53R-485 | Jarak Laser Permukaan Air Tandon | mm (x1) | 40 s.d. 4000 mm (0% = 800mm, 100% = 150mm) |
| ID 8 | DWIN DMG80480C050 | Layar Sentuh HMI Panel Lapangan | VP 0x5100–0x5800 | Refresh berkala 2 detik |

### Konfigurasi Aktuator Relay

Relay beroperasi dengan logika Active HIGH pada GPIO controller ESP32-S3:

- **Relay 1 (`pompa_nutrisi`):** Batas durasi proteksi hardware maksimum 5 detik (auto-cutoff).
- **Relay 2 (`misting`):** Batas durasi proteksi hardware maksimum 30 detik (auto-cutoff).
- **Relay 3 (`exhaust_fan`):** Batas durasi proteksi hardware maksimum 10 menit (auto-cutoff).
- **Relay 4 (`lampu_grow`):** Kendali manual.

---

## 4. Spesifikasi Protokol & Payload Data MQTT

### 4.1 Parameter Koneksi Broker
- Host: Disetel melalui variabel lingkungan (`MQTT_HOST`)
- Port: `1883` (Standard TCP) / Disetel via `MQTT_PORT`
- Autentikasi: Menggunakan username & password yang dikonfigurasi pada `.env` (`MQTT_USERNAME`, `MQTT_PASSWORD`)
- Base Topic: `hidroponik/lab`
- Relay Topic: `hidroponik/lab/relay`

---

### 4.2 Topik Telemetri Agregat (`hidroponik/lab/telemetry`)
Diterbitkan oleh ESP32 secara berkala setiap 60 detik atau jika terjadi perubahan delta parameter melampaui batas toleransi.

Format Payload (JSON):
```json
{
  "timestamp": "2026-08-28 17:00:00",
  "ip": "192.168.0.180",
  "air_t": 28.5,
  "air_rh": 65.2,
  "lux": 18450,
  "ec": 1820,
  "tds": 910,
  "ph": 6.35,
  "water_t": 26.40,
  "dist_mm": 450,
  "level_pct": 53.8,
  "relay": [0, 0, 1, 0]
}
```

Kamus Field:
- `air_t` (float | null): Suhu udara hasil kalkulasi median dari 4 sensor udara (°C).
- `air_rh` (float | null): Kelembaban relatif udara hasil kalkulasi median (%).
- `lux` (integer | null): Intensitas cahaya matahari / lampu (Lux).
- `ec` (integer | null): Nilai konduktivitas listrik larutan nutrisi (µS/cm).
- `tds` (integer | null): Total zat terlarut hasil kalkulasi EC x 0.50 (ppm).
- `ph` (float | null): Derajat keasaman larutan air (skala 0–14).
- `water_t` (float | null): Suhu air nutrisi (°C).
- `dist_mm` (integer | null): Jarak pembacaan laser dari bibir tandon ke permukaan air (mm).
- `level_pct` (float | null): Persentase volume tandon air (0.0–100.0%).
- `relay` (array[4]): Status logika 4 kanal relay [R1, R2, R3, R4] (0 = OFF, 1 = ON).

---

### 4.3 Topik Sensor Individual
Backend juga mendukung konsumsi data dari topik parsial:
- `hidroponik/lab/sensor1` -> `{"temp": 27.7, "hum": 35.0}`
- `hidroponik/lab/sensor2` -> `{"temp": 28.8, "hum": 35.4}`
- `hidroponik/lab/sensor3` -> `{"tempair": 28.10, "ec": 1800, "salinity": 900, "tds": 900}`
- `hidroponik/lab/sensor4` -> `{"suhu": 29.84, "ph": 6.93, "orp": 15.5}`
- `hidroponik/lab/sensor6` -> `{"jarak": 608, "level": 39}`

---

### 4.4 Topik Heartbeat & Status Sistem (`hidroponik/lab/status`)
Diterbitkan setiap 60 detik dengan flag Retain:
```json
{
  "status": "online",
  "timestamp": "2026-08-28 17:00:00",
  "ip": "192.168.0.180",
  "uptime_s": 86400,
  "rssi": -58,
  "heap": 245120,
  "bus_tx": 5420,
  "bus_err": 18,
  "bus_err_pct": 0.33,
  "maint": 0
}
```

---

### 4.5 Topik Status Relay (`hidroponik/lab/relay/state`)
Umpan balik status fisik relay aktual:
```json
{
  "relay1": "OFF",
  "relay2": "OFF",
  "relay3": "ON",
  "relay4": "OFF",
  "rssi": -58
}
```

---

### 4.6 Topik Perintah Kendali (Web -> Broker -> ESP32)
- `hidroponik/lab/relay/1` s.d. `4`: Mengirim string `"ON"`, `"OFF"`, atau `"TOGGLE"`.
- `hidroponik/lab/relay/all`: Mengirim string `"ON"` atau `"OFF"` ke seluruh kanal serentak.
- `hidroponik/lab/cmd`:
  - `"RESET"`: Melepaskan seluruh relay safety latch dan membersihkan status alarm terkunci.
  - `"MAINT_ON"`: Mengaktifkan mode pemeliharaan (membungkam alarm selama kalibrasi sensor).
  - `"MAINT_OFF"`: Menonaktifkan mode pemeliharaan kembali ke pengawasan normal.

---

## 5. Matriks Ambang Batas & Alarm

| Kode | Kategori | Tingkat | Kondisi Pemicu | Aksi Sistem |
|---|---|---|---|---|
| C01a | Nutrisi | Critical | EC < 50 µS/cm (Probe kering/putus) | Latch alarm, kunci dosing |
| C01b | Nutrisi | Critical | EC > 2800 µS/cm | Latch alarm |
| C02 | Nutrisi | Critical | Lonjakan pembacaan EC > 300 µS/cm | Data ditolak |
| C04 | Aktuator | Critical | Relay ON melampaui batas waktu aman | Force cut-off, latch relay |
| C05 | Suhu Air | Critical | Suhu larutan air > 33.0°C | Latch alarm |
| C06 | Komunikasi | Critical | Sensor Modbus gagal merespons > 5x | Tandai node offline |
| C07 | Komunikasi | Critical | Pembacaan sensor beku/freeze ≥ 60x | Tandai node error |
| C09 | Keasaman | Critical | pH < 4.50 atau pH > 8.00 | Latch alarm |
| C10 | Level Air | Critical | Level air tandon < 10% | Kunci pompa nutrisi |
| W01 | Nutrisi | Warning | EC < 1500 µS/cm | Peringatan nutrisi rendah |
| W02 | Nutrisi | Warning | EC > 2000 µS/cm | Peringatan nutrisi tinggi |
| W03 | Keasaman | Warning | pH < 5.50 | Peringatan larutan asam |
| W04 | Keasaman | Warning | pH > 6.80 | Peringatan larutan basa |
| W06 | Suhu Air | Warning | Suhu air > 30.0°C | Peringatan larutan hangat |
| W07 | Suhu Air | Warning | Suhu air < 18.0°C | Peringatan larutan dingin |
| W08 | Sirkulasi | Warning | Selisih sensor suhu air ID 4 & ID 5 > 1.5°C | Indikasi sirkulasi pompa mati |
| W09 | Iklim | Warning | Suhu udara greenhouse > 32.0°C | Peringatan panas |
| W11 | Iklim | Warning | Kelembaban udara > 85% | Peringatan RH tinggi |
| W12 | Iklim | Warning | Kelembaban udara < 50% | Peringatan RH kering |
| W15 | Komunikasi | Warning | Rasio galat bus RS-485 > 5% | Peringatan interferensi kabel |
| W20 | Level Air | Warning | Level air tandon < 30% | Peringatan isi ulang tandon |

---

## 6. Arsitektur Backend & REST API

Backend dibangun menggunakan Node.js dan TypeScript dengan pola clean service repository.

### Daftar Endpoint REST API:
- `GET /api/v1/health` : Pemeriksaan integritas service backend.
- `GET /api/v1/telemetry/latest` : Mengambil snapshot data telemetri sensor terkini.
- `GET /api/v1/telemetry/history?range=-24h&interval=5m` : Mengambil data time-series teragregasi.
- `GET /api/v1/telemetry/export` : Mengunduh dataset telemetri dalam format CSV.
- `GET /api/v1/relays/state` : Mengambil status logika 4 kanal relay.
- `POST /api/v1/relays/:channel/command` : Mengirim aksi (`ON`, `OFF`, `TOGGLE`) ke relay spesifik.
- `POST /api/v1/relays/all/command` : Mengirim aksi ke seluruh relay serentak.
- `POST /api/v1/system/command` : Mengirim instruksi sistem (`RESET`, `MAINT_ON`, `MAINT_OFF`).
- `GET /api/v1/diagnostics/health` : Mengambil diagnostik hardware, MQTT, dan server.
- `GET /api/v1/alarms` : Riwayat log insiden alarm.
- `GET /api/v1/relays/logs` : Riwayat histori aksi kendali relay.
- `GET /api/v1/events` : Log audit sistem.

### WebSocket Events (Socket.io):
- `telemetry:live` : Siaran data telemetri baru.
- `status:live` : Siaran status heartbeat perangkat keras.
- `relay:state` : Siaran sinkronisasi status relay.
- `alarm:new` : Siaran notifikasi insiden alarm baru.
- `device:lwt` : Siaran deteksi koneksi putus (offline).

---

## 7. Arsitektur Frontend Web Dashboard

Frontend dibangun menggunakan React 18, TypeScript, dan Vite.

Fitur Antarmuka:
1. **Header Real-Time Status:** Menampilkan indikator online/offline perangkat keras dan status transmisi socket LIVE.
2. **Kartu Telemetri Interaktif:** Menampilkan parameter proses dengan validasi status warna otomatis (Normal / Peringatan / Belum Terbaca).
3. **Grafik Tren 24 Jam:** Visualisasi area chart Recharts per parameter sensor dengan gradient styling.
4. **Visualisasi Tandon Nutrisi:** Representasi level air tandon visual dengan persentase ketinggian dinamis, estimasi suhu, dan jarak laser mm.
5. **Panel Kontrol Aktuator:** Switch toggle untuk 4 relay dengan aturan sinkronisasi status konfirmasi fisik hardware.
6. **Panel Diagnostik & Alarm:** Metrik WiFi RSSI, persentase error bus, uptime, serta tabel alarm.

---

## 8. Panduan Menjalankan Sistem

### Kebutuhan Awal
- Node.js versi 18.x atau 20.x LTS
- Koneksi internet / LAN ke broker MQTT `sdp.polinela.ac.id:1883`

### Menjalankan Backend
```powershell
# 1. Masuk ke direktori backend
cd website/backend

# 2. Salin environment configuration
cp .env.example .env

# 3. Pasang dependensi
npm install

# 4. Jalankan pengujian unit & integrasi
npm run test

# 5. Jalankan backend service
npm start
# Atau mode pengembangan dengan auto-reload:
npm run dev
```

Backend akan aktif di `http://localhost:5000`.

### Menjalankan Frontend
```powershell
# 1. Masuk ke direktori frontend
cd website/frontend

# 2. Pasang dependensi
npm install

# 3. Jalankan server pengembangan Vite
npm run dev
```

Dashboard web akan terbuka di `http://localhost:5173`.
Untuk membuat production build frontend:
```powershell
npm run build
```
Hasil kompilasi siap saji akan berada pada folder `website/frontend/dist`.

---

## 8. Deployment Kontainer Menggunakan Docker & Portainer

Project ini telah disiapkan untuk deployment langsung ke **Portainer** atau **Docker Compose**:

### Menjalankan dengan Docker Compose Lokal
```powershell
cd website
docker compose up -d --build
```

### Deployment via Portainer Stack
1. Buka Portainer -> **Stacks** -> **+ Add stack**.
2. Masukkan nama stack (contoh: `hydra-hydroponics`).
3. Pilih **Web editor**, salin konten [`docker-compose.yml`](./docker-compose.yml).
4. Di bagian **Environment variables**, tempel variabel dari [`.env.example`](./.env.example).
5. Klik **Deploy the stack**.

Lihat panduan lengkap langkah demi langkah di [PORTAINER_GUIDE.md](./PORTAINER_GUIDE.md).

