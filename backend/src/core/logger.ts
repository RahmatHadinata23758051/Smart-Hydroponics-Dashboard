// =====================================================================
//  logger.ts — Structured Logger untuk Backend Service
// =====================================================================

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => {
    const ts = new Date().toISOString();
    console.log(`[INFO]  [${ts}] ${msg}`, meta ? JSON.stringify(meta) : '');
  },
  warn: (msg: string, meta?: Record<string, unknown>) => {
    const ts = new Date().toISOString();
    console.warn(`[WARN]  [${ts}] \x1b[33m${msg}\x1b[0m`, meta ? JSON.stringify(meta) : '');
  },
  error: (msg: string, err?: unknown) => {
    const ts = new Date().toISOString();
    console.error(`[ERROR] [${ts}] \x1b[31m${msg}\x1b[0m`, err instanceof Error ? err.stack || err.message : err || '');
  },
  debug: (msg: string, meta?: Record<string, unknown>) => {
    if (process.env.NODE_ENV === 'development') {
      const ts = new Date().toISOString();
      console.debug(`[DEBUG] [${ts}] \x1b[36m${msg}\x1b[0m`, meta ? JSON.stringify(meta) : '');
    }
  }
};
