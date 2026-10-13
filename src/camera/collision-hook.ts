/**
 * Ground providers and collision (DESIGN 3.2 Speed, P2 walk mode). Providers answer the height
 * under a body-fixed direction; the highest priority non-null answer wins. Without providers the
 * reference sphere (height 0) is the ground.
 */
import type { GroundProvider, Vec3d } from '../core/contracts';
import { v3len, v3scale } from '../core/math64';

/** Minimum altitude kept above the ground in free/orbit flight, m. */
export const MIN_ALTITUDE = 1;
/** Eye height in walk mode, m. */
export const EYE_HEIGHT = 1.7;

export class GroundProviders {
  private list: GroundProvider[] = [];

  add(p: GroundProvider): () => void {
    this.list = [...this.list, p].sort((a, b) => b.priority - a.priority);
    return () => {
      this.list = this.list.filter((x) => x !== p);
    };
  }

  /** Height above the reference radius under unit body-fixed `dirBody`, m (0 when unknown). */
  heightAt(bodyId: string, dirBody: Vec3d): number {
    for (const p of this.list) {
      if (p.bodyId !== '*' && p.bodyId !== bodyId) continue;
      const h = p.heightAt(bodyId, dirBody);
      if (h !== null && Number.isFinite(h)) return h;
    }
    return 0;
  }

  get size(): number {
    return this.list.length;
  }
}

/**
 * Keeps `rel` (camera minus body centre, any axes) at least `minAlt` above radius + ground.
 * Returns true when it pushed the camera out.
 */
export function clampAboveGround(rel: Vec3d, radius: number, ground: number, minAlt: number): boolean {
  const d = v3len(rel);
  const floor = radius + ground + minAlt;
  if (d >= floor || d === 0) return false;
  v3scale(rel, rel, floor / d);
  return true;
}
