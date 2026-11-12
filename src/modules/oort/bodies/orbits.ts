/**
 * Orbit and trajectory lines of the oort objects, in the comets' and planets' style: one LineSegments,
 * display-referred colour with per-vertex alpha, vertices relative to the camera in float64 every frame.
 * Bound orbits are whole ellipses (Bernardinelli-Bernstein's reaches 40,400 AU), unbound ones hyperbolas
 * out to UNBOUND_DRAW_AU on each branch. Alpha = max(emphasis, lineFade) × the orbit-lines switch, so
 * nothing but a selected object's line shows within 200 AU of the Sun.
 */
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, LineSegments, ShaderMaterial } from 'three';
import type { Renderable, ViewState } from '../../../core/contracts';
import { v3dot, v3len, vec3 } from '../../../core/math64';
import { AU } from '../../../core/units';
import { DEPTH_GLSL } from '../../../render/chunks/index';
import type { CometOrbit } from '../../comets/public';
import { smoothstep, type OortShared } from '../shared';
import { GROUP_COLOR } from './data';
import lineGlsl from './glsl/line.glsl?raw';
import { lineAlpha, type ObjectScene } from './objects';

/** Samples per orbit line. */
export const ORBIT_SEGMENTS = 480;
/** Unbound trajectories are drawn out to this distance from the Sun on each branch, AU. */
export const UNBOUND_DRAW_AU = 150_000;
/** Size used for the on-screen fade of a hyperbola, AU (hidden from beyond about 100,000 AU). */
export const UNBOUND_SCALE_AU = 1000;
/** Peak alpha of a line. */
export const LINE_ALPHA = 0.55;

/**
 * Orbit samples relative to the orbit centre, m (float64, 3 per point, `segments + 1` points).
 * Ellipses: the union of three sets of equal size, uniform in true anomaly about the Sun (dense at
 * perihelion), uniform in the anomaly mirrored about the minor axis (dense at aphelion) and uniform in
 * eccentric anomaly (the long flanks); closed. Hyperbolas: uniform in hyperbolic anomaly F, so the spacing
 * grows with distance, out to `rMaxAu`; open.
 */
export function orbitSamples(
  orbit: CometOrbit,
  segments = ORBIT_SEGMENTS,
  rMaxAu = UNBOUND_DRAW_AU,
): { pts: Float64Array; closed: boolean } {
  const pts = new Float64Array(3 * (segments + 1));
  const { P, Q, e, q } = orbit;
  const put = (k: number, x: number, y: number) => {
    pts[3 * k] = x * P.x + y * Q.x;
    pts[3 * k + 1] = x * P.y + y * Q.y;
    pts[3 * k + 2] = x * P.z + y * Q.z;
  };
  if (e < 1) {
    const a = q / (1 - e);
    const b = a * Math.sqrt(1 - e * e);
    const kE = Math.sqrt((1 - e) / (1 + e));
    const toE = (v: number) => 2 * Math.atan2(kE * Math.sin(v / 2), Math.cos(v / 2));
    const third = Math.floor(segments / 3);
    const Es: number[] = [];
    for (let k = 0; k < third; k++) {
      const E = toE(-Math.PI + (2 * Math.PI * (k + 0.5)) / third);
      Es.push(E, E > 0 ? Math.PI - E : -Math.PI - E);
    }
    const rest = segments - 2 * third;
    for (let k = 0; k < rest; k++) Es.push(-Math.PI + (2 * Math.PI * (k + 0.25)) / rest);
    Es.sort((x, y) => x - y);
    for (let k = 0; k < segments; k++) put(k, a * (Math.cos(Es[k]) - e), b * Math.sin(Es[k]));
    put(segments, a * (Math.cos(Es[0]) - e), b * Math.sin(Es[0]));
    return { pts, closed: true };
  }
  const A = q / (e - 1); // |a|
  const B = A * Math.sqrt(e * e - 1);
  // r = A (e cosh F − 1).
  const fMax = Math.acosh(((rMaxAu * AU) / A + 1) / e);
  for (let k = 0; k <= segments; k++) {
    const F = -fMax + (2 * fMax * k) / segments;
    put(k, A * (e - Math.cosh(F)), B * Math.sinh(F));
  }
  return { pts, closed: false };
}

/** Opacity of an orbit of size `scale` (m) seen from `dCenter` at `pixelAngle` (small on screen: hidden). */
export const orbitOpacity = (scale: number, dCenter: number, pixelAngle: number): number =>
  smoothstep(3, 15, scale / Math.max(dCenter, 1) / pixelAngle);

export interface OrbitLinesDeps {
  scene: ObjectScene;
  shared: OortShared;
  /** Body id the camera targets or the UI has selected (its line always shows). */
  emphasis(): string | null;
}

interface Track {
  pts: Float64Array;
  closed: boolean;
  scale: number;
  cleared: boolean;
}

