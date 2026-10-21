import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { SurfaceManager } from '../../../src/app/loop';
import type { Body, Renderable, SurfaceGeometryProvider, ViewState } from '../../../src/core/contracts';
import { FrameTreeImpl } from '../../../src/core/frames';
import { RegistryImpl } from '../../../src/core/registry';

const moon: Body = {
  id: 'moon',
  name: 'Moon',
  kind: 'moon',
  frame: 'universe',
  radius: 1,
  influenceRadius: 1,
};

function provider(id: string, priority: number, wants: () => boolean): SurfaceGeometryProvider {
  return {
    id,
    bodyId: '*',
    priority,
    wants,
    build: (body): Renderable => ({
      id: `${id}.${body.id}`,
      layer: 'opaque',
      object: new Object3D(),
      update() {},
      memoryBytes: () => 0,
      dispose() {},
    }),
  };
}

function setup(ready: (id: string) => boolean) {
  const frames = new FrameTreeImpl();
  const registry = new RegistryImpl(frames);
  registry.addBody(moon);
  registry.setSurfaceShading({ bodyId: 'moon', priority: 0, glsl: '', uniforms: {} });
  let near = false;
  registry.setSurfaceGeometry(provider('sphere', 0, () => true));
  registry.setSurfaceGeometry(provider('terrain', 10, () => near));
  const manager = new SurfaceManager(registry, ready);
  const view = {} as ViewState;
  const visible = () =>
    registry
      .renderables()
      .filter((r) => r.object.visible)
      .map((r) => r.id)
      .sort();
  return { manager, registry, view, visible, setNear: (v: boolean) => (near = v) };
}

describe('SurfaceManager', () => {
  it('activates the highest-priority provider that wants the body and hides the rest', () => {
    const s = setup(() => true);
    s.manager.update(s.view);
    expect(s.visible()).toEqual(['sphere.moon']);
    s.setNear(true);
    s.manager.update(s.view);
    expect(s.visible()).toEqual(['terrain.moon']);
    expect([...s.manager.inactive]).toEqual(['sphere.moon']);
    s.setNear(false);
    s.manager.update(s.view);
    expect(s.visible()).toEqual(['sphere.moon']);
    expect([...s.manager.inactive]).toEqual(['terrain.moon']);
  });

  it('keeps drawing the previous provider while the new one warms up, updating both', () => {
    const warming = new Set(['terrain.moon']);
    const s = setup((id) => !warming.has(id));
    s.manager.update(s.view);
    s.setNear(true);
    s.manager.update(s.view);
    // Terrain is active but its shaders are still linking: the sphere stays on screen.
    expect(s.visible()).toEqual(['sphere.moon']);
    expect(s.manager.inactive.size).toBe(0);
    s.manager.update(s.view);
    expect(s.visible()).toEqual(['sphere.moon']);
    warming.clear();
    s.manager.update(s.view);
    expect(s.visible()).toEqual(['terrain.moon']);
    expect([...s.manager.inactive]).toEqual(['sphere.moon']);
  });

  it('shows a warming provider at once when nothing was drawn before', () => {
    const s = setup(() => false);
    s.setNear(true);
    s.manager.update(s.view);
    expect(s.visible()).toEqual(['terrain.moon']);
  });
});
