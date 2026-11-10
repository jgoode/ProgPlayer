/**
 * The click source (P4.6, FR-PLY-4).
 *
 * The click cannot come from a SoundFont: the bundled piano and bass banks
 * contain no percussion, and the click is a GM percussion note (pitch 37,
 * channel 10) that would need a drum kit the app does not bundle.
 *
 * The click is therefore synthesized directly, in the AudioWorklet, from a
 * short decaying sine. Two pitches are used, so the accented downbeat is
 * distinguishable from the ordinary beats by ear.
 *
 * The module is pure TypeScript with no DOM imports, so the envelope and
 * the pitch selection can be unit tested.
 */

/** The frequency, in hertz, of an accented click. */
export const CLICK_BAR_FREQUENCY = 1_880;

/** The frequency, in hertz, of an ordinary click. */
export const CLICK_BEAT_FREQUENCY = 1_320;

/** How long a click rings, in seconds. */
export const CLICK_DURATION_SECONDS = 0.045;

/** The peak level of a click, in linear amplitude. */
export const CLICK_PEAK_GAIN = 0.5;

/**
 * The click's level envelope.
 *
 * The click is a short, sharp tick: it rises almost instantly and decays
 * exponentially, so it is audible over the chords without masking them.
 *
 * @param t The time since the click started, in seconds.
 * @param duration The click's length, in seconds.
 */
export function clickEnvelope(t: number, duration: number): number {
  if (t < 0 || t >= duration) {
    return 0;
  }
  // A 1 ms attack avoids the click itself being a separate transient.
  const attack = Math.min(1, t / 0.001);
  const decay = Math.exp((-5 * t) / duration);
  return attack * decay;
}

/**
 * The frequency of a click, in hertz.
 *
 * @param accented True for the accented downbeat.
 */
export function clickFrequency(accented: boolean): number {
  return accented ? CLICK_BAR_FREQUENCY : CLICK_BEAT_FREQUENCY;
}