export function createOrbitLines(deps: OrbitLinesDeps): Renderable {
  const { scene, shared } = deps;
  const views = scene.views;
  const n = views.length;
  const S = ORBIT_SEGMENTS;
  const tracks: Track[] = views.map((v) => {
    const { orbit } = v.obj;
    const { pts, closed } = orbitSamples(orbit);
    const scale = closed ? 0.5 * orbit.aphelion : UNBOUND_SCALE_AU * AU;
    return { pts, closed, scale, cleared: true };
  });
  const pos = new Float32Array(n * S * 2 * 3);
  const alpha = new Float32Array(n * S * 2);
  const color = new Float32Array(n * S * 2 * 3);
  views.forEach((v, i) => {
    const c = GROUP_COLOR[v.obj.row.group];
    for (let j = 0; j < S * 2; j++) color.set(c, 3 * (i * S * 2 + j));
  });
  const geometry = new BufferGeometry();
  const posAttr = new BufferAttribute(pos, 3).setUsage(DynamicDrawUsage);
  const alphaAttr = new BufferAttribute(alpha, 1).setUsage(DynamicDrawUsage);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('aAlpha', alphaAttr);
  geometry.setAttribute('aColor', new BufferAttribute(color, 3));
  const [vs, fs] = lineGlsl.split(/^\/\/#fragment$/m);
  const material = new ShaderMaterial({
    vertexShader: `${DEPTH_GLSL}\n${vs}`,
    fragmentShader: `${DEPTH_GLSL}\n${fs}`,
    transparent: true,
    depthWrite: false,
  });
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.visible = false;
  lines.name = 'oort.orbits';

  const zero = vec3();
  const cRel = vec3();
  const vertexAlpha = new Float32Array(S + 1);
  const vx = new Float64Array(3 * (S + 1));

  return {
    id: 'oort.orbits',
    layer: 'transparent',
    object: lines,
    update(view: ViewState) {
      const dNear = Math.max(view.nearestSurface()?.altitude ?? Infinity, 1);
      const emphasis = deps.emphasis();
      let any = false;
      let dirty = false;
      for (let i = 0; i < n; i++) {
        const v = views[i];
        const tr = tracks[i];
        const { orbit, center, row } = v.obj;
        let op = lineAlpha(row.id === emphasis, shared.lineFade, shared.orbitLines);
        if (op > 0) {
          view.toCamera(center, zero, cRel);
          const dc = v3len(cRel);
          op *= orbitOpacity(tr.scale, dc, view.pixelAngle);
          // From close to any body (this object included) the line would cross the whole view.
          op *= 1 - smoothstep(30, 100, v.rSun / dNear);
          // Edge-on ellipses collapse into a streak (seen from far outside them).
          if (tr.closed && dc > tr.scale)
            op *= Math.max(
              smoothstep(0.02, 0.1, Math.abs(v3dot(cRel, orbit.W)) / dc),
              smoothstep(4, 2, dc / tr.scale),
            );
        }
        if (op < 0.01) {
          if (!tr.cleared) {
            alpha.fill(0, i * S * 2, (i + 1) * S * 2);
            tr.cleared = true;
            dirty = true;
          }
          continue;
        }
        any = true;
        dirty = true;
        tr.cleared = false;
        const gapPx = 1 / view.pixelAngle;
        const near0 = 1e-4 * tr.scale;
        const near1 = 2e-3 * tr.scale;
        for (let k = 0; k <= S; k++) {
          const x = tr.pts[3 * k] + cRel.x;
          const y = tr.pts[3 * k + 1] + cRel.y;
          const z = tr.pts[3 * k + 2] + cRel.z;
          vx[3 * k] = x;
          vx[3 * k + 1] = y;
          vx[3 * k + 2] = z;
          const dCam = Math.hypot(x, y, z);
          let a = LINE_ALPHA * op * smoothstep(near0, near1, dCam);
          if (!tr.closed) a *= smoothstep(0, 0.08, Math.min(k, S - k) / S);
          // A few pixels free around the object itself.
          if (dCam > 0 && v.dist > 0) {
            const sep = Math.hypot(x - v.rel.x, y - v.rel.y, z - v.rel.z) / dCam;
            a *= smoothstep(4, 10, sep * gapPx);
          }
          vertexAlpha[k] = a;
        }
        let o = i * S * 2;
        for (let k = 0; k < S; k++) {
          for (let s = 0; s < 2; s++) {
            const j = k + s;
            pos[3 * o] = vx[3 * j];
            pos[3 * o + 1] = vx[3 * j + 1];
            pos[3 * o + 2] = vx[3 * j + 2];
            alpha[o] = vertexAlpha[j];
            o++;
          }
        }
      }
      lines.visible = any;
      if (dirty) {
        posAttr.needsUpdate = true;
        alphaAttr.needsUpdate = true;
      }
    },
    memoryBytes() {
      return pos.byteLength + alpha.byteLength + color.byteLength;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
