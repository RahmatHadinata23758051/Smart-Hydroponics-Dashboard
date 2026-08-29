import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      INFLUX_TOKEN: '',
      SQLITE_DB_PATH: './data/hydro.test.db',
    },
    fileParallelism: false,
    globalSetup: ['./tests/globalSetup.ts'],
  },
});
