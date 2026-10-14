/**
 * Exoplanet rendering (P4-C): per-planet SurfaceShading (class tint lit by the host star) and one
 * 'exoplanets.system' Renderable for the active system: orbit ellipses, the host's habitable-zone ring
 * and point markers for planets too small to resolve. Buffers are allocated once (MAX_PLANETS) and
 * rewritten only on activation; the renderable is hidden when no system is active (zero draw calls).
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  LineSegments,
  Mesh,
  Points,
  ShaderMaterial,
  Vector3,
  type IUniform,
} from 'three';
import type { Renderable, SurfaceShading, Vec3d, ViewState } from '../../core/contracts';
import { blackbodyRgb, illuminanceFromMag } from '../../core/photometry';
import { AU, PC } from '../../core/units';
import { DEPTH_GLSL } from '../../render/chunks/index';
import { orbitOffset, type Elements, type SkyBasis } from '../starsystems/public';
import { CLASS_STYLE, type PlanetClass } from './classify';
import fragmentShader from './orbit.frag.glsl?raw';
import vertexShader from './orbit.vert.glsl?raw';
import planetGlsl from './planet.glsl?raw';

export const MAX_PLANETS = 12;
const ORBIT_SEGMENTS = 96;
const RING_SEGMENTS = 96;
const ORBIT_ALPHA = 0.18;
const HZ_ALPHA = 0.07;
const HZ_RGB: [number, number, number] = [0.25, 0.9, 0.35];

const hexRgb = (css: string): [number, number, number] => {
  const n = parseInt(css.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** SurfaceShading for one planet; `host()` gives the host frame and absolute magnitude. */
export function planetShading(
  bodyId: string,
  frame: string,
  cls: PlanetClass,
  host: () => { frame: string; absMagV: number; teff: number } | null,
): SurfaceShading {
  const style = CLASS_STYLE[cls];
  const uniforms: Record<string, IUniform> = {
    uExoHostPos: { value: new Vector3() },
    uExoHostLux: { value: new Vector3() },
    uExoAlbedo: { value: new Vector3(...style.albedo) },
    uExoBands: { value: style.bands },
    uExoGlow: { value: new Vector3(...style.glow) },
  };
  const h: Vec3d = { x: 0, y: 0, z: 0 };
  const p: Vec3d = { x: 0, y: 0, z: 0 };
  const zero: Vec3d = { x: 0, y: 0, z: 0 };
  let teff = -1;
  let rgb: [number, number, number] = [1, 1, 1];
  return {
    bodyId,
    priority: 10,
    glsl: planetGlsl,
    uniforms,
    update(view: ViewState) {
      const hs = host();
      if (!hs) return;
      view.toCamera(hs.frame, zero, h);
      view.toCamera(frame, zero, p);
      (uniforms.uExoHostPos.value as Vector3).set(h.x, h.y, h.z);
      const dPc = Math.max(1, Math.hypot(h.x - p.x, h.y - p.y, h.z - p.z)) / PC;
      const e = illuminanceFromMag(hs.absMagV + 5 * Math.log10(dPc / 10));
      if (hs.teff !== teff) {
        teff = hs.teff;
        rgb = blackbodyRgb(teff);
      }
      (uniforms.uExoHostLux.value as Vector3).set(e * rgb[0], e * rgb[1], e * rgb[2]);
    },
  };
}

export interface SystemPlanet {
  el: Elements;
  cls: PlanetClass;
}

export interface SystemOverlay extends Renderable {
  /** Shows a system: host frame, sky basis, planets and the HZ (AU). null hides. */
  show(sys: { frame: string; basis: SkyBasis; planets: SystemPlanet[]; hz: [number, number] } | null): void;
  orbitsOn: boolean;
}

function overlayMaterial(alpha: number, pointSize: number, round: boolean): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: `${DEPTH_GLSL}\n${vertexShader}`,
    fragmentShader: `${DEPTH_GLSL}\n${fragmentShader}`,
    uniforms: {
      uAlpha: { value: alpha },
      uPointSize: { value: pointSize },
      uRound: { value: round ? 1 : 0 },
    },
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
}

