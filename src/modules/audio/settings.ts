/** Sound settings (persisted by the settings store; ids from public.ts). */
import type { SettingDef, SettingValue } from '../../core/contracts';
import { AUDIO_ENABLED_SETTING, AUDIO_SILENCE_SETTING, AUDIO_VOLUME_SETTING } from './public';

export interface AudioPrefs {
  enabled: boolean;
  volume: number;
  silence: boolean;
}

export const DEFAULT_AUDIO_PREFS: Readonly<AudioPrefs> = { enabled: true, volume: 0.5, silence: false };

/** Setting definitions that write into `prefs` and call `changed` after every change. */
export function audioSettingDefs(prefs: AudioPrefs, changed: () => void): SettingDef[] {
  const on =
    (apply: (v: SettingValue) => void) =>
    (v: SettingValue): void => {
      apply(v);
      changed();
    };
  return [
    {
      id: AUDIO_ENABLED_SETTING,
      label: 'Sound',
      group: 'Sound',
      type: 'boolean',
      default: DEFAULT_AUDIO_PREFS.enabled,
      persist: true,
      description: 'Procedural ambient music and effects (M toggles). Starts after your first click or key.',
      onChange: on((v) => (prefs.enabled = v === true)),
    },
    {
      id: AUDIO_VOLUME_SETTING,
      label: 'Volume',
      group: 'Sound',
      type: 'number',
      min: 0,
      max: 1,
      step: 0.05,
      default: DEFAULT_AUDIO_PREFS.volume,
      persist: true,
      onChange: on((v) => (prefs.volume = Math.min(1, Math.max(0, Number(v) || 0)))),
    },
    {
      id: AUDIO_SILENCE_SETTING,
      label: 'Realistic silence in space',
      group: 'Sound',
      type: 'boolean',
      default: DEFAULT_AUDIO_PREFS.silence,
      persist: true,
      description: 'Space is silent: only wind inside an atmosphere, footsteps and UI cues play.',
      onChange: on((v) => (prefs.silence = v === true)),
    },
  ];
}

/** Audible at all (the AudioContext is suspended otherwise). */
export const audible = (p: AudioPrefs): boolean => p.enabled && p.volume > 0;
