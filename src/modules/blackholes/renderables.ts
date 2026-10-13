/**
 * Black-hole renderables: S-star sprites and precessing orbit lines around Sgr A*, the large-scale
 * disk mesh of X-ray binaries, and Cygnus X-1's accretion stream. All camera-relative; per-frame
 * work only rewrites a few dozen floats (orbit lines rebuild only when ω has advanced noticeably).
 */
import {
  AdditiveBlending,
  BufferAttribute,
  DoubleSide,
  BufferGeometry,
  LineSegments,
  Mesh,
  Points,
  ShaderMaterial,
  Vector3,
  type IUniform,
} from 'three';
import type { Renderable, SharedUniforms, ViewState } from '../../core/contracts';
import { vec3 } from '../../core/math64';
import { AU } from '../../core/units';
import { apparentMag, blackbodyRgb, illuminanceFromMag } from '../../core/photometry';
import { BLACKBODY_GLSL, DEPTH_GLSL, NOISE_GLSL } from '../../render/chunks/index';
import { companionPhase, type CompanionOrbit, type Hole } from './catalog';
import { NT_PEAK_FLUX } from './disk';
import diskGlsl from './glsl/disk.glsl?raw';
import diskMeshFrag from './glsl/diskmesh.frag.glsl?raw';
import diskMeshVert from './glsl/diskmesh.vert.glsl?raw';
import linesFrag from './glsl/lines.frag.glsl?raw';
import linesVert from './glsl/lines.vert.glsl?raw';
import pointsFrag from './glsl/points.frag.glsl?raw';
import pointsVert from './glsl/points.vert.glsl?raw';
import streamFrag from './glsl/stream.frag.glsl?raw';
import streamVert from './glsl/stream.vert.glsl?raw';
import { apoapsis, omegaAt, sstarPosition, type SkyBasis, type SStarOrbit } from './sstars';
import type { BlackholeState } from './state';

const ORBIT_SEGMENTS = 192;
/** S-star radius used for the sprite/sphere crossover, m (B dwarfs, approximate). */
export const SSTAR_RADIUS = 6 * 6.957e8;
const ORBIT_TINT: [number, number, number] = [0.45, 0.7, 1.0];

export interface SStarDeps {
  orbits: readonly SStarOrbit[];
  frames: readonly string[];
  basis: SkyBasis;
  holeFrame: string;
  exposure: IUniform<number>;
  state: BlackholeState;
}

/**
 * Sprite size (px) and mean pre-exposed luminance for illuminance E (lux), written into `out`:
 * a 2.5 px disc that grows (keeping the flux) once it would saturate.
 */
export function spriteFor(
  e: number,
  pixelAngle: number,
  exposure: number,
  out: { size: number; lum: number },
): { size: number; lum: number } {
  const base = 2.5;
  const omega = (s: number) => (Math.PI / 4) * (s * pixelAngle) ** 2;
  out.size = base;
  out.lum = (e / omega(base)) * exposure;
  if (out.lum > 1) {
    out.size = Math.min(base * Math.sqrt(out.lum), 9);
    out.lum = (e / omega(out.size)) * exposure;
  }
  return out;
}

