import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import type { Renderable } from '../../../src/core/contracts';
import { ShaderWarmUp, WARM_UP_MAX_FRAMES } from '../../../src/render/warm-up';

const renderable = (id: string): Renderable => ({
  id,
  layer: 'opaque',
  object: new Object3D(),
  update() {},
  memoryBytes: () => 0,
  dispose() {},
});

describe('shader warm-up', () => {
  it('hides a renderable only for the draws until its programs report linked', () => {
    let linked = false;
    const polls: string[] = [];
    const w = new ShaderWarmUp((r) => {
      polls.push(r.id);
      return linked;
    });
    const r = renderable('terrain.earth');
    w.add(r, 10);
    expect(w.isReady('terrain.earth')).toBe(false);
    expect(w.isReady('other')).toBe(true);
    const hidden = w.hide(11);
    expect(hidden).toEqual([r]);
    expect(r.object.visible).toBe(false);
    w.show(hidden);
    expect(r.object.visible).toBe(true);
    linked = true;
    expect(w.hide(12)).toEqual([]);
    expect(w.isReady('terrain.earth')).toBe(true);
    expect(polls).toEqual(['terrain.earth', 'terrain.earth']);
    expect(w.size).toBe(0);
  });

  it('draws a renderable regardless after WARM_UP_MAX_FRAMES and when the probe throws', () => {
    const w = new ShaderWarmUp(() => false);
    const r = renderable('a');
    w.add(r, 0);
    expect(w.hide(WARM_UP_MAX_FRAMES - 1)).toEqual([r]);
    w.show([r]);
    expect(w.hide(WARM_UP_MAX_FRAMES)).toEqual([]);
    expect(w.isReady('a')).toBe(true);
    const throwing = new ShaderWarmUp(() => {
      throw new Error('no geometry');
    });
    const t = renderable('t');
    throwing.add(t, 0);
    expect(throwing.hide(1)).toEqual([]);
    expect(throwing.isReady('t')).toBe(true);
  });

  it('polls an object without materials yet without hiding it, then hides it while it links', () => {
    let state: boolean | null = null;
    const w = new ShaderWarmUp(() => state);
    const r = renderable('terrain.moon');
    w.add(r, 0);
    expect(w.hide(1)).toEqual([]);
    expect(r.object.visible).toBe(true);
    expect(w.isReady('terrain.moon')).toBe(false);
    state = false; // the first update filled the mesh pool: programs created, linking
    expect(w.hide(2)).toEqual([r]);
    w.show([r]);
    state = true;
    expect(w.hide(3)).toEqual([]);
    expect(w.isReady('terrain.moon')).toBe(true);
    const forever = new ShaderWarmUp(() => null, 2);
    forever.add(r, 0);
    forever.hide(1);
    expect(forever.isReady('terrain.moon')).toBe(false);
    forever.hide(2);
    expect(forever.isReady('terrain.moon')).toBe(true);
  });

  it('keeps an object a module hid hidden and forgets removed renderables', () => {
    const w = new ShaderWarmUp(() => false);
    const r = renderable('b');
    r.object.visible = false;
    w.add(r, 0);
    expect(w.hide(1)).toEqual([]);
    expect(r.object.visible).toBe(false);
    w.remove('b');
    expect(w.isReady('b')).toBe(true);
    expect(w.hide(2)).toEqual([]);
  });
});
