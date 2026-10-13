import { describe, expectTypeOf, it } from 'vitest';
import type {
  Bookmark,
  FrameDef,
  MethodKeys,
  QualityPreset,
  Quatd,
  SearchEntry,
  TourStep,
  UniverseModule,
  Vec3d,
  WorkerHandle,
} from '../../../src/core/contracts';

/** Compile-time checks that the contract is implementable as documented. */
describe('contract types', () => {
  it('types worker calls by method name', () => {
    interface Api {
      add(a: number, b: number): number;
      decode(buf: ArrayBuffer): Promise<Float32Array>;
      label: string;
    }
    const handle = {} as WorkerHandle<Api>;
    expectTypeOf<MethodKeys<Api>>().toEqualTypeOf<'add' | 'decode'>();
    expectTypeOf<ReturnType<typeof handle.call<'add'>>>().toEqualTypeOf<Promise<number>>();
    expectTypeOf<ReturnType<typeof handle.call<'decode'>>>().toEqualTypeOf<Promise<Float32Array>>();
  });

  it('accepts a minimal module, frame, bookmark and tour', () => {
    const frame: FrameDef = {
      id: 'earth',
      parent: 'ssb',
      influenceRadius: 1e9,
      positionAt: (_jd: number, out: Vec3d) => out,
      orientationAt: (_jd: number, out: Quatd) => out,
    };
    const bookmark: Bookmark = {
      id: 'earth-now',
      title: 'Earth',
      frame: 'earth',
      pos: { x: 2e7, y: 0, z: 0 },
      jd: 'now',
    };
    const mod: UniverseModule = {
      id: '_debug',
      init(ctx) {
        ctx.registry.addFrame(frame);
        ctx.registry.addBookmarks([bookmark]);
      },
    };
    const steps: TourStep[] = [
      { type: 'goto', target: bookmark },
      { type: 'wait', seconds: 2 },
    ];
    const entry: SearchEntry = { id: 'earth', name: 'Earth', kind: 'planet', target: 'earth' };
    expectTypeOf(mod.id).toBeString();
    expectTypeOf(steps).toExtend<readonly TourStep[]>();
    expectTypeOf(entry.target).toEqualTypeOf<string | Bookmark>();
    expectTypeOf<'potato'>().toExtend<QualityPreset>();
  });
});