export function createSStars(d: SStarDeps): Renderable[] {
  const n = d.orbits.length;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const geo = new BufferGeometry();
  const posAttr = new BufferAttribute(pos, 3);
  const colAttr = new BufferAttribute(col, 3);
  const sizeAttr = new BufferAttribute(size, 1);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('aColor', colAttr);
  geo.setAttribute('aSize', sizeAttr);
  const mat = new ShaderMaterial({
    vertexShader: `${DEPTH_GLSL}\n${pointsVert}`,
    fragmentShader: `${DEPTH_GLSL}\n${pointsFrag}`,
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  });
  const points = new Points(geo, mat);
  points.frustumCulled = false;
  const tints = d.orbits.map((o) => blackbodyRgb(o.row.teffK));
  const rel = vec3();
  const zero = vec3();
  const sprite = { size: 0, lum: 0 };

  const sprites: Renderable = {
    id: 'blackholes.sstars',
    layer: 'transparent',
    object: points,
    update(view: ViewState) {
      for (let i = 0; i < n; i++) {
        view.toCamera(d.frames[i], zero, rel);
        const dist = Math.hypot(rel.x, rel.y, rel.z);
        pos[i * 3] = rel.x;
        pos[i * 3 + 1] = rel.y;
        pos[i * 3 + 2] = rel.z;
        const e = illuminanceFromMag(apparentMag(d.orbits[i].row.absMagV, dist));
        const s = spriteFor(e, view.pixelAngle, view.exposure, sprite);
        // Fade out once the photosphere sphere takes over (> 3 px).
        const px = (2 * SSTAR_RADIUS) / (dist * view.pixelAngle);
        const fade = Math.max(0, Math.min(1, (4 - px) / 2));
        const t = tints[i];
        col[i * 3] = t[0] * s.lum * fade;
        col[i * 3 + 1] = t[1] * s.lum * fade;
        col[i * 3 + 2] = t[2] * s.lum * fade;
        size[i] = s.size;
      }
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      sizeAttr.needsUpdate = true;
    },
    memoryBytes: () => n * 7 * 4,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };

  // Orbit lines: osculating ellipses at the current ω, rebuilt when ω moves by > 2e-4 rad.
  const lpos = new Float32Array(n * ORBIT_SEGMENTS * 2 * 3);
  const lcol = new Float32Array(lpos.length);
  const lgeo = new BufferGeometry();
  const lposAttr = new BufferAttribute(lpos, 3);
  lgeo.setAttribute('position', lposAttr);
  lgeo.setAttribute('aColor', new BufferAttribute(lcol, 3));
  const lmat = new ShaderMaterial({
    vertexShader: `${DEPTH_GLSL}\n${linesVert}`,
    fragmentShader: `${DEPTH_GLSL}\n${linesFrag}`,
    uniforms: { uOpacity: { value: 0.35 } },
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  });
  const lines = new LineSegments(lgeo, lmat);
  lines.frustumCulled = false;
  const built = new Float64Array(n).fill(NaN);
  const p = vec3();
  const maxApo = Math.max(...d.orbits.map(apoapsis));
  for (let i = 0; i < n; i++) {
    const s2 = d.orbits[i].row.id === 's2';
    for (let k = 0; k < ORBIT_SEGMENTS * 2; k++) {
      const o = (i * ORBIT_SEGMENTS * 2 + k) * 3;
      lcol[o] = s2 ? 1.0 : ORBIT_TINT[0];
      lcol[o + 1] = s2 ? 0.75 : ORBIT_TINT[1];
      lcol[o + 2] = s2 ? 0.35 : ORBIT_TINT[2];
    }
  }
  const orbitLines: Renderable = {
    id: 'blackholes.sstar-orbits',
    layer: 'transparent',
    object: lines,
    update(view: ViewState) {
      view.toCamera(d.holeFrame, zero, rel);
      const dist = Math.hypot(rel.x, rel.y, rel.z);
      // Hidden deep inside the cluster (close to the hole the lines only clutter the lensed sky).
      lines.visible = d.state.orbits && dist > 20 * AU && maxApo / dist / view.pixelAngle > 6;
      if (!lines.visible) return;
      lines.position.set(rel.x, rel.y, rel.z);
      let dirty = false;
      for (let i = 0; i < n; i++) {
        const o = d.orbits[i];
        const w = omegaAt(o, view.jd);
        if (Math.abs(w - built[i]) < 2e-4) continue;
        built[i] = w;
        dirty = true;
        for (let k = 0; k < ORBIT_SEGMENTS; k++) {
          for (let j = 0; j < 2; j++) {
            const E = ((k + j) / ORBIT_SEGMENTS) * 2 * Math.PI;
            sstarPosition(o, d.basis, view.jd, p, E, w);
            const q = ((i * ORBIT_SEGMENTS + k) * 2 + j) * 3;
            lpos[q] = p.x;
            lpos[q + 1] = p.y;
            lpos[q + 2] = p.z;
          }
        }
      }
      if (dirty) {
        lposAttr.needsUpdate = true;
        lgeo.computeBoundingSphere();
      }
    },
    memoryBytes: () => lpos.byteLength * 2,
    dispose() {
      lgeo.dispose();
      lmat.dispose();
    },
  };
  return [sprites, orbitLines];
}

