/**
 * smallbodies (P3-B): the asteroid belt (Kirkwood gaps), Hildas, Jupiter Trojans, the Kuiper belt
 * and plutinos as one GPU-propagated point cloud (20k potato, 150k medium, 400k ultra), generated
 * deterministically at runtime from the seed. See docs/modules/smallbodies.md.
 */
import type { ModuleContext, QualityPreset, UniverseModule } from '../../core/contracts';
import { vec3 } from '../../core/math64';
import { OBLIQUITY_J2000 } from '../solar-system/public';
import { createBelt } from './belt';
import { BELT_BOOKMARK_ID, buildBeltBookmark } from './bookmarks';
import { planetMeanLongitude } from './generate';
import { wrapPi } from './kepler4';
import data from './populations.json';

export const SMALLBODIES_MODULE_ID = 'smallbodies';
const countFor = (p: QualityPreset): number => data.counts[p] ?? data.counts.medium;
let release: (() => void) | null = null;

const smallbodies: UniverseModule = {
  id: SMALLBODIES_MODULE_ID,
  dependsOn: ['solar-system'],
  init(ctx: ModuleContext) {
    const { frames, registry, quality } = ctx;
    const tmp = vec3();
    const c = Math.cos(OBLIQUITY_J2000);
    const s = Math.sin(OBLIQUITY_J2000);
    const belt = createBelt({
      exposure: ctx.render.uniforms.uExposure,
      count: countFor(quality.preset),
      seed: ctx.env.seed,
      trojanShift(jd) {
        if (!frames.has('jupiter') || !frames.has('sun')) return 0;
        frames.relative('sun', 'jupiter', jd, tmp);
        const lon = Math.atan2(c * tmp.y + s * tmp.z, tmp.x);
        return wrapPi(lon - planetMeanLongitude('jupiter', jd));
      },
    });
    registry.addRenderable(belt);
    release = quality.subscribe((k) => belt.setCount(countFor(k.preset)));
    registry.addSetting({
      id: 'smallbodies.boost',
      label: 'Asteroid visibility boost (mag)',
      group: 'Sky',
      type: 'number',
      default: data.display.boostMag,
      min: 0,
      max: 20,
      step: 0.5,
      description: 'Brightens belt points by this many magnitudes (0 = physical, invisible to the eye).',
      onChange: (v) => belt.setBoost(Number(v)),
    });
    const bookmark = buildBeltBookmark();
    registry.addBookmarks([bookmark]);
    registry.addSearch({
      id: 'smallbodies',
      entries: () => [
        {
          id: BELT_BOOKMARK_ID,
          name: 'Asteroid belt',
          aliases: ['Main belt', 'Kirkwood gaps', 'Trojans', 'Hildas', 'Kuiper belt', 'Plutinos'],
          subtitle: 'Simulated belt population',
          kind: 'bookmark',
          target: bookmark,
        },
      ],
    });
  },
  dispose() {
    release?.();
    release = null;
  },
};

export default smallbodies;