export function createSystemOverlay(): SystemOverlay {
  const group = new Group();
  group.visible = false;
  // Orbits.
  const oPos = new Float32Array(MAX_PLANETS * ORBIT_SEGMENTS * 6);
  const oCol = new Float32Array(MAX_PLANETS * ORBIT_SEGMENTS * 6);
  const oGeo = new BufferGeometry();
  oGeo.setAttribute('position', new BufferAttribute(oPos, 3));
  oGeo.setAttribute('aColor', new BufferAttribute(oCol, 3));
  const orbits = new LineSegments(oGeo, overlayMaterial(ORBIT_ALPHA, 1, false));
  // Habitable-zone annulus (triangle list).
  const rPos = new Float32Array(RING_SEGMENTS * 18);
  const rCol = new Float32Array(RING_SEGMENTS * 18);
  for (let k = 0; k < rCol.length; k += 3) rCol.set(HZ_RGB, k);
  const rGeo = new BufferGeometry();
  rGeo.setAttribute('position', new BufferAttribute(rPos, 3));
  rGeo.setAttribute('aColor', new BufferAttribute(rCol, 3));
  const ringMat = overlayMaterial(HZ_ALPHA, 1, false);
  ringMat.side = 2; // DoubleSide
  const ring = new Mesh(rGeo, ringMat);
  // Markers.
  const mPos = new Float32Array(MAX_PLANETS * 3);
  const mCol = new Float32Array(MAX_PLANETS * 3);
  const mGeo = new BufferGeometry();
  const mPosAttr = new BufferAttribute(mPos, 3);
  mGeo.setAttribute('position', mPosAttr);
  mGeo.setAttribute('aColor', new BufferAttribute(mCol, 3));
  const markers = new Points(mGeo, overlayMaterial(0.9, 5, true));
  for (const o of [orbits, ring, markers]) {
    o.frustumCulled = false;
    group.add(o);
  }

  let active: { frame: string; basis: SkyBasis; planets: SystemPlanet[] } | null = null;
  const rel: Vec3d = { x: 0, y: 0, z: 0 };
  const tmp: Vec3d = { x: 0, y: 0, z: 0 };
  const zero: Vec3d = { x: 0, y: 0, z: 0 };
  const self: SystemOverlay = {
    id: 'exoplanets.system',
    layer: 'transparent',
    object: group,
    orbitsOn: true,
    show(sys) {
      active = sys;
      group.visible = !!sys;
      if (!sys) return;
      const n = Math.min(MAX_PLANETS, sys.planets.length);
      // Orbit ellipses sampled in mean anomaly via orbitOffset at fractions of the period.
      let v = 0;
      for (let k = 0; k < n; k++) {
        const pl = sys.planets[k];
        const c = hexRgb(CLASS_STYLE[pl.cls].css);
        const el = { ...pl.el, m0: 0 };
        let prev: Vec3d | null = null;
        for (let s = 0; s <= ORBIT_SEGMENTS; s++) {
          // jd offset so that M sweeps 0..2pi over one period (J2000 epoch).
          const jd = 2451545 + (pl.el.periodYr * 365.25 * s) / ORBIT_SEGMENTS;
          const q = orbitOffset(el, sys.basis, jd, { x: 0, y: 0, z: 0 });
          if (prev) {
            oPos.set([prev.x, prev.y, prev.z, q.x, q.y, q.z], 6 * v);
            oCol.set([...c, ...c], 6 * v);
            v++;
          }
          prev = q;
        }
        mCol.set(c, 3 * k);
      }
      oGeo.setDrawRange(0, 2 * v);
      oGeo.attributes.position.needsUpdate = true;
      oGeo.attributes.aColor.needsUpdate = true;
      mGeo.attributes.aColor.needsUpdate = true;
      mGeo.setDrawRange(0, n);
      // HZ annulus in the plane of the first planet's orbit (circular, AU -> m).
      const ref = sys.planets[0]?.el;
      if (ref) {
        const circ = { ...ref, e: 0, m0: 0 };
        const [r0, r1] = sys.hz;
        const pts: Vec3d[] = [];
        for (let s = 0; s <= RING_SEGMENTS; s++) {
          const jd = 2451545 + (ref.periodYr * 365.25 * s) / RING_SEGMENTS;
          pts.push(orbitOffset({ ...circ, a: 1 }, sys.basis, jd, { x: 0, y: 0, z: 0 }));
        }
        for (let s = 0; s < RING_SEGMENTS; s++) {
          const a = pts[s];
          const b = pts[s + 1];
          const i0 = [a.x * r0 * AU, a.y * r0 * AU, a.z * r0 * AU];
          const o0 = [a.x * r1 * AU, a.y * r1 * AU, a.z * r1 * AU];
          const i1 = [b.x * r0 * AU, b.y * r0 * AU, b.z * r0 * AU];
          const o1 = [b.x * r1 * AU, b.y * r1 * AU, b.z * r1 * AU];
          rPos.set([...i0, ...o0, ...o1, ...i0, ...o1, ...i1], 18 * s);
        }
        rGeo.attributes.position.needsUpdate = true;
      }
      ring.visible = !!ref;
    },
    update(view) {
      if (!active) return;
      group.visible = self.orbitsOn;
      if (!self.orbitsOn) return;
      view.toCamera(active.frame, zero, rel);
      group.position.set(rel.x, rel.y, rel.z);
      const n = Math.min(MAX_PLANETS, active.planets.length);
      for (let k = 0; k < n; k++) {
        orbitOffset(active.planets[k].el, active.basis, view.jd, tmp);
        mPos[3 * k] = tmp.x;
        mPos[3 * k + 1] = tmp.y;
        mPos[3 * k + 2] = tmp.z;
      }
      mPosAttr.needsUpdate = true;
    },
    memoryBytes: () => 4 * (oPos.length * 2 + rPos.length * 2 + mPos.length * 2),
    dispose() {
      for (const o of [orbits, ring, markers]) {
        o.geometry.dispose();
        (o.material as ShaderMaterial).dispose();
      }
    },
  };
  return self;
}
