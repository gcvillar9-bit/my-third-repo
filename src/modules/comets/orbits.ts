/**
 * Comet orbit lines in the style of the planets' (display-referred, per-vertex alpha, vertices evaluated in
 * float64 relative to the camera every frame). One LineSegments holds every comet. A line shows only while
 * its comet is active (within about 5 AU of the Sun) or is the camera's target, so the dozens of AU of a
 * dormant comet's path do not clutter the planetary system. Near-parabolic orbits are drawn out to
 * ORBIT_DRAW_AU and fade towards the ends.
 */
import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  LineSegments,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { Renderable, ViewState } from '../../core/contracts';
import { v3dot, v3len, vec3 } from '../../core/math64';
import { AU } from '../../core/units';
import { DEPTH_GLSL } from '../../render/chunks/index';
import orbitGlsl from './glsl/orbit.glsl?raw';
import { smoothstep } from './model';
import type { CometOrbit } from './orbit';
import type { CometScene } from './scene';

export const ORBIT_SEGMENTS = 192;
/** Orbits are drawn out to this heliocentric distance, m. */
export const ORBIT_DRAW_AU = 45;
export const ORBIT_COLOR: readonly [number, number, number] = [0.25, 0.62, 0.6];

/**
 * True anomalies of ORBIT_SEGMENTS + 1 orbit samples. Open arcs: uniform within the drawn range. Closed
 * ellipses: half the samples uniform in true anomaly about the Sun and half about the empty focus, so both
 * tight ends of an elongated ellipse are smooth.
 */
export function orbitAnomalies(
  orbit: CometOrbit,
  segments = ORBIT_SEGMENTS,
): { nu: Float64Array; closed: boolean } {
  const nuMax = orbit.trueAnomalyWithin(ORBIT_DRAW_AU * AU);
  const nu = new Float64Array(segments + 1);
  if (nuMax < Math.PI) {
    for (let k = 0; k <= segments; k++) nu[k] = -nuMax + (2 * nuMax * k) / segments;
    return { nu, closed: false };
  }
  const e = orbit.e;
  const kE = Math.sqrt((1 - e) / (1 + e));
  // Eccentric anomaly of a true anomaly, and back.
  const toE = (v: number) => 2 * Math.atan2(kE * Math.sin(v / 2), Math.cos(v / 2));
  const toNu = (E: number) => 2 * Math.atan2(Math.sin(E / 2), kE * Math.cos(E / 2));
  const half = segments / 2;
  const Es: number[] = [];
  for (let k = 0; k < half; k++) {
    const v = -Math.PI + (2 * Math.PI * (k + 0.5)) / half;
    const E = toE(v);
    Es.push(E, E > 0 ? Math.PI - E : -Math.PI - E); // mirrored about the centre: dense at aphelion
  }
  Es.sort((a, b) => a - b);
  for (let k = 0; k < segments; k++) nu[k] = toNu(Es[k]);
  nu[segments] = nu[0] + 2 * Math.PI;
  return { nu, closed: true };
}

/** Opacity of an orbit of size `scale` (m) seen from `dCenter` at `pixelAngle` (small on screen: hidden). */
export const orbitOpacity = (scale: number, dCenter: number, pixelAngle: number): number =>
  smoothstep(3, 15, scale / Math.max(dCenter, 1) / pixelAngle);

interface Track {
  /** Sample points relative to the orbit centre, m (float64). */
  pts: Float64Array;
  closed: boolean;
  scale: number;
  cleared: boolean;
}

export interface CometOrbitsDeps {
  scene: CometScene;
  /** Body id the camera targets or the UI has selected (its orbit always shows). */
  emphasis(): string | null;
  /** The app's orbit-lines switch (read every frame). */
  show(): boolean;
}

export function createCometOrbits(deps: CometOrbitsDeps): Renderable {
  const { scene } = deps;
  const views = scene.views;
  const n = views.length;
  const S = ORBIT_SEGMENTS;
  const tmp = vec3();
  const tracks: Track[] = views.map((v) => {
    const { orbit } = v.comet;
    const { nu, closed } = orbitAnomalies(orbit);
    const pts = new Float64Array(3 * (S + 1));
    for (let k = 0; k <= S; k++) {
      orbit.pointAtTrueAnomaly(nu[k], tmp);
      pts.set([tmp.x, tmp.y, tmp.z], 3 * k);
    }
    return { pts, closed, scale: 0.5 * Math.min(orbit.aphelion, ORBIT_DRAW_AU * AU), cleared: true };
  });
  const pos = new Float32Array(n * S * 2 * 3);
  const alpha = new Float32Array(n * S * 2);
  const geometry = new BufferGeometry();
  const posAttr = new BufferAttribute(pos, 3).setUsage(DynamicDrawUsage);
  const alphaAttr = new BufferAttribute(alpha, 1).setUsage(DynamicDrawUsage);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('aAlpha', alphaAttr);
  const [vs, fs] = orbitGlsl.split(/^\/\/#fragment$/m);
  const material = new ShaderMaterial({
    vertexShader: `${DEPTH_GLSL}\n${vs}`,
    fragmentShader: `${DEPTH_GLSL}\n${fs}`,
    uniforms: { uColor: { value: new Vector3(...ORBIT_COLOR) } },
    transparent: true,
    depthWrite: false,
  });
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.visible = false;
  lines.name = 'comets.orbits';

  const zero = vec3();
  const cRel = vec3();
  const vertexAlpha = new Float32Array(S + 1);
  const vx = new Float32Array(3 * (S + 1));

  return {
    id: 'comets.orbits',
    layer: 'transparent',
    object: lines,
    update(view: ViewState) {
      if (!scene.enabled || !deps.show()) {
        lines.visible = false;
        return;
      }
      const dNear = Math.max(view.nearestSurface()?.altitude ?? Infinity, 1);
      const emphasis = deps.emphasis();
      let any = false;
      let dirty = false;
      for (let i = 0; i < n; i++) {
        const v = views[i];
        const tr = tracks[i];
        const { orbit, center, row } = v.comet;
        let op = Math.max(v.activity, row.id === emphasis ? 1 : 0);
        if (op > 0) {
          view.toCamera(center, zero, cRel);
          op *= orbitOpacity(tr.scale, v3len(cRel), view.pixelAngle);
          // From close to any body (this comet's coma included) the line would cross the whole view.
          op *= 1 - smoothstep(30, 100, v.rSun / dNear);
          // Edge-on orbits collapse into a streak.
          op *= smoothstep(0.03, 0.12, Math.abs(v3dot(cRel, orbit.W)) / tr.scale);
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
        const near0 = 0.003 * tr.scale;
        const near1 = 0.03 * tr.scale;
        const gapPx = 1 / view.pixelAngle;
        for (let k = 0; k <= S; k++) {
          const x = tr.pts[3 * k] + cRel.x;
          const y = tr.pts[3 * k + 1] + cRel.y;
          const z = tr.pts[3 * k + 2] + cRel.z;
          vx[3 * k] = x;
          vx[3 * k + 1] = y;
          vx[3 * k + 2] = z;
          const dCam = Math.hypot(x, y, z);
          let a = 0.5 * op * smoothstep(near0, near1, dCam);
          // Open arcs fade out towards both ends.
          if (!tr.closed) a *= smoothstep(0, 0.12, Math.min(k, S - k) / S);
          // Leave a few pixels free around the comet's own head.
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
      return pos.byteLength + alpha.byteLength;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
