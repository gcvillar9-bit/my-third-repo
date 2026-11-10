/**
 * Comet renderables (three.js, camera-relative):
 *  - 'comets.nuclei' (opaque): one procedural rock per comet, built the first time it spans a pixel.
 *  - 'comets.glow' (transparent, additive): the coma volume, the ion and dust tail ribbons (built the first
 *    time a comet is active and in range) and one photometric point per comet for the unresolved head.
 * Every quantity comes from CometScene, so the point, the coma and the tails share one brightness.
 */
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  Matrix3,
  Matrix4,
  Mesh,
  Points,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type IUniform,
} from 'three';
import type { Renderable, ViewState } from '../../core/contracts';
import { quat, v3add, vec3 } from '../../core/math64';
import { SUN_RGB, luminance, planetPointIlluminance, solarIlluminance } from '../../core/photometry';
import { DEPTH_GLSL, NOISE_GLSL } from '../../render/chunks/index';
import comaGlsl from './glsl/coma.glsl?raw';
import nucleusGlsl from './glsl/nucleus.glsl?raw';
import pointGlsl from './glsl/point.glsl?raw';
import sheetGlsl from './glsl/sheet.glsl?raw';
import tailGlsl from './glsl/tail.glsl?raw';
import {
  DUST_BETAS,
  DUST_POINTS,
  ION_POINTS,
  createCurve,
  dustTail,
  dustTailLength,
  ionTail,
  ionTailLength,
  smoothstep,
  type TailCurve,
} from './model';
import { buildNucleus, hashString, nucleusSpin } from './nucleus';
import { COMA_EXTENT, type CometScene, type CometView } from './scene';
import { AU } from '../../core/units';

const split = (src: string): [string, string] => {
  const [vs, fs] = src.split(/^\/\/#fragment$/m);
  return [vs, fs];
};

type Rgb = [number, number, number];
const unitLuminance = ([r, g, b]: Rgb): Rgb => {
  const l = luminance(r, g, b);
  return [r / l, g / l, b / l];
};
/** Sunlight scattered by dust (slightly reddened), C2/CN gas glow, and CO+ ion emission; luminance 1. */
export const DUST_COLOR = unitLuminance([1.0, 0.93, 0.78]);
export const GAS_COLOR = unitLuminance([0.5, 1.0, 0.78]);
export const ION_COLOR = unitLuminance([0.22, 0.45, 1.0]);

/** Colour of a coma: dust continuum mixed with gas emission by the comet's gas fraction. */
export function comaColor(gas: number): Rgb {
  const g = Math.min(1, Math.max(0, gas));
  return [0, 1, 2].map((i) => DUST_COLOR[i] * (1 - g) + GAS_COLOR[i] * g) as Rgb;
}

/** Nucleus point/mesh crossfade, apparent diameter in px. */
export const NUCLEUS_POINT_PX = 1;
export const NUCLEUS_FULL_PX = 3;
/** Tails are rebuilt when the date moves by this many days. */
export const TAIL_REFRESH_DAYS = 0.02;
/** The 1/b rise of the coma column levels off inside this many nucleus radii (the dust is still being
 * accelerated and most of the gas glow forms further out), so the nucleus stays visible in its own haze. */
export const COMA_CORE_RADII = 1.3;
/** Integral over x = b / Rc of the coma cut-off exp(-x) (1 - smoothstep(2.4, 3, x)): normalises the column to I. */
export const COMA_CUT_INTEGRAL = 0.93;

/** Writes curves as camera-facing ribbon vertices (two per point) starting at vertex `base`. */
export function writeRibbon(
  c: TailCurve,
  base: number,
  pos: Float32Array,
  tan: Float32Array,
  par: Float32Array,
): number {
  const n = c.count;
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, k - 1);
    const b = Math.min(n - 1, k + 1);
    let tx = c.pos[3 * b] - c.pos[3 * a];
    let ty = c.pos[3 * b + 1] - c.pos[3 * a + 1];
    let tz = c.pos[3 * b + 2] - c.pos[3 * a + 2];
    const tl = Math.hypot(tx, ty, tz);
    if (tl > 0) {
      tx /= tl;
      ty /= tl;
      tz /= tl;
    } else tx = 1;
    for (let s = 0; s < 2; s++) {
      const v = base + 2 * k + s;
      pos[3 * v] = c.pos[3 * k];
      pos[3 * v + 1] = c.pos[3 * k + 1];
      pos[3 * v + 2] = c.pos[3 * k + 2];
      tan[3 * v] = tx;
      tan[3 * v + 1] = ty;
      tan[3 * v + 2] = tz;
      par[4 * v] = s === 0 ? -1 : 1;
      par[4 * v + 1] = c.sigma[k];
      par[4 * v + 2] = c.lum[k];
      par[4 * v + 3] = k / (n - 1);
    }
  }
  return base + 2 * n;
}

