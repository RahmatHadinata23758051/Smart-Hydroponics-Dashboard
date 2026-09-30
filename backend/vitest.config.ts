import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      INFLUX_TOKEN: '',
      SQLITE_DB_PATH: './data/hydro.test.db',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'test-only-password',
      AUTH_SECRET: 'test-only-auth-secret',
      MQTT_USERNAME: 'test-only-user',
      MQTT_PASSWORD: 'test-only-password',
    },
    fileParallelism: false,
    globalSetup: ['./tests/globalSetup.ts'],
  },
});
