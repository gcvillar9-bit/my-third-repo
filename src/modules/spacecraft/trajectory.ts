/**
 * Where each craft is and how it is turned, as pure functions of the TT Julian date (three-free,
 * unit-tested against JPL Horizons). Three models, one per `kind` of craft.json row:
 *
 * - `probe`: heliocentric two-body conics. Between two encounters (launch, flybys) the conic is
 *   the Lambert arc through the two bodies' positions at the published times; after the last
 *   flyby it is the conic through one published JPL Horizons state. The small mismatch at the
 *   last flyby is blended away over BLEND_DAYS so the path stays continuous.
 * - `leo`: a circle with the semi-major axis, inclination, node and phase of one published
 *   element set, plus the secular J2 drift of the node and of the argument of latitude. No drag,
 *   no reboosts: the plane stays right for months, the place along the orbit only for days.
 * - `l2`: the Sun-Earth L2 point from astronomy-engine plus a fitted halo ellipse.
 *
 * Positions come out in the parent frame's coordinates ('earth' for LEO craft, 'ssb' otherwise),
 * ICRF axes, metres. Sun and planet positions come from an `Ephemeris` callback so that the app
 * can pass its own frame tree and the tests astronomy-engine.
 */
import {
  Body as AeBody,
  HelioState,
  LagrangePoint,
  RotateVector,
  Rotation_EQD_EQJ,
  Vector,
} from 'astronomy-engine';
import type { JD, Quatd, Vec3d } from '../../core/contracts';
import {
  qfromMatrix,
  qnormalize,
  v3add,
  v3addScaled,
  v3copy,
  v3cross,
  v3dot,
  v3len,
  v3normalize,
  v3scale,
  v3set,
  v3sub,
  vec3,
} from '../../core/math64';
import { astroTimeFromTt } from '../../core/time';
import { AU, DAY, GM_SUN, JD_J2000, KM } from '../../core/units';
import { jdFromUtc, type CraftRow, type HaloRow, type LeoOrbitRow, type TrajectoryRow } from './data';
import { lambert, propagate } from './kepler';

/** SSB-relative ICRF position (m) of a Solar System body ('sun', 'earth', 'jupiter'…) at `jd` TT. */
export type Ephemeris = (body: string, jd: JD, out: Vec3d) => Vec3d;

const DEG = Math.PI / 180;
/** Mean obliquity at J2000 (IAU 1976), the tilt of the ecliptic to the ICRF equator. */
const OBLIQUITY = 23.4392911 * DEG;
/** North ecliptic pole in ICRF axes. */
export const ECLIPTIC_NORTH: Readonly<Vec3d> = Object.freeze(
  vec3(0, -Math.sin(OBLIQUITY), Math.cos(OBLIQUITY)),
);
/** Earth constants for the LEO model (EGM96 / WGS 84). */
export const GM_EARTH = 3.986004418e14;
export const EARTH_J2 = 1.08262668e-3;
export const EARTH_RADIUS = 6_378_137;

const AE_BODIES: Record<string, AeBody> = {
  mercury: AeBody.Mercury,
  venus: AeBody.Venus,
  earth: AeBody.Earth,
  mars: AeBody.Mars,
  jupiter: AeBody.Jupiter,
  saturn: AeBody.Saturn,
  uranus: AeBody.Uranus,
  neptune: AeBody.Neptune,
  pluto: AeBody.Pluto,
};

/** Ephemeris straight from astronomy-engine (tests, and the fallback when a frame is missing). */
export function astronomyEphemeris(): Ephemeris {
  return (body, jd, out) => {
    const t = astroTimeFromTt(jd - JD_J2000);
    const ssb = HelioState(AeBody.SSB, t);
    v3set(out, -ssb.x * AU, -ssb.y * AU, -ssb.z * AU);
    if (body === 'sun') return out;
    const ae = AE_BODIES[body];
    if (ae === undefined) throw new Error(`spacecraft: no ephemeris for '${body}'`);
    const s = HelioState(ae, t);
    return v3set(out, out.x + s.x * AU, out.y + s.y * AU, out.z + s.z * AU);
  };
}

/** Rotation taking body axes into ICRF, from the body's +x and +z directions (z is kept exactly). */
function attitude(xHint: Vec3d, zAxis: Vec3d, out: Quatd): Quatd {
  const z = v3normalize(vec3(), zAxis);
  const x = v3addScaled(vec3(), xHint, z, -v3dot(xHint, z));
  if (v3len(x) < 1e-9) v3cross(x, Math.abs(z.x) < 0.9 ? vec3(1, 0, 0) : vec3(0, 1, 0), z);
  v3normalize(x, x);
  const y = v3cross(vec3(), z, x);
  return qnormalize(out, qfromMatrix(out, [x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z]));
}