/** Triangle indices of `curves` ribbons of `points` points each. */
export function ribbonIndex(curves: number, points: number): Uint16Array {
  const idx = new Uint16Array(curves * (points - 1) * 6);
  let t = 0;
  for (let c = 0; c < curves; c++) {
    const b = c * points * 2;
    for (let k = 0; k < points - 1; k++) {
      const v = b + 2 * k;
      idx[t++] = v;
      idx[t++] = v + 1;
      idx[t++] = v + 2;
      idx[t++] = v + 1;
      idx[t++] = v + 3;
      idx[t++] = v + 2;
    }
  }
  return idx;
}

interface Ribbon {
  mesh: Mesh;
  geometry: BufferGeometry;
  material: ShaderMaterial;
  pos: Float32Array;
  tan: Float32Array;
  par: Float32Array;
  bytes: number;
}

/**
 * Writes the dust fan as a sheet: one row of vertices per syndyne plus a phantom row beyond each outer
 * syndyne (brightness zero) so that the fan's edges are soft. Returns the number of vertices written.
 */
export function writeSheet(curves: readonly TailCurve[], pos: Float32Array, lum: Float32Array): number {
  const rows = curves.length + 2;
  const n = curves[0].count;
  const EDGE = 0.8;
  for (let r = 0; r < rows; r++) {
    const j = Math.min(curves.length - 1, Math.max(0, r - 1));
    const phantom = r === 0 || r === rows - 1;
    // The neighbour a phantom row is mirrored through.
    const o = r === 0 ? Math.min(1, curves.length - 1) : Math.max(0, curves.length - 2);
    const c = curves[j];
    const d = curves[o];
    for (let k = 0; k < n; k++) {
      const v = r * n + k;
      for (let a = 0; a < 3; a++) {
        const x = c.pos[3 * k + a];
        pos[3 * v + a] = phantom ? x + EDGE * (x - d.pos[3 * k + a]) : x;
      }
      lum[v] = phantom ? 0 : c.fan[k];
    }
  }
  return rows * n;
}

/** Triangle indices of a sheet of `rows` x `cols` vertices. */
export function sheetIndex(rows: number, cols: number): Uint16Array {
  const idx = new Uint16Array((rows - 1) * (cols - 1) * 6);
  let t = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let k = 0; k < cols - 1; k++) {
      const v = r * cols + k;
      idx[t++] = v;
      idx[t++] = v + cols;
      idx[t++] = v + 1;
      idx[t++] = v + 1;
      idx[t++] = v + cols;
      idx[t++] = v + cols + 1;
    }
  }
  return idx;
}

interface Sheet {
  mesh: Mesh;
  geometry: BufferGeometry;
  material: ShaderMaterial;
  pos: Float32Array;
  lum: Float32Array;
  bytes: number;
}

interface Visual {
  nucleus?: { mesh: Mesh; material: ShaderMaterial; bytes: number };
  coma?: { mesh: Mesh; material: ShaderMaterial };
  ion?: Ribbon;
  dust?: Ribbon;
  fan?: Sheet;
  ionCurve?: TailCurve;
  dustCurves?: TailCurve[];
  tailJd: number;
}

export interface CometRenderDeps {
  scene: CometScene;
  exposure: IUniform<number>;
  /** Icosphere subdivision level of the nucleus mesh. */
  nucleusLevel(): number;
}

