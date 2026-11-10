/**
 * Gamepad mapping (standard layout), pure so it is unit-tested without a browser:
 * left stick moves, right stick looks, triggers go down and up, bumpers roll, the d-pad changes
 * speed, A jumps when walking and Y lands, walks or takes off.
 */
export interface PadLike {
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
  mapping?: string;
}

/** Stick travel ignored around the centre (worn sticks rest a little off it). */
export const PAD_DEAD_ZONE = 0.15;
/** Look rate at full deflection, rad/s at a 60 degree field of view. */
export const PAD_LOOK_RATE = 1.8;

export interface PadCommand {
  forward: number;
  right: number;
  up: number;
  roll: number;
  /** Look rates, rad/s: positive yaw turns the view left, positive pitch looks up (camera convention). */
  yaw: number;
  pitch: number;
  /** Buttons held this poll (edge detection is the caller's). */
  faster: boolean;
  slower: boolean;
  jump: boolean;
  land: boolean;
}

/** Removes the dead zone and rescales the rest to 0..1, keeping the sign. */
export function deadZone(v: number, dead = PAD_DEAD_ZONE): number {
  if (!Number.isFinite(v)) return 0;
  const a = Math.abs(v);
  if (a <= dead) return 0;
  return Math.sign(v) * Math.min(1, (a - dead) / (1 - dead));
}

export function readPad(p: PadLike): PadCommand {
  const ax = (i: number) => deadZone(p.axes[i] ?? 0);
  const val = (i: number) => p.buttons[i]?.value ?? 0;
  const down = (i: number) => p.buttons[i]?.pressed ?? false;
  // A gentle response curve: small deflections give fine control.
  const curve = (v: number) => v * Math.abs(v);
  return {
    right: ax(0),
    forward: -ax(1),
    yaw: -curve(ax(2)) * PAD_LOOK_RATE,
    pitch: -curve(ax(3)) * PAD_LOOK_RATE,
    up: Math.max(-1, Math.min(1, deadZone(val(7), 0.05) - deadZone(val(6), 0.05) + (down(0) ? 1 : 0))),
    roll: (down(5) ? 1 : 0) - (down(4) ? 1 : 0),
    faster: down(12),
    slower: down(13),
    jump: down(0),
    land: down(3),
  };
}

/** First connected pad with the standard mapping (or any connected pad when none declares one). */
export function pickPad(pads: readonly (PadLike | null)[]): PadLike | null {
  const live = pads.filter((p): p is PadLike => !!p && p.axes.length >= 2);
  return live.find((p) => p.mapping === 'standard') ?? live[0] ?? null;
}
