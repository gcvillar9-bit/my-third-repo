/**
 * Renderables of the oort bodies part (loaded lazily):
 * - points: one Points draw for the unresolved objects (physical photometry, no boost) and the passing
 *   stars (physical, with an artificial visibility floor);
 * - sphere: one lit, depth-writing sphere moved to the nearest resolved object (only one can be resolved
 *   at a time: they are hundreds of AU apart), created on first need;
 * - markers: one LineSegments for the scale shells (three great circles each) and the flyby tracks with a
 *   tick at closest approach. Shells and tracks are multiplied by shared.lineFade.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  LineSegments,
  Mesh,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type IUniform,
} from 'three';
import { SSB_FRAME, type Renderable, type Vec3d, type ViewState } from '../../../core/contracts';
import { v3len, vec3 } from '../../../core/math64';
import {
  SUN_RGB,
  apparentMag,
  blackbodyRgb,
  illuminanceFromMag,
  solarIlluminance,
} from '../../../core/photometry';
import { AU } from '../../../core/units';
import { DEPTH_GLSL, FACET_GLSL, NOISE_GLSL } from '../../../render/chunks/index';
import { smoothstep, type OortShared } from '../shared';
import type { FlybyStarRow, ShellRow } from './data';
import { starPositionAt, type StarMotion } from './flybys';
import bodyGlsl from './glsl/body.glsl?raw';
import lineGlsl from './glsl/line.glsl?raw';
import pointGlsl from './glsl/point.glsl?raw';
import { circleFade, circleNormals, shellAlpha } from './markers';
import { pointIlluminance, type ObjectScene } from './objects';

const split = (src: string): [string, string] => {
  const [vs, fs] = src.split(/^\/\/#fragment$/m);
  return [vs, fs];
};

/** Below this apparent diameter (px) an object is a point only, above SPHERE_FULL_PX a sphere only. */
export const SPHERE_POINT_PX = 1;
export const SPHERE_FULL_PX = 3;
/** Passing stars are drawn while within this distance of the Sun, AU. */
export const STAR_DRAW_AU = 300_000;
/**
 * Artificial visibility floor of a passing star: its PSF peak is kept at least at this display value
 * (L · exposure), so Scholz's Star (magnitude 11-12 at its closest) still shows as a faint dot.
 */
export const STAR_FLOOR_PEAK = 0.12;
const PSF_SIGMA = 0.75;
const POINT_SIZE = 5;

/** Smallest illuminance (lux) that the floor allows at this pixel angle and exposure. */
export const starFloorIlluminance = (pixelAngle: number, exposure: number): number =>
  (STAR_FLOOR_PEAK * pixelAngle * pixelAngle * 2 * Math.PI * PSF_SIGMA * PSF_SIGMA) /
  Math.max(exposure, 1e-30);

export interface FlybyDraw {
  row: FlybyStarRow;
  motion: StarMotion;
}

export interface BodiesRenderDeps {
  scene: ObjectScene;
  shared: OortShared;
  shells: readonly ShellRow[];
  flybys: readonly FlybyDraw[];
  trackHalfLengthAu: number;
  exposure: IUniform<number>;
}

export interface BodiesRenderables {
  points: Renderable;
  sphere: Renderable;
  markers: Renderable;
}

