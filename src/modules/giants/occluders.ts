/**
 * Moon shadow transits on the giants: an OccluderProvider naming the moons whose umbra and
 * penumbra fall on Jupiter (Galilean moons) and Saturn (Titan). The sphere provider turns them into
 * analytic sphere occluders for shadows.glsl, keeping the 4 most relevant that are sunward.
 */
import type { OccluderProvider, RegistryReader } from '../../core/contracts';

/** Transit casters per giant (moons large enough to cast a visible umbra). */
export const TRANSIT_CASTERS: Readonly<Record<string, readonly string[]>> = {
  jupiter: ['io', 'europa', 'ganymede', 'callisto'],
  saturn: ['titan'],
};

export function createTransitOccluders(registry: RegistryReader): OccluderProvider {
  const receivers = Object.keys(TRANSIT_CASTERS);
  const list: { bodyId: string; radius: number }[] = [];
  for (const id of receivers.flatMap((r) => TRANSIT_CASTERS[r])) {
    const b = registry.body(id);
    if (b) list.push({ bodyId: id, radius: b.radius });
  }
  return {
    receivers,
    occluders: () => list,
  };
}
