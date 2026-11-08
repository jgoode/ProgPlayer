/**
 * Minimal Web MIDI type declarations for the Spike S2 renderer.
 *
 * TypeScript's `lib.dom.d.ts` does not include the Web MIDI API, so the
 * spike declares the small part of the surface it uses. The declarations
 * follow the Web MIDI specification (W3C) and Chromium's implementation.
 */

interface MIDIPortDeviceState {
  readonly type: 'connected' | 'disconnected';
}

interface MIDIPortType {
  readonly type: 'input' | 'output';
}

interface MIDIConnectionEvent extends Event {
  readonly port: MIDIPort;
}

interface MIDIMessageEvent extends MIDIConnectionEvent {
  readonly data: Uint8Array | null;
  readonly timeStamp: number;
}

interface MIDIPort {
  readonly id: string;
  readonly manufacturer: string | null;
  readonly name: string | null;
  readonly state: MIDIPortDeviceState;
  readonly type: MIDIPortType;
  readonly connection: MIDIPortConnectionState;
  open(): Promise<MIDIPort>;
  close(): Promise<MIDIPort>;
}

interface MIDIPortConnectionState {
  readonly state: 'connected' | 'disconnected';
}

interface MIDIOutput extends MIDIPort {
  send(data: number[] | Uint8Array, timestamp?: number): void;
  clear(): void;
}

interface MIDIInput extends MIDIPort {
  onmidimessage: ((event: MIDIMessageEvent) => void) | null;
}

interface MIDIAccess {
  readonly inputs: MIDIInputMap;
  readonly outputs: MIDIOutputMap;
  readonly sysexEnabled: boolean;
  onstatechange: ((event: MIDIConnectionEvent) => void) | null;
  /** Chromium exposes the raw `MIDIPort` on the state-change event. */
  readonly state: string;
}

interface MIDIPortMap {
  readonly size: number;
  get(id: string): MIDIInput | MIDIOutput | undefined;
  forEach(callback: (port: MIDIInput | MIDIOutput, key: string, parent: MIDIPortMap) => void): void;
}

interface MIDIInputMap extends MIDIPortMap {
  get(id: string): MIDIInput | undefined;
  forEach(callback: (port: MIDIInput, key: string, parent: MIDIInputMap) => void): void;
}

interface MIDIOutputMap extends MIDIPortMap {
  get(id: string): MIDIOutput | undefined;
  forEach(callback: (port: MIDIOutput, key: string, parent: MIDIOutputMap) => void): void;
}

interface Navigator {
  requestMIDIAccess(options?: { sysex?: boolean; software?: boolean }): Promise<MIDIAccess>;
}