/** What the module needs from each model. */
export interface CraftMotion {
  readonly row: CraftRow;
  /** Frame the position is expressed in. */
  readonly parentFrame: 'earth' | 'ssb';
  /** The craft does not exist before this instant. */
  readonly launchJd: JD;
  /** From this instant on the main model applies; between launch and it the position is a rougher stand-in. */
  readonly settledJd: JD;
  /** Position in `parentFrame` coordinates, ICRF axes, m. */
  position(jd: JD, out: Vec3d): Vec3d;
  /** Position relative to the Solar System barycentre, ICRF axes, m. */
  ssbPosition(jd: JD, out: Vec3d): Vec3d;
  /** Rotation taking the model's body axes into ICRF axes. */
  orientation(jd: JD, out: Quatd): Quatd;
}

// ---------------------------------------------------------------------------------------
// Low Earth orbit
// ---------------------------------------------------------------------------------------

export class LeoMotion implements CraftMotion {
  readonly parentFrame = 'earth' as const;
  readonly launchJd: JD;
  readonly settledJd: JD;
  readonly epochJd: JD;
  /** Semi-major axis from the mean motion, m. */
  readonly a: number;
  readonly inclination: number;
  /** Secular J2 rates, rad/s. */
  readonly nodeRate: number;
  readonly argLatRate: number;
  private readonly node0: number;
  private readonly argLat0: number;
  /** Axes of the element set (equator and equinox of the epoch) in ICRF. */
  private readonly ex = vec3();
  private readonly ey = vec3();
  private readonly ez = vec3();

  constructor(
    readonly row: CraftRow,
    private readonly eph: Ephemeris,
  ) {
    const o = row.orbit as LeoOrbitRow;
    this.launchJd = this.settledJd = jdFromUtc(row.launchUtc);
    this.epochJd = jdFromUtc(o.epochUtc);
    const n = (o.meanMotionRevPerDay * 2 * Math.PI) / DAY;
    this.a = Math.cbrt(GM_EARTH / (n * n));
    this.inclination = o.inclinationDeg * DEG;
    const k = EARTH_J2 * (EARTH_RADIUS / this.a) ** 2;
    const ci = Math.cos(this.inclination);
    this.nodeRate = -1.5 * n * k * ci;
    // The element set's mean motion already holds the secular drift of the mean anomaly.
    this.argLatRate = n + 0.75 * n * k * (5 * ci * ci - 1);
    this.node0 = o.raanDeg * DEG;
    const m = o.meanAnomalyDeg * DEG;
    this.argLat0 = o.argPerigeeDeg * DEG + m + 2 * o.eccentricity * Math.sin(m);
    // TEME is the true equator of date with the mean equinox; the of-date axes are within 0.005°.
    const t = astroTimeFromTt(this.epochJd - JD_J2000);
    const rot = Rotation_EQD_EQJ(t);
    const axis = (x: number, y: number, z: number, out: Vec3d) => {
      const v = RotateVector(rot, new Vector(x, y, z, t));
      v3set(out, v.x, v.y, v.z);
    };
    axis(1, 0, 0, this.ex);
    axis(0, 1, 0, this.ey);
    axis(0, 0, 1, this.ez);
  }

  /** Mean altitude above the equatorial radius, m. */
  get altitude(): number {
    return this.a - EARTH_RADIUS;
  }
  /** Nodal period (one trip from ascending node to ascending node), s. */
  get period(): number {
    return (2 * Math.PI) / this.argLatRate;
  }
  /** Speed on the circle, m/s. */
  get speed(): number {
    return this.a * this.argLatRate;
  }

  /** Unit radial and along-track directions at `jd`, ICRF axes. */
  private basis(jd: JD, radial: Vec3d, along: Vec3d): void {
    const dt = (jd - this.epochJd) * DAY;
    const u = this.argLat0 + this.argLatRate * dt;
    const node = this.node0 + this.nodeRate * dt;
    const [cu, su, cn, sn] = [Math.cos(u), Math.sin(u), Math.cos(node), Math.sin(node)];
    const [ci, si] = [Math.cos(this.inclination), Math.sin(this.inclination)];
    // P towards the ascending node, Q 90° ahead in the orbit plane (axes of the element set).
    const p: [number, number, number] = [cn, sn, 0];
    const q: [number, number, number] = [-ci * sn, ci * cn, si];
    const mix = (a: number, b: number, out: Vec3d) => {
      const x = a * p[0] + b * q[0];
      const y = a * p[1] + b * q[1];
      const z = a * p[2] + b * q[2];
      v3set(
        out,
        x * this.ex.x + y * this.ey.x + z * this.ez.x,
        x * this.ex.y + y * this.ey.y + z * this.ez.y,
        x * this.ex.z + y * this.ey.z + z * this.ez.z,
      );
    };
    mix(cu, su, radial);
    mix(-su, cu, along);
  }

