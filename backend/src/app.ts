import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import apiRouter from './routes/api.routes.js';
import { logger } from './core/logger.js';

export const app = express();

// Middlewares
app.use(cors({
  origin: env.CORS_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request Logging
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.url}`);
  next();
});

// API Routes
app.use('/api/v1', apiRouter);

// Root fallback
app.get('/', (req, res) => {
  res.json({
    name: 'Smart Hydroponics IoT Dashboard API',
    version: '1.0.0',
    docs: '/api/v1/health',
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Endpoint not found: ${req.method} ${req.originalUrl}`,
  });
});

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled Express error:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal Server Error',
  });
});
