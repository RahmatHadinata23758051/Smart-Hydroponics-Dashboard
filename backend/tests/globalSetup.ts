import fs from 'node:fs';
import path from 'node:path';

const testDatabase = path.resolve(process.cwd(), 'data/hydro.test.db');

export default function setup() {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    fs.rmSync(`${testDatabase}${suffix}`, { force: true });
  }
}
