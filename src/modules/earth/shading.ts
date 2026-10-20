/**
 * Earth SurfaceShading override (priority 10). Works with any geometry provider that fills
 * SurfaceInput (sphere now, terrain later): everything it needs beyond SurfaceInput comes from its
 * own uniforms (prefixed uEarth*) and the atmosphere's shared transmittance uniforms (uAtmo*).
 */
import { Matrix3, type IUniform, type Texture } from 'three';
import type { Body, Quatd, SurfaceShading, ViewState } from '../../core/contracts';
import { quat, v3len, vec3 } from '../../core/math64';
import { NOISE_GLSL } from '../../render/chunks/index';
import { ATMOSPHERE_TRANSMITTANCE_GLSL, type ShadingAtmosphereUniforms } from '../atmosphere/public';
import { CITY_LUMINANCE } from '../solar-system/public';
import { cityLightFraction, yearOfJd } from './city-lights';
import earthCommonGlsl from './glsl/earth-common.glsl?raw';
import shadingGlsl from './glsl/shading-earth.glsl?raw';
import type { EarthTextures } from './textures';

/** Cloud-shell altitude above the equatorial radius, m. */
export const CLOUD_ALTITUDE_M = 6000;
/** Apparent diameter (px) above which Earth is drawn as a sphere (matches the sphere provider). */
export const POINT_MAX_PX = 1.5;

/** Shared GLSL prelude of the shading and the cloud shell. */
export const EARTH_PRELUDE = `${NOISE_GLSL}\n${ATMOSPHERE_TRANSMITTANCE_GLSL}\n${earthCommonGlsl}\n`;

/** Uniforms shared (by reference) by the shading and the cloud shell. */
export function createEarthUniforms(body: Body): Record<string, IUniform> {
  return {
    uEarthWorldToBody: { value: new Matrix3() },
    uEarthRadiusKm: { value: body.radius / 1000 },
    uEarthCloudAltKm: { value: CLOUD_ALTITUDE_M / 1000 },
    uEarthCloudZonal: { value: 0 },
  };
}

/** Sets `m` to the world -> body-fixed rotation for a body-fixed -> world quaternion. */
export function setWorldToBody(m: Matrix3, q: Quatd): Matrix3 {
  const { x, y, z, w } = q;
  // rows of R^T = columns of R
  return m.set(
    1 - 2 * (y * y + z * z),
    2 * (x * y + z * w),
    2 * (x * z - y * w),
    2 * (x * y - z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z + x * w),
    2 * (x * z + y * w),
    2 * (y * z - x * w),
    1 - 2 * (x * x + y * y),
  );
}

/** Apparent diameter of a body in pixels. */
export function apparentPx(radius: number, dist: number, pixelAngle: number): number {
  return (2 * Math.asin(Math.min(1, radius / Math.max(dist, 1e-9)))) / pixelAngle;
}

export interface EarthShadingDeps {
  body: Body;
  textures: EarthTextures;
  shared: Record<string, IUniform>;
  atmosphere: ShadingAtmosphereUniforms;
  waves: Texture;
}

export function createEarthShading(deps: EarthShadingDeps): SurfaceShading {
  const { body, textures, shared } = deps;
  const uniforms: Record<string, IUniform> = {
    ...textures.uniforms,
    ...shared,
    ...deps.atmosphere,
    uEarthWaves: { value: deps.waves },
    uEarthCityLuminance: { value: CITY_LUMINANCE },
    uEarthTime: { value: 0 },
  };
  const rel = vec3();
  const q = quat();
  return {
    bodyId: body.id,
    priority: 10,
    glsl: `${EARTH_PRELUDE}\n${shadingGlsl}`,
    uniforms,
    update(view: ViewState) {
      const d = v3len(view.toCamera(body.frame, vec3(), rel));
      const px = apparentPx(body.radius, d, view.pixelAngle);
      if (px > POINT_MAX_PX) textures.ensure(px);
      view.frameQuat(body.fixedFrame ?? body.frame, q);
      setWorldToBody(shared.uEarthWorldToBody.value as Matrix3, q);
      uniforms.uEarthTime.value = view.timeReal;
      uniforms.uEarthCityLuminance.value = CITY_LUMINANCE * cityLightFraction(yearOfJd(view.jd));
    },
  };
}
