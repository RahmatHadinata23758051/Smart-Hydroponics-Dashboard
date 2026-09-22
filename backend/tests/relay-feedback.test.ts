import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mqttService } from '../src/services/mqtt.service.js';
import { ActuatorService } from '../src/services/actuator.service.js';
import { sqliteRepo } from '../src/database/sqlite.js';
import { influxService } from '../src/database/influx.js';

const incoming = (topic: string, payload: object | string, retained = false) => {
  const service = mqttService as unknown as {
    handleIncomingMessage: (topic: string, payload: string, retained: boolean) => void;
  };
  service.handleIncomingMessage(topic, typeof payload === 'string' ? payload : JSON.stringify(payload), retained);
};

const heartbeat = { status: 'online', uptime_s: 10, rssi: -40, heap: 100000,
  bus_tx: 100, bus_err: 0, bus_err_pct: 0, maint: 0 };

const telemetry = (relay: number[]) => ({
  air_t: 27,
  air_rh: 70,
  lux: 1000,
  ec: 1200,
  tds: 600,
  ph: 6,
  water_t: 25,
  dist_mm: 120,
  level_pct: 80,
  relay,
});

describe('relay feedback safety', () => {
  beforeEach(() => {
    mqttService.latestTelemetry = null;
    mqttService.latestDeviceStatus = null;
    mqttService.latestRelayState = {
      relay1: 'OFF', relay2: 'OFF', relay3: 'OFF', relay4: 'OFF',
    };
    mqttService.relayStateReceived = false;
    Object.assign(mqttService, {
      isConnected: false, lastMainTelemetryAt: 0, lastMainHeartbeatAt: 0,
      relayFeedbackKnown: [false, false, false, false],
    });
    vi.spyOn(sqliteRepo, 'insertSystemEvent').mockImplementation(() => undefined);
    vi.spyOn(sqliteRepo, 'insertRelayLog').mockImplementation(() => undefined);
    vi.spyOn(influxService, 'writeTelemetry').mockImplementation(() => undefined);
    vi.spyOn(influxService, 'writeHeartbeat').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('does not interpret an ambiguous relay event as ON', () => {
    incoming('hydroponik/unit01/event', { kind: 'relay', detail: 'pompa_nutrisi', ts: 1 });
    expect(mqttService.latestRelayState.relay1).toBe('OFF');
    expect(mqttService.relayStateReceived).toBe(false);
  });

  it('locks control after an ambiguous automatic relay transition until fresh telemetry', () => {
    mqttService.updateRelayState(3, 'ON');
    incoming('hydroponik/unit01/event', { kind: 'relay', detail: 'exhaust_fan', ts: 1 });
    expect(mqttService.latestRelayState.relay3).toBe('ON');
    expect(mqttService.relayStateReceived).toBe(false);
  });

  it('uses an explicit firmware OFF event to restore known feedback', () => {
    incoming('hydroponik/unit01/telemetry', telemetry([1, 0, 0, 0]));
    incoming('hydroponik/unit01/event', { kind: 'relay', detail: 'pompa_nutrisi', ts: 1 });
    expect(mqttService.relayStateReceived).toBe(false);
    incoming('hydroponik/unit01/event', { kind: 'manual_off', detail: 'pompa_nutrisi', ts: 2 });
    expect(mqttService.latestRelayState.relay1).toBe('OFF');
    expect(mqttService.relayStateReceived).toBe(true);
  });

  it('does not unlock all controls when another relay still has ambiguous feedback', () => {
    incoming('hydroponik/unit01/telemetry', telemetry([1, 0, 1, 0]));
    incoming('hydroponik/unit01/event', { kind: 'relay', detail: 'pompa_nutrisi', ts: 1 });
    incoming('hydroponik/unit01/event', { kind: 'relay', detail: 'exhaust_fan', ts: 2 });
    incoming('hydroponik/unit01/event', { kind: 'manual_off', detail: 'pompa_nutrisi', ts: 3 });
    expect(mqttService.latestRelayState.relay1).toBe('OFF');
    expect(mqttService.relayStateReceived).toBe(false);
  });

  it('does not claim a relay is ON merely because the command was dispatched', () => {
    vi.spyOn(mqttService, 'publish').mockReturnValue(true);
    expect(ActuatorService.sendRelayCommand(1, 'ON')).toBe(true);
    expect(mqttService.latestRelayState.relay1).toBe('OFF');
    expect(mqttService.relayStateReceived).toBe(false);
  });

  it('lets physical telemetry override the prior state immediately', () => {
    mqttService.updateRelayState(1, 'ON');
    incoming('hydroponik/unit01/telemetry', telemetry([0, 0, 0, 0]));
    expect(mqttService.latestRelayState.relay1).toBe('OFF');
    expect(mqttService.latestTelemetry?.relay[0]).toBe(0);
  });

  it('ignores buffered historic events when determining current relay state', () => {
    incoming('hydroponik/unit01/event', {
      kind: 'manual_on', detail: 'pompa_nutrisi', ts: 1, buffered: true,
    });
    expect(mqttService.latestRelayState.relay1).toBe('OFF');
  });

  it('does not equate returning to automatic mode with all relays being OFF', () => {
    mqttService.updateRelayState(3, 'ON');
    incoming('hydroponik/unit01/event', { kind: 'manual_auto', detail: '', ts: 1 });
    expect(mqttService.latestRelayState.relay3).toBe('ON');
  });

  it('does not accept a legacy device status as the main controller status', () => {
    incoming('polinela/lab/relay/status', 'online');
    expect(mqttService.latestDeviceStatus).toBeNull();
  });

  it('does not accept legacy relay states as feedback for the main controller', () => {
    incoming('polinela/lab/relay/1/state', 'ON');
    expect(mqttService.latestRelayState.relay1).toBe('OFF');
    expect(mqttService.relayStateReceived).toBe(false);
  });

  it('does not mix legacy sensor packets into fresh main telemetry', () => {
    incoming('hydroponik/unit01/telemetry', telemetry([1, 0, 0, 0]));
    incoming('polinela/lab/sensor1', { temp: 99, hum: 99 });
    expect(mqttService.latestTelemetry?.air_t).toBe(27);
    expect(mqttService.latestTelemetry?.relay_known).toBe(true);
  });

  it('never marks legacy sensor-only data as known relay feedback', () => {
    incoming('polinela/lab/sensor1', { temp: 27, hum: 70 });
    expect(mqttService.latestTelemetry?.relay_known).toBe(false);
    expect(mqttService.relayStateReceived).toBe(false);
  });

  it('requires non-retained main heartbeat and recent telemetry before commands are allowed', () => {
    Object.assign(mqttService, { isConnected: true });
    incoming('hydroponik/unit01/status', heartbeat, true);
    incoming('hydroponik/unit01/telemetry', telemetry([0, 0, 0, 0]));
    expect(mqttService.isControllerReady()).toBe(false);

    incoming('hydroponik/unit01/status', heartbeat);
    expect(mqttService.isControllerReady()).toBe(true);

    Object.assign(mqttService, { lastMainHeartbeatAt: Date.now() - 151_000 });
    expect(mqttService.isControllerReady()).toBe(false);
  });

  it('sends explicit OFF commands rather than automatic mode for all OFF', () => {
    const publish = vi.spyOn(mqttService, 'publish').mockReturnValue(true);
    expect(ActuatorService.sendAllRelayCommand('OFF')).toBe(true);
    expect(publish.mock.calls.map(([topic, payload]) => [topic, payload])).toEqual([
      ['hydroponik/unit01/cmd', 'r1off'],
      ['hydroponik/unit01/cmd', 'r2off'],
      ['hydroponik/unit01/cmd', 'r3off'],
      ['hydroponik/unit01/cmd', 'r4off'],
    ]);
    expect(mqttService.relayStateReceived).toBe(false);
  });
});
