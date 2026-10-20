/**
 * Ephemerides and body-fixed orientation for every bodies.json row (pure float64, no three.js).
 *
 * - Sun, planets, Pluto: astronomy-engine HelioState + the Sun's barycentric state (= BaryState).
 * - Moon: GeoMoonState (geocentric). Galilean moons: JupiterMoons (jovicentric).
 * - Everything else: KeplerOrbit from `elements`, relative to `elements.center`.
 * - Orientation: astronomy-engine RotationAxis where it exists, else IAU leading terms from the
 *   row; tidally locked bodies without a pole face their parent; no data → ecliptic pole, no spin.
 *
 * All vectors are ICRF/J2000 axes in metres (velocities m/s). Times are JD TT, clamped to
 * J2000 ± 10 kyr (the `core.planets` validity range: positions are frozen beyond it).
 */
import {
  AstroTime,
  Body as AeBody,
  GeoMoonState,
  HelioState,
  JupiterMoons,
  RotationAxis,
} from 'astronomy-engine';
import type { StateVector } from 'astronomy-engine';
import { SSB_FRAME, type FrameId, type Quatd, type Vec3d } from '../../core/contracts';
import {
  qfromAxisAngle,
  qfromMatrix,
  qmul,
  qnormalize,
  quat,
  v3add,
  v3copy,
  v3cross,
  v3normalize,
  v3scale,
  v3set,
  v3sub,
  vec3,
} from '../../core/math64';
import { astroTimeFromTt } from '../../core/time';
import { AU, DAY, JD_J2000, JULIAN_YEAR } from '../../core/units';
import type { BodyRow } from './data';
import { gmSI } from './data';
import { ECLIPTIC_POLE, KeplerOrbit, elementsFrameMatrix } from './kepler';

const DEG = Math.PI / 180;
const AU_PER_DAY = AU / DAY;
/** Ephemerides are frozen outside J2000 ± this many days (core.planets validity). */
export const EPHEMERIS_HALF_RANGE_DAYS = (10_000 * JULIAN_YEAR) / DAY;
export const clampJd = (jd: number): number =>
  Math.min(JD_J2000 + EPHEMERIS_HALF_RANGE_DAYS, Math.max(JD_J2000 - EPHEMERIS_HALF_RANGE_DAYS, jd));

const AE_BODIES: Record<string, AeBody> = {
  sun: AeBody.Sun,
  mercury: AeBody.Mercury,
  venus: AeBody.Venus,
  earth: AeBody.Earth,
  moon: AeBody.Moon,
  mars: AeBody.Mars,
  jupiter: AeBody.Jupiter,
  saturn: AeBody.Saturn,
  uranus: AeBody.Uranus,
  neptune: AeBody.Neptune,
  pluto: AeBody.Pluto,
};
const GALILEAN = new Set(['io', 'europa', 'ganymede', 'callisto']);

type Source = 'sun' | 'helio' | 'moon' | 'galilean' | 'kepler';

interface Entry {
  row: BodyRow;
  source: Source;
  parentFrame: FrameId;
  kepler?: KeplerOrbit;
  /** μ = G(M_parent + m) for osculating orbits, m³/s². */
  mu: number;
}

function setState(sv: StateVector, pos: Vec3d, vel?: Vec3d): void {
  v3set(pos, sv.x * AU, sv.y * AU, sv.z * AU);
  if (vel) v3set(vel, sv.vx * AU_PER_DAY, sv.vy * AU_PER_DAY, sv.vz * AU_PER_DAY);
}

/** Quaternion body-fixed → ICRF for pole (α, δ) and prime meridian angle W (radians). */
export function poleQuat(alpha: number, delta: number, W: number, out: Quatd): Quatd {
  const qa = qfromAxisAngle(quat(), vec3(0, 0, 1), Math.PI / 2 + alpha);
  const qd = qfromAxisAngle(quat(), vec3(1, 0, 0), Math.PI / 2 - delta);
  const qw = qfromAxisAngle(quat(), vec3(0, 0, 1), W);
  return qnormalize(out, qmul(out, qmul(out, qa, qd), qw));
}

