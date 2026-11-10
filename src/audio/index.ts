/**
 * The audio layer (P4.6-P4.8).
 *
 * It hosts the synth sink, the click source and the Worker timer. The
 * layer may import the core, but the core may not import the audio layer:
 * the scheduler is pure TypeScript and knows nothing about Web Audio.
 */

export * from './click-source';
export * from './engine-clock';
export * from './synth-sink';
export * from './worker-timer';
