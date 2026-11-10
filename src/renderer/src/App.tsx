import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AppInfo, BuiltInPreset, BundledSoundFont } from '@core/contracts/api';
import type { PresetDocument } from '@core/arrangement';
import { compileTimeline } from '@core/compiler';
import { MAX_TEMPO_BPM, MIN_TEMPO_BPM } from '@core/scheduler';
import { sessionFromPreset, SCALE_TYPE_NAMES, SCALE_TYPES, TONIC_LETTERS } from '@core/session';
import type { ScaleType } from '@core/theory';
import type { Letter } from '@core/theory';

import { PlaybackController } from './playback-controller';
import timerWorkerUrl from '../../audio/worker-timer.worker?worker&url';
import synthWorkletUrl from '../../audio/synth-worklet?worker&url';

declare global {
  interface Window {
    practicePlayer?: {
      getAppInfo(): Promise<AppInfo>;
      getBundledSoundFonts(): Promise<readonly BundledSoundFont[]>;
      getBuiltInPresets(): Promise<readonly BuiltInPreset[]>;
      setPowerSaveBlocker(active: boolean): Promise<void>;
    };
  }
}

/** The state the UI shows while the playback is running. */
interface PlaybackState {
  /** The bar the playback is at, or null during the count-in. */
  readonly bar: number | null;
  /** The beat the playback is at, or null during the count-in. */
  readonly beat: number | null;
  /** True while the count-in is running. */
  readonly countIn: boolean;
  /** How many events were scheduled. */
  readonly eventsScheduled: number;
  /** How many events were dispatched late. */
  readonly lateEvents: number;
}

const IDLE_STATE: PlaybackState = {
  bar: null,
  beat: null,
  countIn: false,
  eventsScheduled: 0,
  lateEvents: 0,
};

