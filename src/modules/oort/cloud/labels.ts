/**
 * Region labels of the cloud (three-free): fixed anchors in frame 'sun' placed for the views along the
 * Galactic pole (bookmarks.ts), shown while the cloud is visible and the region's apparent size R / d is
 * sensible. A click selects the region (the Oort Cloud info card); a double click flies to its bookmark.
 */
import type { LabelItem, LabelSource, Vec3d, ViewState } from '../../../core/contracts';
import { v3cross, v3normalize, v3scale, vec3 } from '../../../core/math64';
import { AU } from '../../../core/units';
import { GALACTIC_POLE_ECL, eclToIcrf, type OortShared } from '../shared';
import { CLOUD_BOOKMARK_ID, SPIRAL_BOOKMARK_ID } from './bookmarks';

export interface RegionLabel {
  id: string;
  text: string;
  /** Anchor, frame 'sun' (ICRF axes), m. */
  local: Vec3d;
  /** Region radius, AU (for the apparent-size test). */
  radiusAu: number;
  /** Shown for radiusAu / d in [min, max] (d = camera distance from the Sun). */
  range: readonly [number, number];
  target: string;
}

const anchor = (dirEcl: Vec3d, au: number): Vec3d =>
  eclToIcrf(vec3(), v3scale(vec3(), v3normalize(dirEcl, dirEcl), au * AU));

export function regionLabels(): RegionLabel[] {
  const g = GALACTIC_POLE_ECL;
  // Screen axes of the views from the north Galactic pole with ecliptic north up.
  const right = v3normalize(vec3(), v3cross(vec3(), vec3(-g.x, -g.y, -g.z), vec3(0, 0, 1)));
  const up = v3cross(vec3(), right, vec3(-g.x, -g.y, -g.z));
  const upLeft = vec3(up.x - right.x, up.y - right.y, up.z - right.z);
  return [
    {
      id: 'oort-cloud.inner',
      text: 'Inner Oort Cloud (Hills cloud)',
      local: anchor(vec3(right.x, right.y, right.z), 8000),
      radiusAu: 20_000,
      range: [0.05, 3],
      target: SPIRAL_BOOKMARK_ID,
    },
    {
      id: 'oort-cloud.outer',
      text: 'Outer Oort Cloud',
      local: anchor(vec3(upLeft.x, upLeft.y, upLeft.z), 60_000),
      radiusAu: 100_000,
      range: [0.05, 3],
      target: CLOUD_BOOKMARK_ID,
    },
    {
      id: 'oort-cloud.spiral',
      text: 'Oort spiral',
      local: anchor(vec3(upLeft.x, upLeft.y, upLeft.z), 5000),
      radiusAu: 10_000,
      range: [0.15, 3],
      target: SPIRAL_BOOKMARK_ID,
    },
  ];
}

export const LABEL_IDS: readonly string[] = regionLabels().map((l) => l.id);

export function createRegionLabels(shared: OortShared): LabelSource {
  const labels = regionLabels();
  return {
    id: 'oort.cloud.regions',
    labels(_view: ViewState, out: LabelItem[]) {
      if (!(shared.cloudFade > 0) || !(shared.brightness > 0)) return;
      for (const l of labels) {
        const s = l.radiusAu / Math.max(shared.sunDistAu, 1);
        if (s < l.range[0] || s > l.range[1]) continue;
        out.push({
          id: l.id,
          text: l.text,
          frame: 'sun',
          local: l.local,
          priority: 30,
          color: '#a9c1e8',
          target: l.target,
        });
      }
    },
  };
}
