/**
 * Star promotion (P4-C): a named HYG star (or a whole star system from binaries.json) gets a Float64
 * frame and a Body once the camera is within PROMOTE_PC, so the solar-system sphere provider draws
 * its photosphere (sun/public.starSurface) at true size. While promoted, its HYG point is hidden
 * and a photometric sprite at the exact float64 position replaces it until the disk exceeds
 * SPHERE_MIN_PX. Bodies are removed again beyond RELEASE_PC; frames stay (cheap, and children such as
 * exoplanet frames may hang off them).
 */
import {
  MW_FRAME,
  SSB_FRAME,
  type Body,
  type FrameDef,
  type Registry,
  type Vec3d,
  type ViewState,
} from '../../core/contracts';
import type { FrameTree, InfoCard, Quatd, SharedUniforms } from '../../core/contracts';
import { qrotate } from '../../core/math64';
import { AU, PC, R_SUN } from '../../core/units';
import {
  createStarSprites,
  hideStars,
  HIDE_MAX,
  PM_PC_PER_KMS_YR,
  yearsSinceJ2000,
  type StarCatalog,
  type StarSprites,
} from '../stars/public';
import { starSurface } from '../sun/public';
import rowsJson from './binaries.json';
import { deg, estimateRadiusRsun, meanAnomalyJ2000, orbitOffset, skyBasis, type Elements } from './orbit';

/** Promote named stars within this distance of the camera, pc. */
export const PROMOTE_PC = 0.5;
/** Release them beyond this distance, pc (hysteresis). */
export const RELEASE_PC = 0.6;
/** Disk diameter (px) above which the sphere provider draws the star (solar-system POINT_MAX_PX). */
export const SPHERE_MIN_PX = 1.5;
const MAX_SPRITES = 16;
const SCAN_EVERY = 8;

export interface PromotedStar {
  /** Body id: 'hip:<n>' for HYG stars with a HIP id, otherwise a row or module id. */
  id: string;
  frame: string;
  name: string;
  teff: number;
  /** m */
  radius: number;
  absMag: number;
  bv: number | null;
  /** stars.bin index or -1. */
  hygIndex: number;
  massMsun?: number;
  approximate: boolean;
  source?: string;
}

/** A custom (non-HYG) star, e.g. an exoplanet host fainter than HYG. */
export interface CustomStar {
  id: string;
  name: string;
  teff: number;
  radius: number;
  absMag: number;
  massMsun?: number;
  /** Sun-centred ICRS position at J2000, pc. */
  positionPc: Vec3d;
  source?: string;
  /**
   * stars.bin index of the same star when HYG has it at a wrong distance (e.g. the 100 kpc no-parallax
   * placeholder): its catalogue point is hidden while this star is promoted. Default -1.
   */
  hygIndex?: number;
  /** Observed B-V for the sprite colour (default: the HYG value when hygIndex is set, else none). */
  bv?: number | null;
}

interface Group {
  id: string;
  stars: PromotedStar[];
  frames: FrameDef[];
  owners: Set<string>;
  centerPc(years: number, out: Vec3d): Vec3d;
}

interface Component {
  id: string;
  hip: number | null;
  name: string;
  massMsun: number;
  radiusRsun: number;
  teffK: number;
  absMagV?: number;
  source: string;
}
interface Row {
  id: string;
  name: string;
  primaryHip: number;
  distancePc: number;
  distanceSource: string;
  orbit?: {
    periodYr: number;
    periastronYr: number;
    e: number;
    aArcsec: number;
    iDeg: number;
    nodeDeg: number;
    periDeg: number;
    approximate: boolean;
    source: string;
  };
  components: Component[];
}
/** Hand-entered system rows (binaries.json, each with a source). */
export const SYSTEM_ROWS: readonly Row[] = (rowsJson as { systems: Row[] }).systems;
const rows = { systems: SYSTEM_ROWS };

const ZERO: Vec3d = { x: 0, y: 0, z: 0 };
export const starFrameId = (idOrHip: string | number): string =>
  typeof idOrHip === 'number' ? `star:${idOrHip}` : `star:${idOrHip.replace(/^hip:/, '')}`;

