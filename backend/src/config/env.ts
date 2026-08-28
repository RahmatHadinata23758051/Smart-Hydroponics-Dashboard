import dotenv from 'dotenv';
import { z } from 'zod';
import path from 'path';

// Load .env
dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('5000').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().default('*'),

  // MQTT Settings
  MQTT_HOST: z.string().default('sdp.polinela.ac.id'),
  MQTT_PORT: z.string().default('1883').transform(Number),
  MQTT_USERNAME: z.string().default('septa'),
  MQTT_PASSWORD: z.string().default('123321'),
  MQTT_CLIENT_ID: z.string().default(`hydro-backend-${Math.random().toString(16).substring(2, 8)}`),
  MQTT_BASE_TOPIC: z.string().default('polinela/lab'),
  MQTT_RELAY_TOPIC: z.string().default('polinela/lab/relay'),

  // InfluxDB Settings
  INFLUX_URL: z.string().default('http://localhost:8086'),
  INFLUX_TOKEN: z.string().default(''),
  INFLUX_ORG: z.string().default('polinela'),
  INFLUX_BUCKET: z.string().default('hydroponics'),

  // SQLite Settings
  SQLITE_DB_PATH: z.string().default('./data/hydro.db'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables configuration:', parsed.error.format());
  process.exit(1);
}

export const env = {
  ...parsed.data,
  SQLITE_FULL_PATH: path.resolve(process.cwd(), parsed.data.SQLITE_DB_PATH),
};
