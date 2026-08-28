import mqtt from 'mqtt';
import { env } from '../src/config/env.js';
import { TelemetryPayload, DeviceStatusPayload } from '../src/types/telemetry.js';

console.log('🤖 Starting ESP32-S3 Hardware Mock Simulator...');
const client = mqtt.connect(`mqtt://${env.MQTT_HOST}:${env.MQTT_PORT}`, {
  clientId: 'esp32-s3-simulator',
  username: env.MQTT_USERNAME,
  password: env.MQTT_PASSWORD,
});

let currentEc = 1800;
let currentPh = 6.2;
let currentAirT = 28.0;
let currentWaterT = 25.5;
let currentLevel = 75.0;
let relayState: [number, number, number, number] = [0, 0, 0, 0];

client.on('connect', () => {
  console.log('✅ Simulator connected to MQTT Broker!');

  // Subscribe ke relay command agar simulator bisa merespons perubahan sakelar dari web
  client.subscribe([
    `${env.MQTT_RELAY_TOPIC}/#`,
    `${env.MQTT_BASE_TOPIC}/cmd`,
  ]);

  // Kirim online status
  client.publish(`${env.MQTT_RELAY_TOPIC}/status`, 'online', { retain: true });

  // Loop telemetri setiap 5 detik (untuk pengujian cepat)
  setInterval(() => {
    // Variasikan nilai secara realistis
    currentEc += (Math.random() - 0.5) * 20;
    currentPh += (Math.random() - 0.5) * 0.05;
    currentAirT += (Math.random() - 0.5) * 0.2;
    currentWaterT += (Math.random() - 0.5) * 0.1;
    const distMm = Math.round(800 - (currentLevel / 100) * (800 - 150));

    const now = new Date();
    const timeStr = now.toISOString().replace('T', ' ').substring(0, 19);

    const tele: TelemetryPayload = {
      timestamp: timeStr,
      ip: '192.168.1.188',
      air_t: Number(currentAirT.toFixed(1)),
      air_rh: Number((70 + Math.random() * 8).toFixed(1)),
      lux: Math.round(15000 + Math.random() * 3000),
      ec: Math.round(currentEc),
      tds: Math.round(currentEc * 0.5),
      ph: Number(currentPh.toFixed(2)),
      water_t: Number(currentWaterT.toFixed(2)),
      dist_mm: distMm,
      level_pct: Number(currentLevel.toFixed(1)),
      relay: relayState,
    };

    client.publish(`${env.MQTT_BASE_TOPIC}/telemetry`, JSON.stringify(tele));
    console.log(`[SIMULATOR TX] Telemetry: EC=${tele.ec} pH=${tele.ph} AirT=${tele.air_t} Level=${tele.level_pct}%`);
  }, 5000);

  // Heartbeat setiap 15 detik
  setInterval(() => {
    const timeStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const hb: DeviceStatusPayload = {
      status: 'online',
      timestamp: timeStr,
      ip: '192.168.1.188',
      uptime_s: Math.round(process.uptime()),
      rssi: Math.round(-60 - Math.random() * 10),
      heap: 220000,
      bus_tx: 1500,
      bus_err: 3,
      bus_err_pct: 0.2,
      maint: 0,
    };
    client.publish(`${env.MQTT_BASE_TOPIC}/status`, JSON.stringify(hb), { retain: true });
    console.log('[SIMULATOR TX] Heartbeat Status online');
  }, 15000);
});

client.on('message', (topic, payload) => {
  const msg = payload.toString().toUpperCase();
  console.log(`[SIMULATOR RX] Topic: ${topic} | Command: ${msg}`);

  for (let i = 1; i <= 4; i++) {
    if (topic === `${env.MQTT_RELAY_TOPIC}/${i}`) {
      const idx = i - 1;
      if (msg === 'ON' || msg === '1' || msg === 'TRUE') relayState[idx] = 1;
      else if (msg === 'OFF' || msg === '0' || msg === 'FALSE') relayState[idx] = 0;
      else if (msg === 'TOGGLE') relayState[idx] = relayState[idx] ? 0 : 1;

      // Publish feedback state
      client.publish(`${env.MQTT_RELAY_TOPIC}/state`, JSON.stringify({
        relay1: relayState[0] ? 'ON' : 'OFF',
        relay2: relayState[1] ? 'ON' : 'OFF',
        relay3: relayState[2] ? 'ON' : 'OFF',
        relay4: relayState[3] ? 'ON' : 'OFF',
        rssi: -65,
      }), { retain: true });
    }
  }

  if (topic === `${env.MQTT_RELAY_TOPIC}/all`) {
    const val = (msg === 'ON' || msg === '1') ? 1 : 0;
    relayState = [val, val, val, val];
    client.publish(`${env.MQTT_RELAY_TOPIC}/state`, JSON.stringify({
      relay1: relayState[0] ? 'ON' : 'OFF',
      relay2: relayState[1] ? 'ON' : 'OFF',
      relay3: relayState[2] ? 'ON' : 'OFF',
      relay4: relayState[3] ? 'ON' : 'OFF',
      rssi: -65,
    }), { retain: true });
  }
});