  position(jd: JD, out: Vec3d): Vec3d {
    this.basis(jd, out, vec3());
    return v3scale(out, out, this.a);
  }

  ssbPosition(jd: JD, out: Vec3d): Vec3d {
    return v3add(out, this.position(jd, out), this.eph('earth', jd, vec3()));
  }

  /** Unit normal of the orbit plane (along the angular momentum), ICRF axes. */
  normal(jd: JD, out: Vec3d): Vec3d {
    const r = vec3();
    const v = vec3();
    this.basis(jd, r, v);
    return v3cross(out, r, v);
  }

  orientation(jd: JD, out: Quatd): Quatd {
    if (this.row.model === 'hubble') {
      // Inertial pointing: panels (+z) square to the Sun, aperture (+x) to the north ecliptic pole.
      const sun = v3sub(vec3(), this.eph('sun', jd, vec3()), this.eph('earth', jd, vec3()));
      return attitude(ECLIPTIC_NORTH, sun, out);
    }
    // Local vertical, local horizontal: +x along the flight direction, +z to the nadir.
    const r = vec3();
    const v = vec3();
    this.basis(jd, r, v);
    return attitude(v, v3scale(r, r, -1), out);
  }
}

// ---------------------------------------------------------------------------------------
// Sun-Earth L2 halo
// ---------------------------------------------------------------------------------------

export class HaloMotion implements CraftMotion {
  readonly parentFrame = 'ssb' as const;
  readonly launchJd: JD;
  readonly settledJd: JD;
  private readonly halo: HaloRow;

  constructor(
    readonly row: CraftRow,
    private readonly eph: Ephemeris,
  ) {
    this.halo = row.halo as HaloRow;
    this.launchJd = jdFromUtc(row.launchUtc);
    this.settledJd = jdFromUtc(this.halo.arrivalUtc);
  }

  /** The L2 point of the Sun and the Earth-Moon barycentre relative to the Sun, ICRF axes, m. */
  l2Heliocentric(jd: JD, out: Vec3d): Vec3d {
    const s = LagrangePoint(2, astroTimeFromTt(jd - JD_J2000), AeBody.Sun, AeBody.EMB);
    return v3set(out, s.x * AU, s.y * AU, s.z * AU);
  }

  /** Halo position relative to the Sun, ICRF axes, m. */
  private haloHeliocentric(jd: JD, out: Vec3d): Vec3d {
    const h = this.halo;
    const l2 = this.l2Heliocentric(jd, vec3());
    const ex = v3normalize(vec3(), l2);
    const ez = v3normalize(vec3(), v3addScaled(vec3(), ECLIPTIC_NORTH, ex, -v3dot(ECLIPTIC_NORTH, ex)));
    const ey = v3cross(vec3(), ez, ex);
    const th = (2 * Math.PI * (jd - h.epochJd)) / h.periodDays;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const o = [0, 1, 2].map((k) => (h.centerKm[k] + h.cosKm[k] * c + h.sinKm[k] * s) * KM);
    v3copy(out, l2);
    v3addScaled(out, out, ex, o[0]);
    v3addScaled(out, out, ey, o[1]);
    return v3addScaled(out, out, ez, o[2]);
  }

  heliocentric(jd: JD, out: Vec3d): Vec3d {
    this.haloHeliocentric(jd, out);
    if (jd >= this.settledJd) return out;
    // Outbound cruise (or, before launch, parked at Earth): a stand-in that leaves Earth fast and
    // slows down, along the line to where the halo point is.
    const earth = v3sub(vec3(), this.eph('earth', jd, vec3()), this.eph('sun', jd, vec3()));
    const d = v3sub(vec3(), out, earth);
    const full = v3len(d);
    const s = Math.min(1, Math.max(0, (jd - this.launchJd) / (this.settledJd - this.launchJd)));
    const f = (EARTH_RADIUS + 300e3) / full;
    return v3addScaled(out, earth, d, f + (1 - f) * s ** 0.55);
  }

  position(jd: JD, out: Vec3d): Vec3d {
    return v3add(out, this.heliocentric(jd, out), this.eph('sun', jd, vec3()));
  }

