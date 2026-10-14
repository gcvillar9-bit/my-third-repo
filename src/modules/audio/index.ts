/**
 * audio: procedural WebAudio sound (no audio files). Layers: an ambient pad that crossfades by
 * scale zone, a flight whoosh, atmospheric wind, a black-hole rumble, walk-mode footsteps and an
 * autopilot-arrival chime. The AudioContext is created on the first pointerdown/keydown (autoplay
 * policy), never in test mode unless `?audio=1`, and suspended while muted, at volume 0 or with the
 * tab hidden. Parameters update at most at 20 Hz from render.onAfterFrame.
 */
import {
  MW_FRAME,
  SSB_FRAME,
  type Body,
  type UniverseModule,
  type Vec3d,
  type ViewState,
} from '../../core/contracts';
import { v3len } from '../../core/math64';
import { AudioEngine } from './engine';
import {
  classifyZone,
  densityAt,
  gravityPitch,
  rumbleLevel,
  stepRate,
  whooshParams,
  windParams,
  type FilteredGain,
  type Zone,
  type ZoneInput,
} from './mapping';
import { AUDIO_MODULE_ID, AUDIO_STATE_ATTR } from './public';
import { audible, audioSettingDefs, DEFAULT_AUDIO_PREFS, type AudioPrefs } from './settings';

/** Walk-mode eye height above the ground, m (CONTRACTS: walk mode seats the eye 1.7 m up). */
const EYE_HEIGHT = 1.7;
/** Parameter update period, s (20 Hz). */
const UPDATE_DT = 0.05;
/** Pad crossfade, s, and how long a new zone must hold before it starts. */
const ZONE_FADE_S = 6;
const ZONE_HOLD_S = 1.2;

let disposeImpl: (() => void) | null = null;

