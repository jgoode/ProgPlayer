/**
 * Unit tests for the resilient MIDI sender of Spike S2.
 *
 * The sender is the boundary between the scheduler and the operating system's
 * MIDI driver. The behaviour that matters for the app:
 *
 * - a message that cannot be sent must not throw and must not stop the
 *   schedule (NFR-REL-2 — a device can be unplugged at any moment);
 * - the failure must be counted and reported, so the spike can tell the
 *   difference between "the driver was late" and "the device vanished".
 */

import { describe, expect, it } from 'vitest';

import {
  ResilientMidiSender,
  type SendablePort,
  type SendResult,
} from '../../spikes/s2/renderer/send';

interface FakePort extends SendablePort {
  sent: Array<{ data: number[]; timestamp: number | undefined }>;
  state: string;
}

function fakePort(state = 'connected'): FakePort {
  return {
    state,
    sent: [],
    send(data: number[], timestamp?: number): void {
      this.sent.push({ data: [...data], timestamp });
    },
  };
}

describe('resilient MIDI sender', () => {
  it('passes the message and the intended timestamp to the port', () => {
    const port = fakePort();
    const sender = new ResilientMidiSender({ port, onError: () => {} });

    const result = sender.send([0x90, 60, 100], 1234.5);

    expect(result.outcome).toBe('sent');
    expect(port.sent).toHaveLength(1);
    expect(port.sent[0]?.data).toEqual([0x90, 60, 100]);
    expect(port.sent[0]?.timestamp).toBe(1234.5);
  });

  it('drops the message without throwing when the port has disconnected', () => {
    const port = fakePort('disconnected');
    const errors: string[] = [];
    const sender = new ResilientMidiSender({ port, onError: (m) => errors.push(m) });

    const result = sender.send([0xf8], 1000);

    expect(result.outcome).toBe('port-disconnected');
    expect(port.sent).toHaveLength(0);
    expect(sender.disconnectedCount).toBe(1);
    // A disconnected port is an expected condition, not an error to report.
    expect(errors).toHaveLength(0);
  });

  it('keeps working after the port disconnects', () => {
    const port = fakePort();
    const sender = new ResilientMidiSender({ port, onError: () => {} });

    expect(sender.send([0xf8], 1000).outcome).toBe('sent');
    port.state = 'disconnected';
    expect(sender.send([0xf8], 1100).outcome).toBe('port-disconnected');
    expect(sender.send([0xf8], 1200).outcome).toBe('port-disconnected');
    expect(sender.disconnectedCount).toBe(2);
    expect(sender.failedCount).toBe(0);
  });

  it('records an exception from the port instead of propagating it', () => {
    const errors: string[] = [];
    const port: SendablePort = {
      state: 'connected',
      send(): void {
        throw new Error('device disappeared');
      },
    };
    const sender = new ResilientMidiSender({ port, onError: (m) => errors.push(m) });

    const result = sender.send([0x90, 60, 100], 2500);

    expect(result.outcome).toBe('send-failed');
    expect(result.error).toBe('device disappeared');
    expect(sender.failedCount).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('2500.000 ms');
    expect(errors[0]).toContain('device disappeared');
  });

  it('reports a missing port separately from a disconnected one', () => {
    const sender = new ResilientMidiSender({ port: null, onError: () => {} });

    const result = sender.send([0xf8], 1000);

    // There was never a port, so nothing was lost by a device disappearing.
    expect(result.outcome).toBe('no-port');
    expect(sender.disconnectedCount).toBe(0);
    expect(sender.failedCount).toBe(0);
  });

  it('counts every outcome separately', () => {
    const results: SendResult[] = [];
    const port = fakePort();
    const sender = new ResilientMidiSender({
      port,
      onError: () => {},
    });

    results.push(sender.send([0xf8], 100));
    port.state = 'disconnected';
    results.push(sender.send([0xf8], 200));

    expect(results.map((r) => r.outcome)).toEqual(['sent', 'port-disconnected']);
    expect(sender.disconnectedCount).toBe(1);
    expect(sender.failedCount).toBe(0);
  });
});
