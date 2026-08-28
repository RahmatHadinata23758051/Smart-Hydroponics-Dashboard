import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../core/logger.js';
import { mqttService } from '../services/mqtt.service.js';

export class SocketGateway {
  private io: SocketIOServer;

  constructor(server: HttpServer) {
    this.io = new SocketIOServer(server, {
      cors: {
        origin: env.CORS_ORIGIN,
        methods: ['GET', 'POST'],
      },
    });

    this.initSocketEvents();
    this.initMqttBridge();
  }

  private initSocketEvents() {
    this.io.on('connection', (socket: Socket) => {
      logger.info(`⚡ Web Client connected: ${socket.id} (Total: ${this.io.engine.clientsCount})`);

      // Kirim snapshot kondisi data terkini ke client yang baru terkoneksi
      if (mqttService.latestTelemetry) {
        socket.emit('telemetry:live', mqttService.latestTelemetry);
      }
      if (mqttService.latestDeviceStatus) {
        socket.emit('status:live', mqttService.latestDeviceStatus);
      }
      socket.emit('relay:state', mqttService.latestRelayState);

      socket.on('disconnect', () => {
        logger.info(`🔌 Web Client disconnected: ${socket.id} (Remaining: ${this.io.engine.clientsCount})`);
      });
    });
  }

  private initMqttBridge() {
    mqttService.subscribeEvents((channel, payload) => {
      switch (channel) {
        case 'telemetry':
          this.io.emit('telemetry:live', payload);
          break;
        case 'status':
          this.io.emit('status:live', payload);
          break;
        case 'relay_state':
          this.io.emit('relay:state', payload);
          break;
        case 'alarm':
          this.io.emit('alarm:new', payload);
          break;
        case 'event':
          this.io.emit('event:new', payload);
          break;
        case 'device_lwt':
          this.io.emit('device:lwt', payload);
          break;
      }
    });
  }

  public getConnectedClientsCount(): number {
    return this.io.engine.clientsCount;
  }
}