export interface CometRenderables {
  nuclei: Renderable;
  glow: Renderable;
}

export function createCometRenderables(deps: CometRenderDeps): CometRenderables {
  const { scene, exposure } = deps;
  const views = scene.views;
  const visuals: Visual[] = views.map(() => ({ tailJd: NaN }));
  const nucleiGroup = new Group();
  nucleiGroup.name = 'comets.nuclei';
  const glowGroup = new Group();
  glowGroup.name = 'comets.glow';
  const [nucVs, nucFs] = split(nucleusGlsl);
  const [comaVs, comaFs] = split(comaGlsl);
  const [tailVs, tailFs] = split(tailGlsl);
  const [pointVs, pointFs] = split(pointGlsl);
  const [sheetVs, sheetFs] = split(sheetGlsl);
  const pixelAngle = { value: 1e-3 };

  // ---- nuclei --------------------------------------------------------------------------------------
  const q = new Quaternion();
  const m4 = new Matrix4();
  const spin = quat();
  const buildNucleusMesh = (v: CometView): NonNullable<Visual['nucleus']> => {
    const { row } = v.comet;
    const seed = hashString(row.id);
    const mesh3 = buildNucleus(row.shape, seed, deps.nucleusLevel());
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(mesh3.pos, 3));
    geometry.setAttribute('normal', new BufferAttribute(mesh3.normal, 3));
    geometry.setIndex(new BufferAttribute(mesh3.index, 1));
    const material = new ShaderMaterial({
      vertexShader: `${DEPTH_GLSL}\n${nucVs}`,
      fragmentShader: `${DEPTH_GLSL}\n${NOISE_GLSL}\n${nucFs}`,
      uniforms: {
        uSunDir: { value: new Vector3(1, 0, 0) },
        uSunIlluminance: { value: new Vector3() },
        uBodyToWorld: { value: new Matrix3() },
        uAlbedo: { value: row.physical.albedo },
        uExposure: exposure,
        uFade: { value: 1 },
        uSeed: { value: (seed % 1000) / 10 },
      },
    });
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.name = `comets.nucleus.${row.id}`;
    nucleiGroup.add(mesh);
    return {
      mesh,
      material,
      bytes: mesh3.pos.byteLength + mesh3.normal.byteLength + mesh3.index.byteLength,
    };
  };

  const nuclei: Renderable = {
    id: 'comets.nuclei',
    layer: 'opaque',
    object: nucleiGroup,
    update(view: ViewState) {
      nucleiGroup.visible = scene.enabled;
      if (!scene.enabled) return;
      for (let i = 0; i < views.length; i++) {
        const v = views[i];
        const vis = visuals[i];
        const R = v.comet.body.radius;
        const px = v.dist > R ? (2 * R) / (v.dist * view.pixelAngle) : Infinity;
        if (px <= NUCLEUS_POINT_PX) {
          if (vis.nucleus) vis.nucleus.mesh.visible = false;
          continue;
        }
        const nuc = (vis.nucleus ??= buildNucleusMesh(v));
        const { mesh, material } = nuc;
        mesh.visible = true;
        mesh.position.set(v.rel.x, v.rel.y, v.rel.z);
        mesh.scale.setScalar(R);
        nucleusSpin(v.comet.row.id, v.comet.row.physical.rotationHours, view.jd, spin);
        q.set(spin.x, spin.y, spin.z, spin.w);
        mesh.quaternion.copy(q);
        const u = material.uniforms;
        (u.uBodyToWorld.value as Matrix3).setFromMatrix4(m4.makeRotationFromQuaternion(q));
        (u.uSunDir.value as Vector3).set(v.toSun.x / v.rSun, v.toSun.y / v.rSun, v.toSun.z / v.rSun);
        const E = solarIlluminance(v.rSun);
        (u.uSunIlluminance.value as Vector3).set(E * SUN_RGB[0], E * SUN_RGB[1], E * SUN_RGB[2]);
        u.uFade.value = smoothstep(NUCLEUS_POINT_PX, NUCLEUS_FULL_PX, px);
      }
    },
    memoryBytes() {
      return visuals.reduce((s, v) => s + (v.nucleus?.bytes ?? 0), 0);
    },
    dispose() {
      for (const v of visuals) {
        v.nucleus?.mesh.geometry.dispose();
        v.nucleus?.material.dispose();
        v.nucleus = undefined;
      }
    },
  };

  // ---- photometric points --------------------------------------------------------------------------
  const n = views.length;
  const pPos = new Float32Array(3 * n);
  const pFlux = new Float32Array(3 * n);
  const pGeometry = new BufferGeometry();
  const pPosAttr = new BufferAttribute(pPos, 3).setUsage(DynamicDrawUsage);
  const pFluxAttr = new BufferAttribute(pFlux, 3).setUsage(DynamicDrawUsage);
  pGeometry.setAttribute('position', pPosAttr);
  pGeometry.setAttribute('aFlux', pFluxAttr);
  const pMaterial = new ShaderMaterial({
    vertexShader: `${DEPTH_GLSL}\n${pointVs}`,
    fragmentShader: `${DEPTH_GLSL}\n${pointFs}`,
    uniforms: {
      uPointSize: { value: 5 },
      uSigma: { value: 0.75 },
      uPixelAngle: pixelAngle,
      uExposure: exposure,
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const points = new Points(pGeometry, pMaterial);
  points.frustumCulled = false;
  points.name = 'comets.points';
  glowGroup.add(points);

  // ---- coma and tails ------------------------------------------------------------------------------
  const comaGeometry = new SphereGeometry(1, 24, 16);
  const comaBytes =
    comaGeometry.getAttribute('position').count * 8 * 4 + (comaGeometry.index?.count ?? 0) * 2;
  const buildComa = (v: CometView): NonNullable<Visual['coma']> => {
    const material = new ShaderMaterial({
      vertexShader: `${DEPTH_GLSL}\n${comaVs}`,
      fragmentShader: `${DEPTH_GLSL}\n${comaFs}`,
      uniforms: {
        uCenter: { value: new Vector3() },
        uSunDir: { value: new Vector3(1, 0, 0) },
        uRc: { value: 1 },
        uSoft: { value: 1 },
        uK: { value: new Vector3() },
        uExposure: exposure,
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: BackSide,
    });
    const mesh = new Mesh(comaGeometry, material);
    mesh.frustumCulled = false;
    mesh.name = `comets.coma.${v.comet.row.id}`;
    glowGroup.add(mesh);
    return { mesh, material };
  };

  const buildRibbon = (v: CometView, kind: 'ion' | 'dust', curves: number, pts: number): Ribbon => {
    const verts = curves * pts * 2;
    const pos = new Float32Array(3 * verts);
    const tan = new Float32Array(3 * verts);
    const par = new Float32Array(4 * verts);
    const index = ribbonIndex(curves, pts);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(pos, 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute('aTangent', new BufferAttribute(tan, 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute('aParams', new BufferAttribute(par, 4).setUsage(DynamicDrawUsage));
    geometry.setIndex(new BufferAttribute(index, 1));
    const color = kind === 'ion' ? ION_COLOR : DUST_COLOR;
    const material = new ShaderMaterial({
      vertexShader: `${DEPTH_GLSL}\n${tailVs}`,
      fragmentShader: `${DEPTH_GLSL}\n${tailFs}`,
      uniforms: {
        uPixelAngle: pixelAngle,
        uColor: { value: new Vector3(...color) },
        uExposure: exposure,
        uStreak: { value: kind === 'ion' ? 1 : 0 },
        uSeed: { value: (hashString(v.comet.row.id) % 628) / 100 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.name = `comets.${kind}.${v.comet.row.id}`;
    glowGroup.add(mesh);
    return {
      mesh,
      geometry,
      material,
      pos,
      tan,
      par,
      bytes: pos.byteLength + tan.byteLength + par.byteLength + index.byteLength,
    };
  };

  const buildSheet = (v: CometView): Sheet => {
    const rows = DUST_BETAS.length + 2;
    const pos = new Float32Array(3 * rows * DUST_POINTS);
    const lum = new Float32Array(rows * DUST_POINTS);
    const index = sheetIndex(rows, DUST_POINTS);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(pos, 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute('aLum', new BufferAttribute(lum, 1).setUsage(DynamicDrawUsage));
    geometry.setIndex(new BufferAttribute(index, 1));
    const w = v.comet.orbit.W;
    const material = new ShaderMaterial({
      vertexShader: `${DEPTH_GLSL}\n${sheetVs}`,
      fragmentShader: `${DEPTH_GLSL}\n${sheetFs}`,
      uniforms: {
        uColor: { value: new Vector3(...DUST_COLOR) },
        uNormal: { value: new Vector3(w.x, w.y, w.z) },
        uExposure: exposure,
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.name = `comets.fan.${v.comet.row.id}`;
    glowGroup.add(mesh);
    return { mesh, geometry, material, pos, lum, bytes: pos.byteLength + lum.byteLength + index.byteLength };
  };

  const upload = (r: Ribbon) => {
    (r.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (r.geometry.getAttribute('aTangent') as BufferAttribute).needsUpdate = true;
    (r.geometry.getAttribute('aParams') as BufferAttribute).needsUpdate = true;
  };

  const sunToComet = vec3();
  const sunOffset = vec3();
  const cometPos = vec3();
  const rebuildTails = (v: CometView, vis: Visual, jd: number) => {
    const { row, orbit } = v.comet;
    sunToComet.x = -v.toSun.x;
    sunToComet.y = -v.toSun.y;
    sunToComet.z = -v.toSun.z;
    if (vis.ion) {
      vis.ionCurve = ionTail(row, sunToComet, scene.display, vis.ionCurve ?? createCurve(ION_POINTS));
      writeRibbon(vis.ionCurve, 0, vis.ion.pos, vis.ion.tan, vis.ion.par);
      upload(vis.ion);
    }
    if (vis.dust) {
      // The Sun relative to the orbit centre (zero for heliocentric elements).
      v3add(sunOffset, orbit.stateAt(jd, cometPos), v.toSun);
      vis.dustCurves = dustTail(row, orbit, jd, scene.display, sunOffset, vis.dustCurves);
      let base = 0;
      for (const c of vis.dustCurves) base = writeRibbon(c, base, vis.dust.pos, vis.dust.tan, vis.dust.par);
      upload(vis.dust);
      if (vis.fan) {
        writeSheet(vis.dustCurves, vis.fan.pos, vis.fan.lum);
        (vis.fan.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
        (vis.fan.geometry.getAttribute('aLum') as BufferAttribute).needsUpdate = true;
      }
    }
    vis.tailJd = jd;
  };

  const glow: Renderable = {
    id: 'comets.glow',
    layer: 'transparent',
    object: glowGroup,
    update(view: ViewState) {
      glowGroup.visible = scene.enabled;
      if (!scene.enabled) return;
      pixelAngle.value = view.pixelAngle;
      for (let i = 0; i < n; i++) {
        const v = views[i];
        const vis = visuals[i];
        const { row, body } = v.comet;
        const R = body.radius;
        const rAU = v.rSun / AU;
        const color = comaColor(row.look.gas);

        // Photometric point: the unresolved share of the coma plus the bare nucleus.
        const px = v.dist > R ? (2 * R) / (v.dist * view.pixelAngle) : Infinity;
        let eComa = 0;
        let eNuc = 0;
        if (v.dist > R) {
          eComa = (v.intensity / (v.dist * v.dist)) * (1 - v.resolved);
          const cosA = -(v.toSun.x * v.rel.x + v.toSun.y * v.rel.y + v.toSun.z * v.rel.z) / (v.rSun * v.dist);
          eNuc =
            planetPointIlluminance({
              rSun: v.rSun,
              distance: v.dist,
              radius: R,
              albedo: row.physical.albedo,
              phaseAngle: Math.acos(Math.min(1, Math.max(-1, cosA))),
            }) *
            (1 - smoothstep(NUCLEUS_POINT_PX, NUCLEUS_FULL_PX, px));
        }
        const k = v.dist > 0 ? Math.max(0, 1 - R / v.dist) : 0;
        pPos[3 * i] = v.rel.x * k;
        pPos[3 * i + 1] = v.rel.y * k;
        pPos[3 * i + 2] = v.rel.z * k;
        for (let c = 0; c < 3; c++) pFlux[3 * i + c] = eComa * color[c] + eNuc * SUN_RGB[c];

        // Coma volume.
        const showComa = v.intensity > 0 && v.resolved > 0;
        if (showComa) {
          const coma = (vis.coma ??= buildComa(v));
          coma.mesh.visible = true;
          coma.mesh.position.set(v.rel.x, v.rel.y, v.rel.z);
          coma.mesh.scale.setScalar(1.08 * COMA_EXTENT * v.comaRadius);
          const u = coma.material.uniforms;
          (u.uCenter.value as Vector3).set(v.rel.x, v.rel.y, v.rel.z);
          (u.uSunDir.value as Vector3).set(v.toSun.x / v.rSun, v.toSun.y / v.rSun, v.toSun.z / v.rSun);
          u.uRc.value = v.comaRadius;
          u.uSoft.value = Math.max(COMA_CORE_RADII * R, 0.6 * v.dist * view.pixelAngle);
          const kI = (v.intensity * v.resolved) / (2 * Math.PI * Math.PI * COMA_CUT_INTEGRAL * v.comaRadius);
          (u.uK.value as Vector3).set(kI * color[0], kI * color[1], kI * color[2]);
        } else if (vis.coma) vis.coma.mesh.visible = false;

        // Tails: only when active and at least a pixel or two long.
        const ionLen = ionTailLength(row, rAU, scene.display);
        const dustLen = dustTailLength(row, rAU, scene.display);
        const minLen = 1.5 * view.pixelAngle * v.dist;
        const showIon = v.intensity > 0 && ionLen > minLen;
        const showDust = v.intensity > 0 && dustLen > minLen;
        let stale = !(Math.abs(view.jd - vis.tailJd) <= TAIL_REFRESH_DAYS);
        if (showIon && !vis.ion) {
          vis.ion = buildRibbon(v, 'ion', 1, ION_POINTS);
          stale = true;
        }
        if (showDust && !vis.dust) {
          vis.dust = buildRibbon(v, 'dust', DUST_BETAS.length, DUST_POINTS);
          vis.fan = buildSheet(v);
          stale = true;
        }
        if ((showIon || showDust) && stale) rebuildTails(v, vis, view.jd);
        if (vis.ion) {
          vis.ion.mesh.visible = showIon;
          if (showIon) vis.ion.mesh.position.set(v.rel.x, v.rel.y, v.rel.z);
        }
        if (vis.dust) {
          vis.dust.mesh.visible = showDust;
          if (showDust) vis.dust.mesh.position.set(v.rel.x, v.rel.y, v.rel.z);
        }
        if (vis.fan) {
          vis.fan.mesh.visible = showDust;
          if (showDust) vis.fan.mesh.position.set(v.rel.x, v.rel.y, v.rel.z);
        }
      }
      pPosAttr.needsUpdate = true;
      pFluxAttr.needsUpdate = true;
    },
    memoryBytes() {
      let bytes = pPos.byteLength + pFlux.byteLength + comaBytes;
      for (const v of visuals) bytes += (v.ion?.bytes ?? 0) + (v.dust?.bytes ?? 0) + (v.fan?.bytes ?? 0);
      return bytes;
    },
    dispose() {
      pGeometry.dispose();
      pMaterial.dispose();
      comaGeometry.dispose();
      for (const v of visuals) {
        v.coma?.material.dispose();
        for (const r of [v.ion, v.dust, v.fan]) {
          r?.geometry.dispose();
          r?.material.dispose();
        }
        v.coma = v.ion = v.dust = v.fan = undefined;
      }
    },
  };

  return { nuclei, glow };
}
