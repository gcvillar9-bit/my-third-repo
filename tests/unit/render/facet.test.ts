import { describe, expect, it } from 'vitest';
import { vec3 } from '../../../src/core/math64';
import { curveFactor, FACET_GLSL, sphereFactor } from '../../../src/render/chunks/index';
import { sphereFragmentShader } from '../../../src/modules/solar-system/render/sphere';
import { terrainFragmentShader } from '../../../src/modules/terrain/render';

const len = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);

describe('flat facets onto the curved surface', () => {
  it('unit-sphere form: from outside, the fragment slides back onto the sphere along its ray', () => {
    // A facet point 0.06% of the radius below the sphere, seen from 3 radii up and off to one side.
    const cases = [
      { cam: vec3(0, 0, 4), p: vec3(0.02, 0.01, 0.9994) },
      { cam: vec3(3, 1, 2), p: vec3(0.6, 0.2, 0.7737) },
      { cam: vec3(0, 3.9, 1), p: vec3(0.05, 0.9, 0.433) }, // near the limb
    ];
    for (const { cam, p } of cases) {
      const sag = 1 - len(p);
      expect(sag).toBeGreaterThan(0);
      const d = vec3(p.x - cam.x, p.y - cam.y, p.z - cam.z);
      const k = sphereFactor(p, d);
      expect(k).toBeLessThan(1);
      const q = vec3(cam.x + d.x * k, cam.y + d.y * k, cam.z + d.z * k);
      expect(len(q)).toBeCloseTo(1, 12);
      // Moved toward the camera by about sag / cos(view angle): never more than a few sags.
      expect((1 - k) * len(d)).toBeLessThan(40 * sag);
    }
  });

  it('unit-sphere form: from inside (under a cloud shell), the fragment moves out to the shell', () => {
    const cam = vec3(0, 0, 0.999);
    const p = vec3(0.03, 0.01, 0.9992);
    const d = vec3(p.x - cam.x, p.y - cam.y, p.z - cam.z);
    const k = sphereFactor(p, d);
    expect(k).toBeGreaterThan(1);
    expect(len(vec3(cam.x + d.x * k, cam.y + d.y * k, cam.z + d.z * k))).toBeCloseTo(1, 12);
  });

  it('leaves points on or outside the sphere alone', () => {
    expect(sphereFactor(vec3(0, 0, 1), vec3(0, 0, -3))).toBe(1);
    expect(sphereFactor(vec3(0, 0, 1.01), vec3(0, 0, -3))).toBe(1);
  });

  it('local form agrees with the exact geometry at planetary scale', () => {
    // Mars: a point 1.2 km below the sphere, camera 10,000 km up and 30 degrees off the vertical.
    const rho = 3.3895e6;
    const delta = 1200;
    const u = vec3(0, 0, 1);
    const centre = vec3(-5.0e6, 0, -1.0e7 - rho);
    const P = vec3(centre.x, centre.y, centre.z + rho - delta);
    const k = curveFactor(P, u, rho, delta);
    const q = vec3(P.x * k - centre.x, P.y * k - centre.y, P.z * k - centre.z);
    expect(len(q) / rho).toBeCloseTo(1, 10);
    expect(k).toBeLessThan(1);
    expect(curveFactor(P, u, rho, 0)).toBe(1);
  });

  it('the sphere and terrain fragment shaders include the chunk and write the moved depth', () => {
    const shading = {
      bodyId: 'moon',
      priority: 0,
      glsl: 'vec3 shadeSurface(SurfaceInput s) { return vec3(1.0); }',
      uniforms: {},
    };
    for (const frag of [sphereFragmentShader(shading), terrainFragmentShader(shading)]) {
      expect(frag).toContain('cosmosSphereFactor');
      expect(frag).toContain('LOG_DEPTH_FRAGMENT_AT(');
      expect(frag.indexOf('COSMOS_DEPTH_GLSL')).toBeLessThan(frag.indexOf('COSMOS_FACET_GLSL'));
    }
    expect(FACET_GLSL).toContain('float cosmosCurveFactor(vec3 P, vec3 u, float rho, float delta)');
  });
});