const audioModule: UniverseModule = {
  id: AUDIO_MODULE_ID,
  init(ctx) {
    const { registry, render, camera, frames, env } = ctx;
    const prefs: AudioPrefs = { ...DEFAULT_AUDIO_PREFS };
    const hasDom = typeof window !== 'undefined' && typeof document !== 'undefined';
    const AC: typeof AudioContext | undefined = hasDom
      ? (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined;
    const disabled = (env.test && env.params.get('audio') !== '1') || !AC;
    const setState = (s: string) => {
      if (hasDom) document.documentElement.setAttribute(AUDIO_STATE_ATTR, s);
    };

    let engine: AudioEngine | null = null;
    let zone: Zone | null = null;
    let gestured = false;
    const sync = () => {
      if (disabled) {
        setState(env.test ? 'test-off' : 'unsupported');
        return;
      }
      const want = audible(prefs) && !document.hidden;
      if (!engine && want && gestured) {
        try {
          engine = new AudioEngine(new AC!({ latencyHint: 'balanced' }));
        } catch (e) {
          console.warn('[audio] AudioContext unavailable', e);
          return;
        }
        zone = null;
      }
      if (!engine) {
        setState(gestured ? 'suspended' : 'idle');
        return;
      }
      engine.setMaster(prefs.volume, prefs.silence);
      if (want) void engine.ctx.resume().catch(() => undefined);
      else void engine.ctx.suspend().catch(() => undefined);
      setState(want ? 'running' : 'suspended');
    };
    for (const d of audioSettingDefs(prefs, sync)) registry.addSetting(d);
    if (disabled || !hasDom) {
      sync();
      return;
    }

    const onGesture = () => {
      gestured = true;
      sync();
      if (engine) {
        window.removeEventListener('pointerdown', onGesture, true);
        window.removeEventListener('keydown', onGesture, true);
      }
    };
    window.addEventListener('pointerdown', onGesture, true);
    window.addEventListener('keydown', onGesture, true);
    document.addEventListener('visibilitychange', sync);
    sync();

    // Black holes (registry bodies of kind 'blackhole'), refreshed when bodies change.
    let holes: Body[] = [];
    let holesDirty = true;
    const unsubRegistry = registry.subscribe((kind) => {
      if (kind === 'body') holesDirty = true;
    });

    const ZERO: Readonly<Vec3d> = { x: 0, y: 0, z: 0 };
    const tmp: Vec3d = { x: 0, y: 0, z: 0 };
    const zi: ZoneInput = { altitude: Infinity, radius: 1, dSun: Infinity, dGalaxy: Infinity };
    const whoosh: FilteredGain = { gain: 0, cutoff: 400 };
    const wind: FilteredGain = { gain: 0, cutoff: 400 };
    const distTo = (view: ViewState, frame: string): number => {
      try {
        return v3len(frames.delta(view.frame, view.cameraLocal, frame, ZERO, view.jd, tmp));
      } catch {
        return Infinity;
      }
    };

    let pendingZone: Zone | null = null;
    let pendingT = 0;
    let acc = 0;
    let prevLog = 0;
    let stepPhase = 0;
    let airborne = false;
    let airT = 0;
    let wasTraveling = false;
    let footLeft = false;

    const update = (e: AudioEngine, view: ViewState, dt: number) => {
      const speed = camera.speed;
      const ns = camera.nearestSurface();
      const body = ns ? registry.body(ns.bodyId) : undefined;
      const alt = ns ? Math.max(0, ns.altitude) : Infinity;
      zi.altitude = alt;
      zi.radius = body?.radius ?? 1;
      zi.dSun = distTo(view, SSB_FRAME);
      zi.dGalaxy = distTo(view, MW_FRAME);

      // 1. Ambient pad by scale zone (with hold time so boundaries do not flap).
      const z = classifyZone(zi);
      if (z !== pendingZone) {
        pendingZone = z;
        pendingT = 0;
      } else pendingT += dt;
      if (z !== zone && (zone === null || pendingT >= ZONE_HOLD_S)) {
        e.setZone(z, zone === null ? 3 : ZONE_FADE_S);
        zone = z;
      }

      // 2. Whoosh (scale-relative speed and log-speed rate); 3. wind; 4. black-hole rumble.
      const walking = camera.mode === 'walk';
      const logS = Math.log(Math.max(speed, 1e-3));
      const logRate = (logS - prevLog) / dt;
      prevLog = logS;
      const scale = Number.isFinite(alt) ? Math.max(alt, 1) : Math.max(zi.dGalaxy, 1);
      whooshParams(walking ? 0 : speed / scale, walking ? 0 : logRate, whoosh);
      windParams(ns ? densityAt(ns.bodyId, alt) : 0, speed, alt, wind);
      if (holesDirty) {
        holes = registry.bodies().filter((b) => b.kind === 'blackhole');
        holesDirty = false;
      }
      let rumble = 0;
      for (const h of holes) rumble = Math.max(rumble, rumbleLevel(distTo(view, h.frame), h.radius));
      e.apply(whoosh, wind, rumble);

      // 5. Walk mode: footsteps by speed, jump and landing thuds, pitch by surface gravity.
      if (walking && body) {
        const g = body.gm ? body.gm / (body.radius * body.radius) : 9.81;
        const pitch = gravityPitch(g);
        const up = alt > EYE_HEIGHT + 0.06;
        if (up && !airborne) e.thud(0.45, pitch * 1.1);
        else if (!up && airborne) e.thud(Math.min(1, 0.6 + airT * 0.4), pitch * 0.85);
        airT = up ? airT + dt : 0;
        airborne = up;
        if (!up) {
          stepPhase += stepRate(speed) * dt;
          if (stepPhase >= 1) {
            stepPhase %= 1;
            footLeft = !footLeft;
            e.thud(Math.min(0.8, 0.4 + speed * 0.06), pitch * (footLeft ? 1 : 0.93));
          }
        }
      } else {
        airborne = false;
        stepPhase = 0.5;
      }

      // 6. Autopilot arrival chime.
      const traveling = camera.traveling;
      if (wasTraveling && !traveling) e.chime();
      wasTraveling = traveling;
    };

    const unsubFrame = render.onAfterFrame((view) => {
      if (!engine || engine.ctx.state !== 'running') return;
      acc += view.dtReal;
      if (acc < UPDATE_DT) return;
      const dt = Math.min(acc, 0.5);
      acc = 0;
      try {
        update(engine, view, dt);
      } catch (err) {
        console.warn('[audio] update failed', err);
      }
    });

    disposeImpl = () => {
      unsubFrame();
      unsubRegistry();
      window.removeEventListener('pointerdown', onGesture, true);
      window.removeEventListener('keydown', onGesture, true);
      document.removeEventListener('visibilitychange', sync);
      engine?.dispose();
      engine = null;
    };
  },
  dispose() {
    disposeImpl?.();
    disposeImpl = null;
  },
};

export default audioModule;