/** Linear-motion position (pc) from a J2000 position and a velocity in km/s. */
function moving(p0: Vec3d, vKms: Vec3d): (years: number, out: Vec3d) => Vec3d {
  return (years, out) => {
    const k = years * PM_PC_PER_KMS_YR;
    out.x = p0.x + vKms.x * k;
    out.y = p0.y + vKms.y * k;
    out.z = p0.z + vKms.z * k;
    return out;
  };
}

export class Promoter {
  private readonly groups = new Map<string, Group>();
  private readonly byIndex = new Map<number, Group>();
  private readonly shaded = new Set<string>();
  private readonly active: Group[] = [];
  readonly sprites: StarSprites;
  // Proximity scan over named stars with a distance (J2000 pc, velocity pc/yr).
  private readonly scanIdx: Int32Array;
  private readonly scanPos: Float64Array;
  private readonly scanVel: Float64Array;
  private hidden: number[] = [];
  private readonly hideIdx = new Int32Array(MAX_SPRITES);
  private readonly hideDist = new Float64Array(MAX_SPRITES);
  private readonly tmp: Vec3d = { x: 0, y: 0, z: 0 };
  private readonly rel: Vec3d = { x: 0, y: 0, z: 0 };
  private readonly cam: Vec3d = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly cat: StarCatalog,
    private readonly frames: FrameTree,
    private readonly registry: Registry,
    shared: SharedUniforms,
  ) {
    this.sprites = createStarSprites('starsystems.sprites', shared, MAX_SPRITES);
    const idx = cat.names.rows.map((r) => r[0]).filter((i) => !cat.distanceUnknown(i));
    this.scanIdx = Int32Array.from(idx);
    this.scanPos = new Float64Array(3 * idx.length);
    this.scanVel = new Float64Array(3 * idx.length);
    idx.forEach((i, k) => {
      const p = cat.positionPc(i, 0, this.tmp);
      this.scanPos.set([p.x, p.y, p.z], 3 * k);
      const q = cat.positionPc(i, 1e4, this.tmp);
      this.scanVel.set(
        [
          (q.x - this.scanPos[3 * k]) / 1e4,
          (q.y - this.scanPos[3 * k + 1]) / 1e4,
          (q.z - this.scanPos[3 * k + 2]) / 1e4,
        ],
        3 * k,
      );
    });
  }

  /** The promoted star for a body id, if its group is active. */
  star(id: string): PromotedStar | undefined {
    for (const g of this.active) for (const s of g.stars) if (s.id === id) return s;
    return undefined;
  }

  /** Promotes the group containing HYG star `index` for `owner`; returns that star's frame id. */
  promoteIndex(index: number, owner: string): string | null {
    const g = this.groupForIndex(index);
    if (!g) return null;
    this.hold(g, owner);
    return g.stars.find((s) => s.hygIndex === index)?.frame ?? g.stars[0].frame;
  }

  /** Promotes a non-HYG star for `owner`; returns its frame id. */
  promoteCustom(c: CustomStar, owner: string): string {
    let g = this.groups.get(c.id);
    if (!g) {
      const frame = starFrameId(c.id);
      const at = moving(c.positionPc, ZERO);
      g = {
        id: c.id,
        owners: new Set(),
        centerPc: at,
        stars: [
          {
            id: c.id,
            frame,
            name: c.name,
            teff: c.teff,
            radius: c.radius,
            absMag: c.absMag,
            bv: c.bv ?? (c.hygIndex !== undefined && c.hygIndex >= 0 ? this.cat.bv(c.hygIndex) : null),
            hygIndex: c.hygIndex ?? -1,
            massMsun: c.massMsun,
            approximate: true,
            source: c.source,
          },
        ],
        frames: [this.singleFrame(frame, at, 1000 * AU)],
      };
      this.groups.set(c.id, g);
      if (c.hygIndex !== undefined && c.hygIndex >= 0) this.byIndex.set(c.hygIndex, g);
    }
    this.hold(g, owner);
    return g.stars[0].frame;
  }

  /** Drops every hold of `owner`. */
  release(owner: string): void {
    for (const g of [...this.active]) this.unhold(g, owner);
  }

  /** Per frame: proximity promotion (every SCAN_EVERY frames), sprites and hidden HYG points. */
  update(view: ViewState): void {
    const years = yearsSinceJ2000(view.jd);
    view.toCamera(SSB_FRAME, ZERO, this.tmp);
    const cam = this.cam;
    cam.x = -this.tmp.x / PC;
    cam.y = -this.tmp.y / PC;
    cam.z = -this.tmp.z / PC;
    if (view.frameIndex % SCAN_EVERY === 0 || view.test) this.scan(cam, years);

    if (this.active.length === 0) {
      this.sprites.setCount(0);
      if (this.hidden.length) this.setHidden(0);
      return;
    }
    let n = 0;
    let h = 0;
    for (const g of this.active) {
      for (const s of g.stars) {
        const rel = view.toCamera(s.frame, ZERO, this.rel);
        const d = Math.hypot(rel.x, rel.y, rel.z);
        if (s.hygIndex >= 0 && h < MAX_SPRITES) {
          this.hideIdx[h] = s.hygIndex;
          this.hideDist[h++] = d;
        }
        const px = (2 * s.radius) / (Math.max(d, 1) * view.pixelAngle);
        if (px <= SPHERE_MIN_PX && n < MAX_SPRITES) {
          rel.x /= PC;
          rel.y /= PC;
          rel.z /= PC;
          this.sprites.write(n++, rel, s.absMag, s.bv);
        }
      }
    }
    this.sprites.setCount(n);
    this.setHidden(h);
  }

  /** Hides the HIDE_MAX nearest of the first `h` candidates; calls hideStars only on change. */
  private setHidden(h: number): void {
    // Partial selection sort by distance (h is tiny).
    const m = Math.min(h, HIDE_MAX);
    for (let a = 0; a < m; a++) {
      let best = a;
      for (let b = a + 1; b < h; b++) if (this.hideDist[b] < this.hideDist[best]) best = b;
      const ti = this.hideIdx[a];
      const td = this.hideDist[a];
      this.hideIdx[a] = this.hideIdx[best];
      this.hideDist[a] = this.hideDist[best];
      this.hideIdx[best] = ti;
      this.hideDist[best] = td;
    }
    let same = m === this.hidden.length;
    for (let k = 0; same && k < m; k++) same = this.hidden[k] === this.hideIdx[k];
    if (same) return;
    this.hidden = Array.from(this.hideIdx.subarray(0, m));
    hideStars(this.hidden);
  }

  private scan(cam: Vec3d, years: number): void {
    const r2 = PROMOTE_PC * PROMOTE_PC;
    const pos = this.scanPos;
    const vel = this.scanVel;
    for (let k = 0; k < this.scanIdx.length; k++) {
      const dx = pos[3 * k] + vel[3 * k] * years - cam.x;
      if (dx * dx > r2) continue;
      const dy = pos[3 * k + 1] + vel[3 * k + 1] * years - cam.y;
      const dz = pos[3 * k + 2] + vel[3 * k + 2] * years - cam.z;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      const g = this.groupForIndex(this.scanIdx[k]);
      if (g) this.hold(g, 'near');
    }
    for (const g of [...this.active]) {
      if (!g.owners.has('near')) continue;
      const c = g.centerPc(years, this.tmp);
      if (Math.hypot(c.x - cam.x, c.y - cam.y, c.z - cam.z) > RELEASE_PC) this.unhold(g, 'near');
    }
  }

  private hold(g: Group, owner: string): void {
    if (g.owners.size === 0) {
      for (const f of g.frames) if (!this.frames.has(f.id)) this.registry.addFrame(f);
      for (const s of g.stars) {
        if (!this.registry.body(s.id)) this.registry.addBody(this.body(s, g));
        if (!this.shaded.has(s.id)) {
          this.shaded.add(s.id);
          this.registry.setSurfaceShading(starSurface(s.teff, s.radius, { bodyId: s.id }));
        }
      }
      this.active.push(g);
    }
    g.owners.add(owner);
  }

  private unhold(g: Group, owner: string): void {
    if (!g.owners.delete(owner) || g.owners.size > 0) return;
    for (const s of g.stars) if (this.registry.body(s.id)) this.registry.removeBody(s.id);
    this.active.splice(this.active.indexOf(g), 1);
  }

  private body(s: PromotedStar, g: Group): Body {
    const f = g.frames.find((x) => x.id === s.frame);
    return {
      id: s.id,
      name: s.name,
      kind: 'star',
      frame: s.frame,
      radius: s.radius,
      teff: s.teff,
      absMag: s.absMag,
      influenceRadius: f?.influenceRadius ?? 1000 * AU,
      labelPriority: 45,
    };
  }

  /**
   * A star (or barycentre) frame with ICRS axes. It hangs off 'mw', not 'ssb': the ssb influence sphere
   * is only ~1 pc, and the anchor search descends through influence spheres, so a camera near a star
   * anchors here (metre precision) instead of in 'mw' (32 km steps at 8 kpc).
   */
  private singleFrame(id: string, at: (years: number, out: Vec3d) => Vec3d, influence: number): FrameDef {
    const ssb = this.frames.get(SSB_FRAME)!;
    const q: Quatd = { x: 0, y: 0, z: 0, w: 1 };
    const p: Vec3d = { x: 0, y: 0, z: 0 };
    return {
      id,
      parent: MW_FRAME,
      influenceRadius: influence,
      positionAt: (jd, out) => {
        at(yearsSinceJ2000(jd), p);
        p.x *= PC;
        p.y *= PC;
        p.z *= PC;
        ssb.orientationAt!(jd, q);
        qrotate(out, q, p);
        const o = ssb.positionAt(jd, p);
        out.x += o.x;
        out.y += o.y;
        out.z += o.z;
        return out;
      },
      orientationAt: (jd, out) => ssb.orientationAt!(jd, out),
    };
  }

  /** HYG star -> its promotion group (a binaries.json system or the single star). */
  groupForIndex(index: number): Group | null {
    const cached = this.byIndex.get(index);
    if (cached) return cached;
    const cat = this.cat;
    if (index < 0 || index >= cat.count || cat.distanceUnknown(index)) return null;
    const hip = cat.nameRow(index)?.[1] ?? null;
    const row = rows.systems.find((r) => r.components.some((c) => c.hip !== null && c.hip === hip));
    const g = row ? this.rowGroup(row) : this.hygGroup(index, hip);
    for (const s of g.stars) if (s.hygIndex >= 0) this.byIndex.set(s.hygIndex, g);
    this.byIndex.set(index, g);
    this.groups.set(g.id, g);
    return g;
  }

  private hygGroup(index: number, hip: number | null): Group {
    const cat = this.cat;
    const id = cat.idOf(index);
    const frame = hip !== null ? starFrameId(hip) : starFrameId(`i${index}`);
    const teff = cat.teff(index);
    const absMag = cat.data.absMag[index];
    const at = (years: number, out: Vec3d) => cat.positionPc(index, years, out);
    return {
      id,
      owners: new Set(),
      centerPc: at,
      stars: [
        {
          id,
          frame,
          name: cat.displayName(index),
          teff,
          radius: estimateRadiusRsun(absMag, teff) * R_SUN,
          absMag,
          bv: cat.bv(index),
          hygIndex: index,
          approximate: true,
        },
      ],
      frames: [this.singleFrame(frame, at, 1000 * AU)],
    };
  }

  /** Finds the HYG index of a component without a named HIP (Sirius B = Gl 244B) near the primary. */
  private findCompanion(primary: number, c: Component): number {
    const cat = this.cat;
    const p = cat.positionPc(primary, 0, { x: 0, y: 0, z: 0 });
    const q = { x: 0, y: 0, z: 0 };
    const target = c.absMagV ?? 99;
    for (let i = 0; i < cat.count; i++) {
      if (i === primary || Math.abs(cat.data.absMag[i] - target) > 0.6) continue;
      cat.positionPc(i, 0, q);
      if (Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) < 0.01) return i;
    }
    return -1;
  }

  private rowGroup(row: Row): Group {
    const cat = this.cat;
    const primary = cat.findByHip(row.primaryHip);
    const idx = row.components.map((c) =>
      c.hip !== null ? cat.findByHip(c.hip) : this.findCompanion(primary, c),
    );
    const mass = row.components.map((c) => c.massMsun);
    const mTot = mass.reduce((a, b) => a + b, 0);
    // Barycentre direction: mass-weighted HYG directions (J2000); distance from the row; primary velocity.
    const dir = { x: 0, y: 0, z: 0 };
    idx.forEach((i, k) => {
      const p = cat.positionPc(i >= 0 ? i : primary, 0, this.tmp);
      const d = Math.hypot(p.x, p.y, p.z);
      dir.x += (mass[k] * p.x) / d;
      dir.y += (mass[k] * p.y) / d;
      dir.z += (mass[k] * p.z) / d;
    });
    const dl = Math.hypot(dir.x, dir.y, dir.z);
    const p0 = {
      x: (dir.x / dl) * row.distancePc,
      y: (dir.y / dl) * row.distancePc,
      z: (dir.z / dl) * row.distancePc,
    };
    const a1 = cat.positionPc(primary, 1e4, { x: 0, y: 0, z: 0 });
    const a0 = cat.positionPc(primary, 0, { x: 0, y: 0, z: 0 });
    const v = {
      x: (a1.x - a0.x) / 1e4 / PM_PC_PER_KMS_YR,
      y: (a1.y - a0.y) / 1e4 / PM_PC_PER_KMS_YR,
      z: (a1.z - a0.z) / 1e4 / PM_PC_PER_KMS_YR,
    };
    const center = moving(p0, v);
    const stars: PromotedStar[] = row.components.map((c, k) => {
      const i = idx[k];
      const hygAbs =
        i >= 0
          ? cat.data.absMag[i] + 5 * Math.log10(Math.hypot(a0.x, a0.y, a0.z) / row.distancePc)
          : (c.absMagV ?? 10);
      return {
        id: c.id,
        frame: starFrameId(c.hip ?? c.id),
        name: c.name,
        teff: c.teffK,
        radius: c.radiusRsun * R_SUN,
        absMag: c.absMagV ?? hygAbs,
        bv: i >= 0 ? cat.bv(i) : null,
        hygIndex: i,
        massMsun: c.massMsun,
        approximate: true,
        source: c.source,
      };
    });
    const sysFrame = `sys:${row.id}`;
    const o = row.orbit;
    if (!o || stars.length < 2) {
      return {
        id: row.id,
        owners: new Set(),
        centerPc: center,
        stars,
        frames: [this.singleFrame(stars[0].frame, center, 1000 * AU)],
      };
    }
    const aM = o.aArcsec * row.distancePc * AU;
    const el: Elements = {
      a: aM,
      e: o.e,
      i: deg(o.iDeg),
      node: deg(o.nodeDeg),
      peri: deg(o.periDeg),
      periodYr: o.periodYr,
      m0: meanAnomalyJ2000(o.periastronYr, o.periodYr),
    };
    const basis = skyBasis({ x: p0.x / row.distancePc, y: p0.y / row.distancePc, z: p0.z / row.distancePc });
    const frac = [-mass[1] / mTot, mass[0] / mTot];
    const compInfluence = 0.3 * aM * (1 - o.e);
    const frames: FrameDef[] = [
      { ...this.singleFrame(sysFrame, center, Math.max(1000 * AU, 40 * aM)) },
      ...stars.slice(0, 2).map((s, k): FrameDef => ({
        id: s.frame,
        parent: sysFrame,
        influenceRadius: compInfluence,
        positionAt: (jd, out) => {
          orbitOffset(el, basis, jd, out);
          out.x *= frac[k];
          out.y *= frac[k];
          out.z *= frac[k];
          return out;
        },
      })),
    ];
    return { id: row.id, owners: new Set(), centerPc: center, stars, frames };
  }

  /** Info card for promoted stars that the stars module does not describe (no HYG name row). */
  info(id: string): InfoCard | null {
    const s = this.star(id);
    if (!s || s.hygIndex >= 0) return null;
    return {
      title: s.name,
      subtitle: 'Star (promoted)',
      facts: [
        { label: 'Radius', value: +(s.radius / R_SUN).toPrecision(3), unit: 'R☉', source: s.source },
        { label: 'Effective temperature', value: Math.round(s.teff), unit: 'K', approximate: s.approximate },
        ...(s.massMsun ? [{ label: 'Mass', value: s.massMsun, unit: 'M☉', source: s.source }] : []),
        { label: 'Absolute magnitude', value: +s.absMag.toFixed(2), approximate: true },
      ],
    };
  }
}
