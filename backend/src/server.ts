import http from 'http';
import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './core/logger.js';
import { initSQLiteSchema } from './database/sqlite.js';
import { mqttService } from './services/mqtt.service.js';
import { SocketGateway } from './websocket/socket.gateway.js';

async function bootstrap() {
  try {
    logger.info('🚀 Starting Smart Hydroponics Backend Service...');

    // 1. Inisialisasi Database SQLite
    initSQLiteSchema();

    // 2. Inisialisasi HTTP Server & WebSocket
    const server = http.createServer(app);
    const socketGateway = new SocketGateway(server);

    // 3. Inisialisasi MQTT Listener & Broker Connection
    mqttService.init();

    // 4. Start Server Listening
    server.listen(env.PORT, () => {
      logger.info(`🌟 Server is running in ${env.NODE_ENV} mode on port ${env.PORT}`);
      logger.info(`📡 HTTP API: http://localhost:${env.PORT}/api/v1/health`);
      logger.info(`⚡ WebSocket Gateway attached & listening`);
    });

    // Graceful Shutdown
    const shutdown = () => {
      logger.info('🛑 Shutting down gracefully...');
      server.close(() => {
        logger.info('Server closed.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

bootstrap();
