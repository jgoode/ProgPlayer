/**
 * The scheduler layer: the tick timeline, the transport and the look-ahead
 * scheduler (P4.1-P4.5).
 *
 * Everything here is pure TypeScript: no Electron, DOM, audio or Node
 * imports. The clock and the timer are injected, so the whole layer is
 * testable with a simulated clock.
 */

export * from './midi-message';
export * from './plan';
export * from './quantum';
export * from './scheduler';
export * from './sinks';
export * from './tempo-map';
export * from './transport';