/** Uniforms of glsl/disk.glsl for a hole (shared by the disk mesh). */
export function diskUniformsFor(h: Hole, shared: SharedUniforms): Record<string, IUniform> {
  return {
    uDiskN: { value: new Vector3(h.diskNormal.x, h.diskNormal.y, h.diskNormal.z) },
    uDiskA: { value: new Vector3(h.diskA.x, h.diskA.y, h.diskA.z) },
    uDiskB: { value: new Vector3(h.diskB.x, h.diskB.y, h.diskB.z) },
    uDiskIn: { value: 3 },
    uDiskOut: { value: h.disk.rOut },
    uDiskTmax: { value: h.disk.tMaxK },
    uDiskLum: { value: h.disk.lum },
    uFluxPeak: { value: NT_PEAK_FLUX },
    uPhase: { value: new Vector3(0, 0, 1) },
    uDoppler: { value: 1 },
    uGravity: { value: 1 },
    uObsShift: { value: 1 },
    uExposure: shared.uExposure,
    uBlackbodyLut: shared.uBlackbodyLut,
    uRiafT: { value: h.disk.riafTK },
    uRiafLum: { value: h.disk.riafLum },
  };
}

/**
 * Disk mesh out to `meshOutRs` (X-ray binaries, whose disks are far larger than the marched
 * sphere). Inside the lensing pass's sphere the mesh discards so the pass draws the inner disk.
 */
