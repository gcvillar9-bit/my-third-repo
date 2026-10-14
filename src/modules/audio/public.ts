/**
 * Cross-module API of the audio module (import only this file from other modules). The UI shell's
 * mute button and the M key toggle `AUDIO_ENABLED_SETTING` through the settings store.
 */
export const AUDIO_MODULE_ID = 'audio';
/** Sound on/off (the mute button and M toggle it). */
export const AUDIO_ENABLED_SETTING = 'audio.enabled';
/** Master volume, 0..1. */
export const AUDIO_VOLUME_SETTING = 'audio.volume';
/** When on, only in-atmosphere wind, footsteps and UI cues play: space is silent. */
export const AUDIO_SILENCE_SETTING = 'audio.realisticSilence';
/** Attribute on <html>: 'test-off' (test mode), 'idle' (waiting for a gesture), 'running', 'suspended'. */
export const AUDIO_STATE_ATTR = 'data-cz-audio';