  ssbPosition(jd: JD, out: Vec3d): Vec3d {
    return this.position(jd, out);
  }

  orientation(jd: JD, out: Quatd): Quatd {
    // Hot side (-z) to the Sun, telescope (+x) towards the north ecliptic pole.
    return attitude(ECLIPTIC_NORTH, this.heliocentric(jd, vec3()), out);
  }
}

// ---------------------------------------------------------------------------------------
// Deep-space probes
// ---------------------------------------------------------------------------------------

/** Days over which the mismatch between the last flyby and the published coast conic fades out. */
export const BLEND_DAYS = 400;
/** GM of the Sun plus the planets (IAU 2009 mass ratios), m³/s²: the pull felt far outside them. */
export const GM_SYSTEM = GM_SUN * 1.0013419;
/** Samples per leg of a path polyline. */
const LEG_SAMPLES = 32;

interface Node {
  jd: JD;
  /** Body met at this node (undefined for a published waypoint). */
  body?: string;
  label: string;
  /** Heliocentric position at `jd`, m. */
  r: Vec3d;
}

interface Leg {
  t0: JD;
  t1: JD;
  r0: Vec3d;
  v0: Vec3d;
}

export class ProbeMotion implements CraftMotion {
  readonly parentFrame = 'ssb' as const;
  readonly launchJd: JD;
  /** Instant of the last flyby: the coast conic applies from here on. */
  readonly coastJd: JD;
  readonly settledJd: JD;
  readonly nodes: readonly Node[];
  private readonly legs: Leg[] = [];
  private readonly coast: { jd: JD; r: Vec3d; v: Vec3d };
  /** Last node minus the coast conic at the same instant, m. */
  readonly seam = vec3();
  private readonly firstOffset = vec3();

  constructor(
    readonly row: CraftRow,
    private readonly eph: Ephemeris,
  ) {
    const tr = row.trajectory as TrajectoryRow;
    const sun = vec3();
    this.nodes = tr.nodes.map((n) => {
      if (n.posKm && n.jdTdb !== undefined)
        return { jd: n.jdTdb, label: n.label, r: vec3(n.posKm[0] * KM, n.posKm[1] * KM, n.posKm[2] * KM) };
      if (!n.body || !n.utc) throw new Error(`spacecraft: node '${n.label}' of ${row.id} has no place`);
      const jd = jdFromUtc(n.utc);
      const r = v3sub(vec3(), eph(n.body, jd, vec3()), eph('sun', jd, sun));
      // Closest-approach distance from the centre, placed over the body's ecliptic north pole (the
      // true flyby geometry is not modelled): the craft never sits inside the planet.
      v3addScaled(r, r, ECLIPTIC_NORTH, (n.caKm ?? 0) * KM);
      return { jd, body: n.body, label: n.label, r };
    });
    v3scale(this.firstOffset, ECLIPTIC_NORTH, (tr.nodes[0].caKm ?? 0) * KM);
    this.launchJd = this.nodes[0].jd;
    this.coastJd = this.nodes[this.nodes.length - 1].jd;
    this.settledJd = this.coastJd + BLEND_DAYS;
    for (let i = 0; i + 1 < this.nodes.length; i++) {
      const a = this.nodes[i];
      const b = this.nodes[i + 1];
      const sol = lambert(a.r, b.r, (b.jd - a.jd) * DAY, GM_SUN, ECLIPTIC_NORTH);
      if (!sol) throw new Error(`spacecraft: no transfer for ${row.id} leg ${i}`);
      this.legs.push({ t0: a.jd, t1: b.jd, r0: a.r, v0: sol.v1 });
    }
    // The coast runs about the Solar System barycentre with the mass of the Sun and planets: far
    // outside the planets that is the fixed focus, while the Sun itself wobbles by 0.01 AU.
    const c = tr.coast;
    const sunR = eph('sun', c.epochJd, vec3());
    const sunV = v3sub(vec3(), eph('sun', c.epochJd + 1, vec3()), eph('sun', c.epochJd - 1, vec3()));
    v3scale(sunV, sunV, 1 / (2 * DAY));
    this.coast = {
      jd: c.epochJd,
      r: vec3(c.posKm[0] * KM + sunR.x, c.posKm[1] * KM + sunR.y, c.posKm[2] * KM + sunR.z),
      v: vec3(c.velKmS[0] * KM + sunV.x, c.velKmS[1] * KM + sunV.y, c.velKmS[2] * KM + sunV.z),
    };
    const last = this.nodes[this.nodes.length - 1];
    v3sub(this.seam, last.r, this.coastConic(last.jd, vec3()));
  }

