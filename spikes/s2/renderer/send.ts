/**
 * The MIDI send path of Spike S2, separated from the renderer so it can be
 * unit-tested without a browser.
 *
 * Two things matter here and are easy to get wrong:
 *
 * 1. **A timestamped send must never throw.** The output port can disappear
 *    while the arrangement is playing (the hot-plug probe removes it), and a
 *    device can be unplugged at any moment. A throw would abort the whole
 *    schedule; the requirement is that playback continues on the remaining
 *    outputs (NFR-REL-2).
 * 2. **A message whose intended time has already passed must be counted as
 *    late.** The Chromium MIDI backends clamp a past timestamp to a zero
 *    delay, so the message goes out immediately — that is a timing failure,
 *    not a harmless recovery.
 */

/** The part of `MIDIPort` the sender needs. */
export interface SendablePort {
  readonly state: string;
  send(data: number[], timestamp?: number): void;
}

/** What the sender did with one message. */
export type SendOutcome =
  /** The message was handed to the port. */
  | 'sent'
  /** The port was not connected; the message was dropped. */
  | 'port-disconnected'
  /** The port threw; the message was dropped and the error recorded. */
  | 'send-failed';

/** The result of one send attempt. */
export interface SendResult {
  outcome: SendOutcome;
  /** The error message, for the `send-failed` outcome. */
  error?: string;
}

/** Dependencies of {@link ResilientMidiSender}. */
export interface ResilientSenderOptions {
  /** The output port, or `null` when no port was available. */
  port: SendablePort | null;
  /** Collects the messages that could not be sent. */
  onError: (message: string) => void;
}

/**
 * Sends MIDI messages to a port, tolerating the port disappearing.
 *
 * The class is deliberately tiny: it exists so that the failure behaviour can
 * be tested without a browser or a MIDI device.
 */
export class ResilientMidiSender {
  private readonly options: ResilientSenderOptions;
  private dropped = 0;
  private failed = 0;

  constructor(options: ResilientSenderOptions) {
    this.options = options;
  }

  /** Number of messages dropped because the port was not connected. */
  get disconnectedCount(): number {
    return this.dropped;
  }

  /** Number of messages the port rejected with an exception. */
  get failedCount(): number {
    return this.failed;
  }

  /**
   * Sends one message with the given intended timestamp.
   *
   * `intendedTimeMs` is in the `performance.now()` domain, which is what
   * Web MIDI timestamps use.
   */
  send(data: number[], intendedTimeMs: number): SendResult {
    const port = this.options.port;
    if (!port || port.state !== 'connected') {
      this.dropped += 1;
      return { outcome: 'port-disconnected' };
    }
    try {
      port.send(data, intendedTimeMs);
      return { outcome: 'sent' };
    } catch (error) {
      this.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      this.options.onError(`send failed at ${intendedTimeMs.toFixed(3)} ms: ${message}`);
      return { outcome: 'send-failed', error: message };
    }
  }
}
