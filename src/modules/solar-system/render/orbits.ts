/**
 * Orbit lines. Each orbit is a conic (Kepler rows: their fixed elements; astronomy-engine bodies:
 * the osculating ellipse of the current state, so the line always passes through the body).
 * Vertices are evaluated in float64 relative to the camera every frame and only then written to
 * Float32. Lines fade out when the orbit is small on screen, seen edge-on, near the camera, and
 * for the body the camera is visiting.
 */
import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  LineLoop,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { FrameId, Renderable, ViewState } from '../../../core/contracts';
import { v3cross, v3dot, v3len, v3sub, vec3 } from '../../../core/math64';
import { DEPTH_GLSL } from '../../../render/chunks/index';
import type { SolarEphemeris } from '../ephemeris';
import orbitGlsl from '../glsl/orbit.glsl?raw';
import { conicFromState, conicPoint, type Conic } from '../kepler';
import type { SceneState } from './scene-state';

export const ORBIT_SEGMENTS = 256;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const COLORS: Record<string, [number, number, number]> = {
  planet: [0.2, 0.4, 0.9],
  dwarf: [0.6, 0.42, 0.22],
  minor: [0.6, 0.42, 0.22],
  moon: [0.35, 0.35, 0.4],
};

/** Opacity of an orbit of semi-major axis `a` seen from `dCenter` (m) at `pixelAngle`, before near-body fading. */
export function orbitOpacity(a: number, dCenter: number, pixelAngle: number): number {
  const px = a / Math.max(dCenter, 1) / pixelAngle;
  return smooth(3, 15, px);
}

interface OrbitLine {
  id: string;
  center: FrameId;
  /** Fixed conic of a Kepler row (null: osculating ellipse from the current state). */
  kepler: Conic | null;
  conic: Conic;
  mu: number;
  line: LineLoop;
  pos: Float32Array;
  alpha: Float32Array;
  posAttr: BufferAttribute;
  alphaAttr: BufferAttribute;
  material: ShaderMaterial;
}

export function createOrbits(eph: SolarEphemeris, scene: SceneState): Renderable {
  const group = new Group();
  group.name = 'solar-system.orbits';
  const [vs, fs] = orbitGlsl.split(/^\/\/#fragment$/m);
  const lines: OrbitLine[] = [];
  for (const row of eph.rows) {
    if (row.id === 'sun' || !row.parent) continue;
    const kep = eph.kepler(row.id) ?? null;
    const center: FrameId = kep ? eph.parentFrame(row.id) : row.parent;
    const pos = new Float32Array(3 * ORBIT_SEGMENTS);
    const alpha = new Float32Array(ORBIT_SEGMENTS);
    const geometry = new BufferGeometry();
    const posAttr = new BufferAttribute(pos, 3).setUsage(DynamicDrawUsage);
    const alphaAttr = new BufferAttribute(alpha, 1).setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', posAttr);
    geometry.setAttribute('aAlpha', alphaAttr);
    const material = new ShaderMaterial({
      vertexShader: `${DEPTH_GLSL}\n${vs}`,
      fragmentShader: `${DEPTH_GLSL}\n${fs}`,
      uniforms: {
        uColor: { value: new Vector3(...(COLORS[row.kind] ?? COLORS.moon)) },
        uOpacity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
    });
    const line = new LineLoop(geometry, material);
    line.frustumCulled = false;
    line.visible = false;
    line.name = `solar-system.orbit.${row.id}`;
    group.add(line);
    lines.push({
      id: row.id,
      center,
      kepler: kep,
      conic: kep ?? { a: 1, e: 0, P: vec3(1, 0, 0), Q: vec3(0, 1, 0) },
      mu: eph.mu(row.id),
      line,
      pos,
      alpha,
      posAttr,
      alphaAttr,
      material,
    });
  }

  const zero = vec3();
  const cRel = vec3();
  const p = vec3();
  const r = vec3();
  const v = vec3();
  const rp = vec3();
  const vp = vec3();
  const nrm = vec3();

  const osculate = (o: OrbitLine, jd: number): boolean => {
    eph.stateAt(o.id, jd, r, v);
    const parentFrame = eph.parentFrame(o.id);
    if (parentFrame !== o.center) {
      // Planets are stored relative to the SSB; their orbit is drawn around the Sun.
      eph.stateAt(o.center, jd, rp, vp);
      if (eph.parentFrame(o.center) !== parentFrame) return false;
      v3sub(r, r, rp);
      v3sub(v, v, vp);
    }
    return conicFromState(r, v, o.mu, o.conic) !== null;
  };

  return {
    id: 'solar-system.orbits',
    layer: 'transparent',
    object: group,
    update(view: ViewState) {
      // Scale of the current neighbourhood: orbits far larger than it are hidden (from near a
      // planet only its moons' orbits remain; from interplanetary space all of them show).
      let dNear = Infinity;
      for (const bv of scene.views.values()) dNear = Math.min(dNear, bv.dist);
      for (const o of lines) {
        const bv = scene.get(o.id);
        view.toCamera(o.center, zero, cRel);
        const a = o.kepler ? o.kepler.a : v3len(eph.stateAt(o.id, view.jd, r));
        let op = orbitOpacity(a, v3len(cRel), view.pixelAngle);
        if (bv) op *= smooth(30, 150, bv.dist / bv.body.radius);
        op *= 1 - smooth(30, 100, a / dNear);
        if (op < 0.01 || (!o.kepler && !osculate(o, view.jd))) {
          o.line.visible = false;
          continue;
        }
        const c = o.conic;
        // Edge-on orbits (camera close to the orbital plane) collapse into streaks: fade them.
        const h = v3cross(nrm, c.P, c.Q);
        op *= smooth(0.03, 0.12, Math.abs(v3dot(cRel, h)) / c.a);
        if (op < 0.01) {
          o.line.visible = false;
          continue;
        }
        const near0 = 0.003 * c.a;
        const near1 = 0.03 * c.a;
        for (let k = 0; k < ORBIT_SEGMENTS; k++) {
          conicPoint(c, (2 * Math.PI * k) / ORBIT_SEGMENTS, p);
          const x = p.x + cRel.x;
          const y = p.y + cRel.y;
          const z = p.z + cRel.z;
          o.pos[3 * k] = x;
          o.pos[3 * k + 1] = y;
          o.pos[3 * k + 2] = z;
          o.alpha[k] = smooth(near0, near1, Math.hypot(x, y, z));
        }
        o.posAttr.needsUpdate = true;
        o.alphaAttr.needsUpdate = true;
        o.material.uniforms.uOpacity.value = 0.5 * op;
        o.line.visible = true;
      }
    },
    memoryBytes() {
      return lines.reduce((s, o) => s + o.pos.byteLength + o.alpha.byteLength, 0);
    },
    dispose() {
      for (const o of lines) {
        o.line.geometry.dispose();
        o.material.dispose();
      }
    },
  };
}
