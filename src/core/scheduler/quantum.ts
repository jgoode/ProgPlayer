/**
 * Render-quantum snapping (P4.6, ADR-0002 §2, gap G-15).
 *
 * The synth engine drains its message queue at the *start* of every render
 * quantum, so a message with an arbitrary target time is dispatched on the
 * first quantum whose clock has reached it — an error of 0…127 frames. The
 * app therefore snaps each event's scheduling time up to the next 128-frame
 * boundary before handing it to the engine, which makes the dispatch error
 * exactly 0 frames.
 *
 * **The snapped target must be computed with the engine's own clock
 * arithmetic.** The engine advances its clock by `quantumFrames *
 * (1 / sampleRate)` once per quantum and accumulates the rounding error of
 * every addition. The natural-looking `currentTime + quanta *
 * (quantumFrames / sampleRate)` computes a different double, which lands a
 * few ULP above the clock the engine actually reaches. The engine's
 * `event.time <= currentTime` test then fails and the event is dispatched a
 * **whole quantum (128 frames) late** — the very error the snap exists to
 * remove. The measured difference is 128.00 frames against 0.00 frames.
 *
 * These helpers replicate the engine's accumulation, so the target is
 * bit-identical to the clock the engine will reach.
 */

/** The Web Audio render quantum, in frames. */
export const RENDER_QUANTUM_FRAMES = 128;

/**
 * The number of render quanta to wait for a lead time expressed in frames.
 *
 * The result is at least one quantum, because an event scheduled at the
 * current instant would be dispatched immediately rather than queued.
 */
export function quantaForLead(leadFrames: number, quantumFrames = RENDER_QUANTUM_FRAMES): number {
  if (quantumFrames <= 0) {
    throw new RangeError('quantumFrames must be positive');
  }
  if (!Number.isFinite(leadFrames)) {
    throw new RangeError('leadFrames must be finite');
  }

  return Math.max(1, Math.ceil(leadFrames / quantumFrames - 1e-9));
}

/**
 * The engine's clock value after `quanta` render quanta.
 *
 * The addition is done one quantum at a time, exactly as the engine does it,
 * so the accumulated rounding error matches.
 */
export function engineClockAfterQuanta(
  currentTime: number,
  quanta: number,
  sampleRate: number,
  quantumFrames = RENDER_QUANTUM_FRAMES,
): number {
  if (sampleRate <= 0) {
    throw new RangeError('sampleRate must be positive');
  }
  if (!Number.isInteger(quanta) || quanta < 0) {
    throw new RangeError('quanta must be a non-negative integer');
  }

  const step = quantumFrames * (1 / sampleRate);
  let time = currentTime;
  for (let index = 0; index < quanta; index += 1) {
    time += step;
  }
  return time;
}

/**
 * The scheduling target for an event that should be dispatched `quanta`
 * render quanta from now.
 *
 * The result is the engine clock at the start of that quantum, so the engine
 * dispatches the event in exactly that quantum — an error of 0 frames.
 */
export function quantumAlignedTarget(
  currentTime: number,
  quanta: number,
  sampleRate: number,
  quantumFrames = RENDER_QUANTUM_FRAMES,
): number {
  return engineClockAfterQuanta(currentTime, quanta, sampleRate, quantumFrames);
}

/**
 * Snaps a frame offset forward to the next render-quantum boundary.
 *
 * An offset that already sits on a boundary is returned unchanged, so the
 * function is idempotent and never pushes an event a whole quantum late.
 */
export function snapFramesToQuantum(
  offsetFrames: number,
  quantumFrames = RENDER_QUANTUM_FRAMES,
): number {
  return quantaForLead(offsetFrames, quantumFrames) * quantumFrames;
}

/**
 * The scheduling offset, in seconds, from an anchor to the next
 * render-quantum boundary. The result is in the range (0, one quantum].
 */
export function quantumAlignedOffset(
  offsetSeconds: number,
  sampleRate: number,
  quantumFrames = RENDER_QUANTUM_FRAMES,
): number {
  const offsetFrames = offsetSeconds * sampleRate;
  const snappedFrames = snapFramesToQuantum(offsetFrames, quantumFrames);
  return snappedFrames / sampleRate;
}
