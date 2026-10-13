/**
 * "You are here" (P4-A): a ring in the overlay layer and a label at the Sun, shown once the camera
 * is far enough out (OUTSIDE_SWITCH) that the Sun is lost in the galaxy.
 */
import { BufferGeometry, Float32BufferAttribute, Points, ShaderMaterial } from 'three';
import { SSB_FRAME, type LabelSource, type Renderable } from '../../core/contracts';
import { v3len, vec3 } from '../../core/math64';
import { OUTSIDE_SWITCH, type GalaxyState } from './galaxy';

export const MARKER_LABEL_ID = 'milkyway.you-are-here';
const SIZE = 22;

export function createYouAreHere(state: GalaxyState): Renderable {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
  // cosmos:no-depth (overlay marker: a fixed-size ring drawn on top of everything)
  const material = new ShaderMaterial({
    vertexShader: /* glsl */ `
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = ${SIZE.toFixed(1)};
      }`,
    fragmentShader: /* glsl */ `
      void main() {
        float r = length(gl_PointCoord - 0.5) * ${SIZE.toFixed(1)};
        float ring = smoothstep(1.2, 0.0, abs(r - 8.0));
        float dot = smoothstep(2.2, 1.2, r);
        float a = max(ring, dot);
        if (a < 0.01) discard;
        gl_FragColor = vec4(vec3(0.45, 0.88, 1.0), a);
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  const tmp = vec3();
  const zero = vec3();
  return {
    id: 'milkyway.marker',
    layer: 'overlay',
    object: points,
    update(view) {
      const t = view.toCamera(SSB_FRAME, zero, tmp);
      const d = v3len(t);
      points.visible = state.enabled && d >= OUTSIDE_SWITCH;
      // Unit distance along the Sun's direction: fixed-size sprite, no precision issues.
      if (points.visible) points.position.set(t.x / d, t.y / d, t.z / d);
    },
    memoryBytes: () => 12,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function createMarkerLabels(state: GalaxyState): LabelSource {
  const tmp = vec3();
  const zero = vec3();
  return {
    id: 'milkyway.labels',
    labels(view, out) {
      if (!state.enabled || v3len(view.toCamera(SSB_FRAME, zero, tmp)) < OUTSIDE_SWITCH) return;
      out.push({
        id: MARKER_LABEL_ID,
        text: 'You are here',
        frame: SSB_FRAME,
        local: zero,
        priority: 1000,
        color: '#73e0ff',
        target: 'sun',
      });
    },
  };
}
