/**
 * Terrain bookmarks, computed at init from the frame tree and the Moon's CPU height function so
 * the eye sits a known height above the actual mesh.
 */
import type { Body, Bookmark, FrameTree, Quatd, Vec3d } from '../../core/contracts';
import { qlookRotation, quat, v3addScaled, v3cross, v3dot, v3normalize, v3scale, v3sub, vec3 } from '../../core/math64';

const DEG = Math.PI / 180;

/** Apollo 11 landing site (Tranquility Base), selenographic, degrees. */
export const APOLLO11_LAT = 0.674;
export const APOLLO11_LON = 23.473;
/**
 * 2026-12-15 12:00 TT: lunar morning at Tranquility Base, Sun ≈ 10° above the eastern horizon,
 * Earth ≈ 60° up in the west (the lowest Earth of 2026 mornings with the Sun 8-12° up; found by a
 * one-off search over 2026 with this frame tree, re-checked in tests/unit/terrain/bookmarks.test.ts).
 */
export const APOLLO11_JD = 2461390.0;
/** Eye height of the apollo11-2m bookmark above the mesh, m. */
export const APOLLO11_EYE = 2;
/** Vertical field of view of the surface bookmarks. */
export const SURFACE_FOV = 80 * DEG;
export const MOON_ORBIT_ALT = 50_000;

export const unitFromLatLon = (latDeg: number, lonDeg: number): Vec3d =>
  vec3(Math.cos(latDeg * DEG) * Math.cos(lonDeg * DEG), Math.cos(latDeg * DEG) * Math.sin(lonDeg * DEG), Math.sin(latDeg * DEG));

/** Camera quaternion looking along azimuth `forwardH` (horizontal unit) pitched by `pitch` rad. */
function lookPitched(forwardH: Vec3d, up: Vec3d, pitch: number): Quatd {
  const f = v3addScaled(vec3(), v3scale(vec3(), forwardH, Math.cos(pitch)), up, Math.sin(pitch));
  return qlookRotation(quat(), f, up);
}

export interface SurfaceView {
  pos: Vec3d;
  quat: Quatd;
  /** Elevation of Earth above the horizon, rad. */
  earthElevation: number;
  /** Pitch of the view axis, rad. */
  pitch: number;
}

/** Apollo 11 view: eye `eye` m above the mesh, facing Earth's azimuth with Earth near the top edge. */
export function apolloView(
  frames: Pick<FrameTree, 'convertPoint'>,
  fixedFrame: string,
  groundRadius: (dir: Vec3d) => number,
  eye = APOLLO11_EYE,
): SurfaceView {
  const up = unitFromLatLon(APOLLO11_LAT, APOLLO11_LON);
  const pos = v3scale(vec3(), up, groundRadius(up) + eye);
  const earth = frames.convertPoint('earth', vec3(), fixedFrame, APOLLO11_JD, vec3());
  const e = v3normalize(vec3(), v3sub(vec3(), earth, pos));
  const earthElevation = Math.asin(v3dot(e, up));
  let h = v3addScaled(vec3(), e, up, -v3dot(e, up));
  if (Math.hypot(h.x, h.y, h.z) < 1e-6) h = v3cross(vec3(), up, vec3(0, 0, 1));
  v3normalize(h, h);
  // Earth ~6° below the top edge, horizon in the lower part of the frame.
  const pitch = Math.max(5 * DEG, Math.min(SURFACE_FOV / 2 - 6 * DEG, earthElevation - SURFACE_FOV / 2 + 6 * DEG));
  return { pos, quat: lookPitched(h, up, pitch), earthElevation, pitch };
}

export function terrainBookmarks(
  frames: Pick<FrameTree, 'convertPoint' | 'has'>,
  moon: Body,
  groundRadius: (dir: Vec3d) => number,
  test: boolean,
): Bookmark[] {
  const out: Bookmark[] = [];
  const R = moon.radius;
  if (frames.has('moon.sunview')) {
    // Sun-view axes: +x to the Sun. The camera is above a point 16° from the terminator (Sun 16° up)
    // and looks along the surface towards the terminator, pitched down 20°.
    const up = vec3(Math.sin(16 * DEG), Math.cos(16 * DEG), 0);
    const toTerminator = vec3(-Math.cos(16 * DEG), Math.sin(16 * DEG), 0);
    out.push({
      id: 'moon-low-orbit',
      title: 'Moon: low orbit over the terminator',
      frame: 'moon.sunview',
      pos: v3scale(vec3(), up, R + MOON_ORBIT_ALT),
      quat: lookPitched(toTerminator, up, -20 * DEG),
      jd: APOLLO11_JD,
      ev: 14,
      fovY: 60 * DEG,
      lookTarget:
        'Cratered lunar terrain 50 km below, lit by a low Sun from behind the camera, with long shadows growing towards the terminator near the curved horizon; black sky above the horizon.',
    });
  }
  const fixed = moon.fixedFrame ?? 'moon.fixed';
  if (frames.has(fixed) && frames.has('earth')) {
    const v = apolloView(frames, fixed, groundRadius);
    const earthIn = v.earthElevation < v.pitch + SURFACE_FOV / 2 - 1 * DEG;
    out.push({
      id: 'apollo11-2m',
      title: 'Apollo 11 landing site, 2 m above the ground',
      frame: fixed,
      pos: v.pos,
      quat: v.quat,
      jd: APOLLO11_JD,
      ev: 14,
      fovY: SURFACE_FOV,
      mode: 'walk',
      lookTarget: earthIn
        ? 'Standing at Tranquility Base in the lunar morning: grey regolith with small craters lit by a low Sun behind the camera, the horizon in the lower part of the frame and a small Earth high in the black sky near the top.'
        : 'Standing at Tranquility Base in the lunar morning: grey regolith with small craters lit by a low Sun behind the camera and the horizon in the lower part of the frame (Earth is above the frame).',
    });
    if (test) {
      // Jitter pair: same site, free mode, time frozen, b = a + 1 mm east.
      const a = apolloView(frames, fixed, groundRadius);
      const east = v3normalize(vec3(), v3cross(vec3(), vec3(0, 0, 1), a.pos));
      const common = { frame: fixed, quat: a.quat, jd: APOLLO11_JD, rate: 0, ev: 14, fovY: SURFACE_FOV, mode: 'free' as const };
      out.push({ id: 'terrain-jitter-a', title: 'Terrain jitter A (test)', pos: a.pos, ...common });
      out.push({
        id: 'terrain-jitter-b',
        title: 'Terrain jitter B (test)',
        pos: v3addScaled(vec3(), a.pos, east, 1e-3),
        ...common,
      });
    }
  }
  return out;
}