export function createBodiesRenderables(deps: BodiesRenderDeps): BodiesRenderables {
  const { scene, shared, flybys, exposure } = deps;
  const views = scene.views;
  const pixelAngle = { value: 1e-3 };
  const zero = vec3();
  const ssbRel = vec3();

  // ---- points ------------------------------------------------------------------------------------
  const nObj = views.length;
  const nPts = nObj + flybys.length;
  const pPos = new Float32Array(3 * nPts);
  const pFlux = new Float32Array(3 * nPts);
  const pGeometry = new BufferGeometry();
  const pPosAttr = new BufferAttribute(pPos, 3).setUsage(DynamicDrawUsage);
  const pFluxAttr = new BufferAttribute(pFlux, 3).setUsage(DynamicDrawUsage);
  pGeometry.setAttribute('position', pPosAttr);
  pGeometry.setAttribute('aFlux', pFluxAttr);
  const [pointVs, pointFs] = split(pointGlsl);
  const pMaterial = new ShaderMaterial({
    vertexShader: `${DEPTH_GLSL}\n${pointVs}`,
    fragmentShader: `${DEPTH_GLSL}\n${pointFs}`,
    uniforms: {
      uPointSize: { value: POINT_SIZE },
      uSigma: { value: PSF_SIGMA },
      uPixelAngle: pixelAngle,
      uExposure: exposure,
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const pointsObj = new Points(pGeometry, pMaterial);
  pointsObj.frustumCulled = false;
  pointsObj.name = 'oort.bodies.points';
  const starRgb = flybys.map((f) => blackbodyRgb(f.row.teffK));
  const starPos = vec3();

  const points: Renderable = {
    id: 'oort.bodies.points',
    layer: 'transparent',
    object: pointsObj,
    update(view: ViewState) {
      pixelAngle.value = view.pixelAngle;
      for (let i = 0; i < nObj; i++) {
        const v = views[i];
        const R = v.obj.body.radius;
        let e = 0;
        if (v.dist > R)
          e =
            pointIlluminance(v.obj, v.rSun, v.dist, v.phase) *
            (1 - smoothstep(SPHERE_POINT_PX, SPHERE_FULL_PX, v.px));
        const k = v.dist > 0 ? Math.max(0, 1 - R / v.dist) : 0;
        pPos[3 * i] = v.rel.x * k;
        pPos[3 * i + 1] = v.rel.y * k;
        pPos[3 * i + 2] = v.rel.z * k;
        const tint = v.obj.row.physical.tint;
        for (let c = 0; c < 3; c++) pFlux[3 * i + c] = e * SUN_RGB[c] * tint[c];
      }
      const fade = shared.orbitLines ? shared.lineFade : 0;
      view.toCamera(SSB_FRAME, zero, ssbRel);
      const floor = starFloorIlluminance(view.pixelAngle, view.exposure);
      for (let j = 0; j < flybys.length; j++) {
        const o = nObj + j;
        starPositionAt(flybys[j].motion, view.jd, starPos);
        const rSun = v3len(starPos);
        const x = starPos.x + ssbRel.x;
        const y = starPos.y + ssbRel.y;
        const z = starPos.z + ssbRel.z;
        const d = Math.hypot(x, y, z);
        let e = 0;
        if (fade > 0 && rSun < STAR_DRAW_AU * AU && d > 0) {
          e = Math.max(illuminanceFromMag(apparentMag(flybys[j].row.absMagV, d)), floor) * fade;
        }
        pPos[3 * o] = x;
        pPos[3 * o + 1] = y;
        pPos[3 * o + 2] = z;
        for (let c = 0; c < 3; c++) pFlux[3 * o + c] = e * starRgb[j][c];
      }
      pPosAttr.needsUpdate = true;
      pFluxAttr.needsUpdate = true;
    },
    memoryBytes() {
      return pPos.byteLength + pFlux.byteLength;
    },
    dispose() {
      pGeometry.dispose();
      pMaterial.dispose();
    },
  };

  // ---- the resolved sphere -----------------------------------------------------------------------
  const [bodyVs, bodyFs] = split(bodyGlsl);
  let sphereMesh: Mesh | null = null;
  let sphereMaterial: ShaderMaterial | null = null;
  let sphereGeometry: SphereGeometry | null = null;
  const sphereGroup = new Group();
  sphereGroup.name = 'oort.bodies.sphere';
  sphereGroup.visible = false;
  const buildSphere = (): Mesh => {
    sphereGeometry = new SphereGeometry(1, 96, 48);
    sphereMaterial = new ShaderMaterial({
      vertexShader: `${DEPTH_GLSL}\n${bodyVs}`,
      fragmentShader: `${DEPTH_GLSL}\n${FACET_GLSL}\n${NOISE_GLSL}\n${bodyFs}`,
      uniforms: {
        uSunDir: { value: new Vector3(1, 0, 0) },
        uSunIlluminance: { value: new Vector3() },
        uTint: { value: new Vector3(1, 1, 1) },
        uReflectance: { value: 0.3 },
        uRadius: { value: 1 },
        uExposure: exposure,
        uFade: { value: 1 },
        uSeed: { value: 0 },
      },
    });
    const mesh = new Mesh(sphereGeometry, sphereMaterial);
    mesh.frustumCulled = false;
    mesh.name = 'oort.bodies.sphere.mesh';
    sphereGroup.add(mesh);
    return mesh;
  };

  const sphere: Renderable = {
    id: 'oort.bodies.sphere',
    layer: 'opaque',
    object: sphereGroup,
    update() {
      let best = -1;
      for (let i = 0; i < nObj; i++) {
        const v = views[i];
        if (v.px > SPHERE_POINT_PX && (best < 0 || v.dist < views[best].dist)) best = i;
      }
      if (best < 0) {
        sphereGroup.visible = false;
        return;
      }
      const v = views[best];
      const { row, body } = v.obj;
      const mesh = (sphereMesh ??= buildSphere());
      sphereGroup.visible = true;
      mesh.position.set(v.rel.x, v.rel.y, v.rel.z);
      mesh.scale.setScalar(body.radius);
      const u = sphereMaterial!.uniforms;
      (u.uSunDir.value as Vector3).set(v.toSun.x / v.rSun, v.toSun.y / v.rSun, v.toSun.z / v.rSun);
      const E = solarIlluminance(v.rSun);
      (u.uSunIlluminance.value as Vector3).set(E * SUN_RGB[0], E * SUN_RGB[1], E * SUN_RGB[2]);
      (u.uTint.value as Vector3).set(...row.physical.tint);
      u.uReflectance.value = 1.5 * row.physical.albedo;
      u.uRadius.value = body.radius;
      u.uFade.value = smoothstep(SPHERE_POINT_PX, SPHERE_FULL_PX, v.px);
      u.uSeed.value = (best * 37.3) % 100;
    },
    memoryBytes() {
      if (!sphereGeometry) return 0;
      const g: SphereGeometry = sphereGeometry;
      return g.getAttribute('position').count * 32 + (g.index?.count ?? 0) * 4;
    },
    dispose() {
      sphereGeometry?.dispose();
      sphereMaterial?.dispose();
    },
  };

  // ---- markers: shells and flyby tracks ----------------------------------------------------------
  const C = 256; // segments per great circle
  const T = 160; // segments per flyby track
  const shells = deps.shells;
  const normals = circleNormals();
  // Unit circles in each plane: basis (a, b) with a x b = the plane's normal (ICRF).
  const bases: [Vec3d, Vec3d][] = normals.map((n) => {
    const ref = Math.abs(n.z) < 0.9 ? vec3(0, 0, 1) : vec3(1, 0, 0);
    const a = vec3(ref.y * n.z - ref.z * n.y, ref.z * n.x - ref.x * n.z, ref.x * n.y - ref.y * n.x);
    const la = v3len(a);
    a.x /= la;
    a.y /= la;
    a.z /= la;
    const b = vec3(n.y * a.z - n.z * a.y, n.z * a.x - n.x * a.z, n.x * a.y - n.y * a.x);
    return [a, b];
  });
  const unit = new Float64Array(3 * 3 * (C + 1));
  for (let c = 0; c < 3; c++) {
    const [a, b] = bases[c];
    for (let k = 0; k <= C; k++) {
      const t = (2 * Math.PI * k) / C;
      const [ct, st] = [Math.cos(t), Math.sin(t)];
      const o = 3 * (c * (C + 1) + k);
      unit[o] = a.x * ct + b.x * st;
      unit[o + 1] = a.y * ct + b.y * st;
      unit[o + 2] = a.z * ct + b.z * st;
    }
  }
  const nShellSeg = shells.length * 3 * C;
  const nTrackSeg = flybys.length * (T + 1);
  const nSeg = nShellSeg + nTrackSeg;
  const mPos = new Float32Array(nSeg * 2 * 3);
  const mAlpha = new Float32Array(nSeg * 2);
  const mColor = new Float32Array(nSeg * 2 * 3);
  for (let s = 0; s < shells.length; s++)
    for (let j = 0; j < 3 * C * 2; j++) mColor.set(shells[s].color, 3 * (s * 3 * C * 2 + j));
  flybys.forEach((f, i) => {
    const rgb = blackbodyRgb(f.row.teffK);
    const m = Math.max(...rgb);
    const col = rgb.map((x) => 0.45 + 0.55 * (x / m));
    for (let j = 0; j < (T + 1) * 2; j++) mColor.set(col, 3 * (nShellSeg * 2 + i * (T + 1) * 2 + j));
  });
  // Track samples relative to the barycentre, m (float64): T + 1 points, then the tick's two ends.
  const trackPts = flybys.map((f) => {
    const { closestPoint: p, v } = f.motion;
    const sp = Math.hypot(v.x, v.y, v.z);
    const L = deps.trackHalfLengthAu * AU;
    const pts = new Float64Array(3 * (T + 3));
    for (let k = 0; k <= T; k++) {
      const s = -L + (2 * L * k) / T;
      pts[3 * k] = p.x + (v.x / sp) * s;
      pts[3 * k + 1] = p.y + (v.y / sp) * s;
      pts[3 * k + 2] = p.z + (v.z / sp) * s;
    }
    // Tick: radial (Sun → closest point is perpendicular to the track), 6 % of the miss distance each way.
    const f6 = 0.06;
    pts.set([p.x * (1 - f6), p.y * (1 - f6), p.z * (1 - f6)], 3 * (T + 1));
    pts.set([p.x * (1 + f6), p.y * (1 + f6), p.z * (1 + f6)], 3 * (T + 2));
    return pts;
  });
  const mGeometry = new BufferGeometry();
  const mPosAttr = new BufferAttribute(mPos, 3).setUsage(DynamicDrawUsage);
  const mAlphaAttr = new BufferAttribute(mAlpha, 1).setUsage(DynamicDrawUsage);
  mGeometry.setAttribute('position', mPosAttr);
  mGeometry.setAttribute('aAlpha', mAlphaAttr);
  mGeometry.setAttribute('aColor', new BufferAttribute(mColor, 3));
  const [lineVs, lineFs] = split(lineGlsl);
  const mMaterial = new ShaderMaterial({
    vertexShader: `${DEPTH_GLSL}\n${lineVs}`,
    fragmentShader: `${DEPTH_GLSL}\n${lineFs}`,
    transparent: true,
    depthWrite: false,
  });
  const markerLines = new LineSegments(mGeometry, mMaterial);
  markerLines.frustumCulled = false;
  markerLines.visible = false;
  markerLines.name = 'oort.markers';
  const sunRel = vec3();
  const camFromSun = vec3();
  const shellAlphas = new Float32Array(shells.length);
  let cleared = false;

  const markers: Renderable = {
    id: 'oort.markers',
    layer: 'transparent',
    object: markerLines,
    update(view: ViewState) {
      const lf = shared.lineFade;
      if (!(lf > 0)) {
        if (!cleared) {
          mAlpha.fill(0);
          mAlphaAttr.needsUpdate = true;
          cleared = true;
        }
        markerLines.visible = false;
        return;
      }
      cleared = false;
      view.sunToCamera(sunRel);
      camFromSun.x = -sunRel.x;
      camFromSun.y = -sunRel.y;
      camFromSun.z = -sunRel.z;
      let any = false;
      let o = 0;
      for (let s = 0; s < shells.length; s++) {
        const R = shells[s].radiusAu * AU;
        const sa = shellAlpha(shells[s].radiusAu, shared.sunDistAu, lf, shared.markers);
        shellAlphas[s] = sa;
        for (let c = 0; c < 3; c++) {
          const a = 0.5 * sa * (sa > 0.005 ? circleFade(normals[c], camFromSun) : 0);
          if (a > 0.005) any = true;
          for (let k = 0; k < C; k++) {
            for (let e = 0; e < 2; e++) {
              const u = 3 * (c * (C + 1) + k + e);
              if (a > 0.005) {
                mPos[3 * o] = sunRel.x + R * unit[u];
                mPos[3 * o + 1] = sunRel.y + R * unit[u + 1];
                mPos[3 * o + 2] = sunRel.z + R * unit[u + 2];
              }
              mAlpha[o] = a > 0.005 ? a : 0;
              o++;
            }
          }
        }
      }
      const tf = shared.orbitLines ? lf : 0;
      view.toCamera(SSB_FRAME, zero, ssbRel);
      for (let i = 0; i < flybys.length; i++) {
        const pts = trackPts[i];
        const scale = flybys[i].motion.closestDist;
        for (let k = 0; k <= T; k++) {
          // Segment k joins sample k and k + 1; the last "segment" is the tick.
          const [j0, j1] = k < T ? [k, k + 1] : [T + 1, T + 2];
          for (let e = 0; e < 2; e++) {
            const j = e === 0 ? j0 : j1;
            const x = pts[3 * j] + ssbRel.x;
            const y = pts[3 * j + 1] + ssbRel.y;
            const z = pts[3 * j + 2] + ssbRel.z;
            mPos[3 * o] = x;
            mPos[3 * o + 1] = y;
            mPos[3 * o + 2] = z;
            let a = 0;
            if (tf > 0) {
              const along = k < T ? Math.min(j, T - j) / T : 0.5;
              a = (k < T ? 0.45 : 0.8) * tf * smoothstep(0, 0.12, along);
              a *= smoothstep(1e-3 * scale, 1e-2 * scale, Math.hypot(x, y, z));
            }
            mAlpha[o] = a;
            if (a > 0.005) any = true;
            o++;
          }
        }
      }
      markerLines.visible = any;
      mPosAttr.needsUpdate = true;
      mAlphaAttr.needsUpdate = true;
    },
    memoryBytes() {
      return mPos.byteLength + mAlpha.byteLength + mColor.byteLength;
    },
    dispose() {
      mGeometry.dispose();
      mMaterial.dispose();
    },
  };

  return { points, sphere, markers };
}