export function App(): React.JSX.Element {
  const [appInfo, setAppInfo] = useState<string>('Loading…');
  const [presets, setPresets] = useState<readonly BuiltInPreset[]>([]);
  const [soundFonts, setSoundFonts] = useState<readonly BundledSoundFont[]>([]);
  const [presetId, setPresetId] = useState<string>('r1');
  const [tonic, setTonic] = useState<Letter>('C');
  const [scaleType, setScaleType] = useState<ScaleType>('mixolydian');
  const [tempoBpm, setTempoBpm] = useState<number>(120);
  const [status, setStatus] = useState<string>('Ready');
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playback, setPlayback] = useState<PlaybackState>(IDLE_STATE);

  const controllerRef = useRef<PlaybackController | null>(null);

  // Load the app information, the preset library and the bundled fonts.
  useEffect(() => {
    let cancelled = false;

    void window.practicePlayer?.getAppInfo().then((info) => {
      if (!cancelled) {
        setAppInfo(`${info.name} ${info.version}`);
      }
    });

    void window.practicePlayer?.getBuiltInPresets().then((library) => {
      if (!cancelled) {
        setPresets(library);
      }
    });

    void window.practicePlayer?.getBundledSoundFonts().then((fonts) => {
      if (!cancelled) {
        setSoundFonts(fonts);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // The power-save blocker is active only while the app is playing.
  useEffect(() => {
    void window.practicePlayer?.setPowerSaveBlocker(playing);
  }, [playing]);

  // The controller is disposed when the component goes away.
  useEffect(
    () => () => {
      controllerRef.current?.dispose();
      controllerRef.current = null;
    },
    [],
  );

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === presetId) ?? presets[0],
    [presets, presetId],
  );

  const handlePlay = useCallback(async () => {
    if (selectedPreset === undefined) {
      setError('No preset is available.');
      return;
    }

    setError(null);
    setStatus('Loading the sound banks…');

    try {
      const preset = await loadPresetDocument(selectedPreset);
      const session = sessionFromPreset({
        preset,
        tonic,
        scaleType,
        tempoBpm,
      });
      const timeline = compileTimeline(session);

      const controller = new PlaybackController({
        timeline,
        timerWorkerUrl,
        workletUrl: synthWorkletUrl,
        banks: soundFonts.map((font) => ({ part: font.part, url: font.url })),
        onError: (message) => setError(message),
        onPosition: (position) =>
          setPlayback({
            bar: position.bar,
            beat: position.beat,
            countIn: position.countIn,
            eventsScheduled: position.metrics.eventsScheduled,
            lateEvents: position.metrics.lateEvents,
          }),
      });

      controllerRef.current?.dispose();
      controllerRef.current = controller;

      await controller.play();
      setPlaying(true);
      setStatus('Playing');
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setStatus('Could not start the playback');
    }
  }, [scaleType, selectedPreset, soundFonts, tempoBpm, tonic]);

  const handleStop = useCallback(() => {
    controllerRef.current?.stop();
    setPlaying(false);
    setPlayback(IDLE_STATE);
    setStatus('Stopped');
  }, []);

  const positionText =
    playback.countIn || playback.bar === null
      ? 'Count-in'
      : `Bar ${playback.bar}, beat ${playback.beat ?? 1}`;

  return (
    <main className="app-shell">
      <h1 className="app-title">PracticePlayer</h1>
      <p className="app-subtitle">Chord progression practice and improvisation backing track.</p>

      <section className="controls" aria-label="Playback settings">
        <label className="control">
          <span className="control-label">Key</span>
          <select
            aria-label="Key"
            value={tonic}
            onChange={(event) => setTonic(event.target.value as Letter)}
          >
            {TONIC_LETTERS.map((letter) => (
              <option key={letter} value={letter}>
                {letter}
              </option>
            ))}
          </select>
        </label>

        <label className="control">
          <span className="control-label">Scale</span>
          <select
            aria-label="Scale"
            value={scaleType}
            onChange={(event) => setScaleType(event.target.value as ScaleType)}
          >
            {SCALE_TYPES.map((type) => (
              <option key={type} value={type}>
                {SCALE_TYPE_NAMES[type]}
              </option>
            ))}
          </select>
        </label>

        <label className="control">
          <span className="control-label">Tempo</span>
          <input
            aria-label="Tempo"
            type="number"
            min={MIN_TEMPO_BPM}
            max={MAX_TEMPO_BPM}
            value={tempoBpm}
            onChange={(event) => setTempoBpm(Number(event.target.value))}
          />
          <span className="control-unit">BPM</span>
        </label>

        <label className="control">
          <span className="control-label">Preset</span>
          <select
            aria-label="Preset"
            value={selectedPreset?.id ?? ''}
            onChange={(event) => setPresetId(event.target.value)}
          >
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="transport" aria-label="Transport">
        <button type="button" className="play-button" onClick={() => void handlePlay()}>
          {playing ? 'Playing…' : 'Play'}
        </button>
        <button type="button" onClick={handleStop} disabled={!playing}>
          Stop
        </button>
        <p className="position" data-testid="playback-position">
          {positionText}
        </p>
      </section>

      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <p className="app-status" data-testid="app-version">
        {appInfo}
      </p>
      <p className="app-status" data-testid="playback-status">
        {status}
      </p>
      <p className="app-status" data-testid="playback-metrics">
        Scheduled {playback.eventsScheduled}, late {playback.lateEvents}
      </p>
    </main>
  );
}

/**
 * Loads a preset's document.
 *
 * The built-in presets ship as JSON files next to the index; the renderer
 * reads them through the same asset protocol the fonts use.
 */
async function loadPresetDocument(preset: BuiltInPreset): Promise<PresetDocument> {
  const response = await fetch(preset.url);
  if (!response.ok) {
    throw new Error(`The preset "${preset.name}" could not be loaded (${response.status})`);
  }
  return (await response.json()) as PresetDocument;
}