export class SolarEphemeris {
  readonly rows: readonly BodyRow[];
  private entries = new Map<string, Entry>();
  // per-jd caches
  private tJd = NaN;
  private t: AstroTime = astroTimeFromTt(0);
  private sunJd = NaN;
  private sunPos = vec3();
  private sunVel = vec3();
  private jmJd = NaN;
  private jm: ReturnType<typeof JupiterMoons> | null = null;

  constructor(rows: readonly BodyRow[]) {
    this.rows = rows;
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const row of rows) {
      let source: Source;
      let parentFrame: FrameId = SSB_FRAME;
      let kepler: KeplerOrbit | undefined;
      if (row.id === 'sun') source = 'sun';
      else if (row.ephemeris === 'astronomy-engine' && row.id === 'moon') {
        source = 'moon';
        parentFrame = 'earth';
      } else if (row.ephemeris === 'astronomy-engine' && GALILEAN.has(row.id)) {
        source = 'galilean';
        parentFrame = 'jupiter';
      } else if (row.ephemeris === 'astronomy-engine' && AE_BODIES[row.id] !== undefined) source = 'helio';
      else {
        const el = row.elements;
        if (!el) throw new Error(`solar-system: '${row.id}' has neither astronomy-engine nor elements`);
        source = 'kepler';
        parentFrame = el.center === 'ssb' ? SSB_FRAME : el.center;
        const parentRow = el.center === 'ssb' ? undefined : byId.get(el.center);
        kepler = new KeplerOrbit(el, elementsFrameMatrix(el, parentRow?.rotation));
      }
      const parentRow = row.parent ? byId.get(row.parent) : undefined;
      const mu = (parentRow ? gmSI(parentRow) : 0) + gmSI(row);
      this.entries.set(row.id, { row, source, parentFrame, kepler, mu });
    }
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }
  row(id: string): BodyRow | undefined {
    return this.entries.get(id)?.row;
  }
  /** Frame the body's position is expressed relative to ('ssb' or another body id). */
  parentFrame(id: string): FrameId {
    return this.entry(id).parentFrame;
  }
  /** μ = G(M_parent + m) used for osculating orbits. */
  mu(id: string): number {
    return this.entry(id).mu;
  }
  kepler(id: string): KeplerOrbit | undefined {
    return this.entries.get(id)?.kepler;
  }

  private entry(id: string): Entry {
    const e = this.entries.get(id);
    if (!e) throw new Error(`solar-system: unknown body '${id}'`);
    return e;
  }

  private time(jd: number): AstroTime {
    if (jd !== this.tJd) {
      this.tJd = jd;
      this.t = astroTimeFromTt(jd - JD_J2000);
    }
    return this.t;
  }

  private sunState(jd: number): void {
    if (jd === this.sunJd) return;
    // BaryState(Sun) = −HelioState(SSB).
    setState(HelioState(AeBody.SSB, this.time(jd)), this.sunPos, this.sunVel);
    v3scale(this.sunPos, this.sunPos, -1);
    v3scale(this.sunVel, this.sunVel, -1);
    this.sunJd = jd;
  }

  /** State relative to parentFrame(id), ICRF axes (m, m/s). */
  stateAt(id: string, jdIn: number, pos: Vec3d, vel?: Vec3d): Vec3d {
    const e = this.entry(id);
    const jd = clampJd(jdIn);
    switch (e.source) {
      case 'sun':
        this.sunState(jd);
        v3copy(pos, this.sunPos);
        if (vel) v3copy(vel, this.sunVel);
        return pos;
      case 'helio': {
        this.sunState(jd);
        setState(HelioState(AE_BODIES[id], this.time(jd)), pos, vel);
        v3add(pos, pos, this.sunPos);
        if (vel) v3add(vel, vel, this.sunVel);
        return pos;
      }
      case 'moon':
        setState(GeoMoonState(this.time(jd)), pos, vel);
        return pos;
      case 'galilean': {
        if (jd !== this.jmJd) {
          this.jm = JupiterMoons(this.time(jd));
          this.jmJd = jd;
        }
        setState(this.jm![id as 'io' | 'europa' | 'ganymede' | 'callisto'], pos, vel);
        return pos;
      }
      case 'kepler':
        e.kepler!.positionAt(jd, pos);
        if (vel) e.kepler!.velocityAt(jd, vel);
        return pos;
    }
  }

  positionAt(id: string, jd: number, out: Vec3d): Vec3d {
    return this.stateAt(id, jd, out);
  }

  /** Position relative to the Solar System barycentre, ICRF axes, m. */
  baryPosition(id: string, jd: number, out: Vec3d): Vec3d {
    this.positionAt(id, jd, out);
    let p = this.entry(id).parentFrame;
    const tmp = vec3();
    while (p !== SSB_FRAME) {
      v3add(out, out, this.positionAt(p, jd, tmp));
      p = this.entry(p).parentFrame;
    }
    return out;
  }

  /** Rotation taking body-fixed vectors into ICRF (the `<id>.fixed` frame's orientation). */
  orientationAt(id: string, jdIn: number, out: Quatd): Quatd {
    const e = this.entry(id);
    const jd = clampJd(jdIn);
    const rot = e.row.rotation;
    const d = jd - JD_J2000;
    const T = d / 36525;
    const ae = AE_BODIES[id];
    if (ae !== undefined) {
      const ax = RotationAxis(ae, this.time(jd));
      return poleQuat(ax.ra * 15 * DEG, ax.dec * DEG, ax.spin * DEG, out);
    }
    if (
      rot &&
      rot.ra0 !== undefined &&
      rot.dec0 !== undefined &&
      rot.w0 !== undefined &&
      rot.wdot !== undefined
    ) {
      const ra = rot.ra0 + (rot.raRate ?? 0) * T;
      const dec = rot.dec0 + (rot.decRate ?? 0) * T;
      const W = (rot.w0 + rot.wdot * d) % 360;
      return poleQuat(ra * DEG, dec * DEG, W * DEG, out);
    }
    if (rot?.synchronous && e.source === 'kepler') {
      // Locked, no published pole (Triton): +x towards the parent, +z along the orbit normal.
      const r = this.stateAt(id, jd, vec3(), undefined);
      const v = e.kepler!.velocityAt(jd, vec3());
      const x = v3normalize(vec3(), v3scale(vec3(), r, -1));
      const z = v3normalize(vec3(), v3cross(vec3(), r, v));
      const y = v3cross(vec3(), z, x);
      return qnormalize(out, qfromMatrix(out, [x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z]));
    }
    // Only a period (Eris, Haumea, Makemake) or nothing: ecliptic pole, spin from the period.
    const pole = ECLIPTIC_POLE;
    const alpha = Math.atan2(pole.y, pole.x);
    const delta = Math.asin(pole.z);
    const W = rot?.periodHours ? (((d * 24) / rot.periodHours) % 1) * 2 * Math.PI : 0;
    return poleQuat(alpha, delta, W, out);
  }

  /** True when the orientation is a stand-in or omits significant periodic terms. */
  orientationApproximate(id: string): boolean {
    const rot = this.entry(id).row.rotation;
    if (AE_BODIES[id] !== undefined) return id === 'moon' ? false : !!rot?.approximate;
    return !rot || rot.ra0 === undefined || !!rot.approximate || !!rot.chaotic;
  }

  /** Vector from body `a` to body `b`, ICRF axes, m. */
  relative(a: string, b: string, jd: number, out: Vec3d): Vec3d {
    const pa = this.baryPosition(a, jd, vec3());
    return v3sub(out, this.baryPosition(b, jd, out), pa);
  }
}