export function createDiskMesh(
  h: Hole,
  shared: SharedUniforms,
  state: BlackholeState,
  segments: { radial: number; angular: number },
  innerCut: () => number,
): Renderable {
  const { radial, angular } = segments;
  const rp = new Float32Array((radial + 1) * (angular + 1) * 2);
  const index: number[] = [];
  for (let i = 0; i <= radial; i++) {
    for (let j = 0; j <= angular; j++) {
      const o = (i * (angular + 1) + j) * 2;
      rp[o] = i / radial;
      rp[o + 1] = (j / angular) * 2 * Math.PI;
      if (i < radial && j < angular) {
        const a = i * (angular + 1) + j;
        const b = a + angular + 1;
        index.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('aRp', new BufferAttribute(rp, 2));
  // three needs a position attribute for draw-range bookkeeping; the shader ignores it.
  geo.setAttribute('position', new BufferAttribute(new Float32Array(rp.length * 1.5), 3));
  geo.setIndex(index);
  const disk = diskUniformsFor(h, shared);
  const uniforms = {
    ...disk,
    uRin: { value: 3 },
    uRout: { value: h.disk.meshOutRs ?? 1e4 },
    uRs: { value: h.rs },
    uInnerCut: { value: 3 },
    uMeshLum: { value: h.disk.meshLum ?? h.disk.lum },
    uRealistic: { value: 0 },
  };
  const mat = new ShaderMaterial({
    vertexShader: `${DEPTH_GLSL}\nuniform vec3 uDiskA;\nuniform vec3 uDiskB;\n${diskMeshVert}`,
    fragmentShader: `${DEPTH_GLSL}\n${BLACKBODY_GLSL}\n${NOISE_GLSL}\n${diskGlsl}\n${diskMeshFrag}`,
    uniforms,
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
    side: DoubleSide,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  const rel = vec3();
  const zero = vec3();
  return {
    id: `blackholes.disk.${h.id}`,
    layer: 'transparent',
    object: mesh,
    update(view: ViewState) {
      view.toCamera(h.frame, zero, rel);
      const dist = Math.hypot(rel.x, rel.y, rel.z);
      const outer = (h.disk.meshOutRs ?? 1e4) * h.rs;
      mesh.visible = state.disk && outer / dist / view.pixelAngle > 1.5;
      if (!mesh.visible) return;
      mesh.position.set(rel.x, rel.y, rel.z);
      uniforms.uInnerCut.value = innerCut();
      disk.uDoppler.value = state.beaming ? 1 : 0;
      disk.uGravity.value = state.redshift ? 1 : 0;
      uniforms.uRealistic.value = state.mode === 'realistic' ? 1 : 0;
    },
    memoryBytes: () => rp.byteLength * 2.5 + index.length * 4,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/** Deterministic LCG in [0, 1). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Cygnus X-1 style stream from the companion's inner face to the disk rim. */
export function createStream(
  h: Hole,
  orbit: CompanionOrbit,
  state: BlackholeState,
  count: number,
  streamLum: number,
): Renderable {
  const seeds = new Float32Array(count * 3);
  const rnd = lcg(226868);
  for (let i = 0; i < count; i++) {
    seeds[i * 3] = rnd();
    // Roughly Gaussian lateral spread (sum of uniforms).
    seeds[i * 3 + 1] = rnd() + rnd() + rnd() - 1.5;
    seeds[i * 3 + 2] = rnd() + rnd() + rnd() - 1.5;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('aSeed', new BufferAttribute(seeds, 3));
  geo.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
  const tint = blackbodyRgb(20000);
  const uniforms = {
    uFlow: { value: 0 },
    uStart: { value: orbit.a - orbit.radius },
    uRim: { value: 0.95 * (h.disk.meshOutRs ?? 1e4) * h.rs },
    uPhase: { value: 0 },
    uU1: { value: new Vector3(orbit.u1.x, orbit.u1.y, orbit.u1.z) },
    uU2: { value: new Vector3(orbit.u2.x, orbit.u2.y, orbit.u2.z) },
    uN: { value: new Vector3(orbit.n.x, orbit.n.y, orbit.n.z) },
    uSize: { value: 2 },
    uColor: { value: new Vector3() },
  };
  const mat = new ShaderMaterial({
    vertexShader: `${DEPTH_GLSL}\n${streamVert}`,
    fragmentShader: `${DEPTH_GLSL}\n${streamFrag}`,
    uniforms,
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  });
  const pts = new Points(geo, mat);
  pts.frustumCulled = false;
  const rel = vec3();
  const zero = vec3();
  let flow = 0;
  const crossing = 0.25 * orbit.periodS;
  return {
    id: `blackholes.stream.${h.id}`,
    layer: 'transparent',
    object: pts,
    update(view: ViewState) {
      view.toCamera(h.frame, zero, rel);
      const dist = Math.hypot(rel.x, rel.y, rel.z);
      pts.visible = state.disk && orbit.a / dist / view.pixelAngle > 4;
      if (!pts.visible) return;
      pts.position.set(rel.x, rel.y, rel.z);
      flow += Math.max(-1 / 90, Math.min(1 / 90, view.dtSim / crossing));
      flow -= Math.floor(flow);
      uniforms.uFlow.value = flow;
      const ph = companionPhase(orbit, view.jd) % (2 * Math.PI);
      uniforms.uPhase.value = ph;
      uniforms.uSize.value = view.viewport[1] < 400 ? 2 : 3;
      const l = streamLum * view.exposure;
      uniforms.uColor.value.set(tint[0] * l, tint[1] * l, tint[2] * l);
    },
    memoryBytes: () => seeds.byteLength * 2,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