  /** The coast conic relative to the Sun at `jd`. */
  private coastConic(jd: JD, out: Vec3d): Vec3d {
    propagate(this.coast.r, this.coast.v, (jd - this.coast.jd) * DAY, GM_SYSTEM, out);
    return v3sub(out, out, this.eph('sun', jd, vec3()));
  }

  /** Position relative to the Sun, ICRF axes, m. */
  heliocentric(jd: JD, out: Vec3d): Vec3d {
    if (jd <= this.launchJd) {
      // Not launched yet: parked at Earth (the module hides the craft).
      v3sub(out, this.eph('earth', jd, out), this.eph('sun', jd, vec3()));
      return v3add(out, out, this.firstOffset);
    }
    for (const leg of this.legs) {
      if (jd < leg.t1) return propagate(leg.r0, leg.v0, (jd - leg.t0) * DAY, GM_SUN, out);
    }
    this.coastConic(jd, out);
    const x = (jd - this.coastJd) / BLEND_DAYS;
    if (x < 1) {
      const w = 1 - x * x * (3 - 2 * x);
      v3addScaled(out, out, this.seam, w);
    }
    return out;
  }

  /** Velocity relative to the Sun, ICRF axes, m/s (central difference over two hours). */
  velocity(jd: JD, out: Vec3d): Vec3d {
    const h = 1 / 24;
    const a = this.heliocentric(jd - h, vec3());
    this.heliocentric(jd + h, out);
    return v3scale(out, v3sub(out, out, a), 1 / (2 * h * DAY));
  }

  position(jd: JD, out: Vec3d): Vec3d {
    return v3add(out, this.heliocentric(jd, out), this.eph('sun', jd, vec3()));
  }

  ssbPosition(jd: JD, out: Vec3d): Vec3d {
    return this.position(jd, out);
  }

  orientation(jd: JD, out: Quatd): Quatd {
    // Dish (+z) to Earth; before launch and in the first hours, to the Sun's side instead.
    const toEarth = v3sub(vec3(), this.eph('earth', jd, vec3()), this.position(jd, vec3()));
    if (v3len(toEarth) < 1e8) v3scale(toEarth, this.heliocentric(jd, toEarth), -1);
    return attitude(ECLIPTIC_NORTH, toEarth, out);
  }

  /**
   * Heliocentric polyline from launch to `jd` (xyz triples, m) appended to `out`: every leg up to
   * `jd`, then `coastSamples` points along the coast, ending exactly at the craft. Returns the
   * number of points written (0 before launch).
   */
  samplePath(jd: JD, coastSamples: number, out: number[]): number {
    if (jd <= this.launchJd) return 0;
    const p = vec3();
    let count = 0;
    const push = (t: JD) => {
      this.heliocentric(t, p);
      out.push(p.x, p.y, p.z);
      count++;
    };
    for (const leg of this.legs) {
      const end = Math.min(jd, leg.t1);
      for (let k = 0; k < LEG_SAMPLES; k++) push(leg.t0 + ((end - leg.t0) * k) / LEG_SAMPLES);
      if (jd <= leg.t1) {
        push(jd);
        return count;
      }
    }
    // Coast: denser near the flyby, where the path still curves (quadratic spacing in time).
    for (let k = 0; k < coastSamples; k++) {
      const s = k / coastSamples;
      push(this.coastJd + (jd - this.coastJd) * s * s);
    }
    push(jd);
    return count;
  }
}

/** Builds the model for a row. */
export function createMotion(row: CraftRow, eph: Ephemeris): CraftMotion {
  if (row.kind === 'leo') return new LeoMotion(row, eph);
  if (row.kind === 'l2') return new HaloMotion(row, eph);
  return new ProbeMotion(row, eph);
}

/** Speed (m/s) of the parent-frame position at `jd`, by central difference over `stepSeconds`. */
export function speedAt(motion: CraftMotion, jd: JD, stepSeconds: number, heliocentric = false): number {
  const h = stepSeconds / DAY;
  const a = vec3();
  const b = vec3();
  const pos = (t: JD, out: Vec3d) => {
    if (heliocentric && motion instanceof HaloMotion) return motion.heliocentric(t, out);
    if (heliocentric && motion instanceof ProbeMotion) return motion.heliocentric(t, out);
    return motion.position(t, out);
  };
  pos(jd - h, a);
  pos(jd + h, b);
  return v3len(v3sub(b, b, a)) / (2 * stepSeconds);
}
