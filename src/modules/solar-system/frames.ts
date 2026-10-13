/**
 * Frame definitions for the Solar System (three-free, unit-testable):
 *   ssb > sun | planets | pluto | eris… ;  sun > ceres, vesta ;  <planet> > moons ;  <id> > <id>.fixed
 * plus `<id>.sunview` helper frames used by bookmarks (origin at the body, +x towards the Sun,
 * +z towards ecliptic north). Helper frames have influenceRadius 0, so the camera never anchors
 * to them: a bookmark expressed in one re-anchors to the body frame on arrival.
 */
import { FIXED_SUFFIX, type Body, type FrameDef, type Quatd, type Vec3d } from '../../core/contracts';
import { qfromMatrix, qnormalize, v3cross, v3dot, v3len, v3normalize, v3set, vec3 } from '../../core/math64';
import type { BodyRow } from './data';
import { equatorialRadius, flattening, gmSI } from './data';
import type { SolarEphemeris } from './ephemeris';
import { ECLIPTIC_POLE } from './kepler';

export const SUNVIEW_SUFFIX = '.sunview';
export const fixedFrameId = (id: string): string => `${id}${FIXED_SUFFIX}`;
export const sunviewFrameId = (id: string): string => `${id}${SUNVIEW_SUFFIX}`;

/** Camera anchoring radius: Hill sphere (at pericentre) clamped to [20 R, distance to parent / 2]. */
export function influenceRadius(row: BodyRow, eph: SolarEphemeris, rowsById: Map<string, BodyRow>): number {
  const R = equatorialRadius(row);
  if (row.id === 'sun') return 40 * R;
  const parent = row.parent ? rowsById.get(row.parent) : undefined;
  const el = row.elements;
  const kep = eph.kepler(row.id);
  let a: number;
  let e = 0;
  if (kep) {
    a = kep.a;
    e = kep.e;
  } else if (el) {
    a = el.a * 1e3;
    e = el.e;
  } else {
    a = v3len(eph.stateAt(row.id, 2451545, vec3()));
    if (row.parent && row.parent !== 'sun') a = v3len(eph.relative(row.parent, row.id, 2451545, vec3()));
  }
  const mParent = parent ? gmSI(parent) : 1.32712440041e20;
  const hill = a * (1 - e) * Math.cbrt(gmSI(row) / (3 * mParent));
  return Math.min(Math.max(hill, 20 * R), 0.5 * a * (1 - e));
}

/** Registry Body for a row. */
export function bodyFromRow(row: BodyRow, eph: SolarEphemeris, rowsById: Map<string, BodyRow>): Body {
  const f = flattening(row);
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    frame: row.id,
    fixedFrame: fixedFrameId(row.id),
    parent: row.parent ?? undefined,
    radius: equatorialRadius(row),
    oblateness: f > 0 ? f : undefined,
    gm: gmSI(row),
    influenceRadius: influenceRadius(row, eph, rowsById),
    albedo: row.albedoGeometric,
    teff: row.teff,
    absMag: row.absMag,
    labelPriority: row.kind === 'star' ? 100 : row.kind === 'planet' ? 80 : row.kind === 'dwarf' ? 60 : 40,
  };
}

/** Sun-view axes for body `id` at `jd`: +x towards the Sun, +z towards ecliptic north. */
export function sunviewQuat(eph: SolarEphemeris, id: string, jd: number, out: Quatd): Quatd {
  const x = id === 'sun' ? vec3(1, 0, 0) : eph.relative(id, 'sun', jd, vec3());
  v3normalize(x, x);
  const k = v3dot(ECLIPTIC_POLE, x);
  const z = vec3(ECLIPTIC_POLE.x - k * x.x, ECLIPTIC_POLE.y - k * x.y, ECLIPTIC_POLE.z - k * x.z);
  v3normalize(z, z);
  const y = v3cross(vec3(), z, x);
  return qnormalize(out, qfromMatrix(out, [x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z]));
}

/** Every frame of the module: inertial body frames, `.fixed` frames and `.sunview` helpers. */
export function buildFrameDefs(eph: SolarEphemeris, sunviewIds: readonly string[] = []): FrameDef[] {
  const rowsById = new Map(eph.rows.map((r) => [r.id, r]));
  const defs: FrameDef[] = [];
  const zero = (_jd: number, out: Vec3d) => v3set(out, 0, 0, 0);
  for (const row of eph.rows) {
    const id = row.id;
    defs.push({
      id,
      parent: eph.parentFrame(id),
      influenceRadius: influenceRadius(row, eph, rowsById),
      positionAt: (jd, out) => eph.positionAt(id, jd, out),
    });
    defs.push({
      id: fixedFrameId(id),
      parent: id,
      influenceRadius: 1.5 * equatorialRadius(row),
      positionAt: zero,
      orientationAt: (jd, out) => eph.orientationAt(id, jd, out),
    });
  }
  for (const id of sunviewIds) {
    if (!eph.has(id)) continue;
    defs.push({
      id: sunviewFrameId(id),
      parent: id,
      influenceRadius: 0,
      positionAt: zero,
      orientationAt: (jd, out) => sunviewQuat(eph, id, jd, out),
    });
  }
  return defs;
}
