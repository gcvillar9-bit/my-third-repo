/**
 * Cloud part of the oort module (docs/modules/oort.md): the simulated comet cloud as a GPU-propagated point
 * cloud, its info card, search entry, region labels, bookmarks and validity range.
 */
import type { ModuleContext } from '../../../core/contracts';
import { JD_J2000 } from '../../../core/units';
import type { OortShared } from '../shared';
import { CLOUD_BOOKMARK_ID, buildCloudBookmarks } from './bookmarks';
import { countFor, createCloudRenderable } from './cloud';
import { buildDensity, type DensityProfile } from './density';
import { CLOUD_INFO_ID, cloudInfoCard, cloudSearchEntry } from './facts';
import { LABEL_IDS, createRegionLabels } from './labels';
import model from './model.json';

/** The statistical model is trusted for this long either side of J2000, years. */
export const VALIDITY_YEARS = 100e6;

export async function initCloud(ctx: ModuleContext, shared: OortShared): Promise<() => void> {
  const { registry, quality } = ctx;
  const offs: (() => void)[] = [];
  const renderable = createCloudRenderable({
    exposure: ctx.render.uniforms.uExposure,
    count: countFor(quality.preset),
    seed: ctx.env.seed,
    shared,
  });
  registry.addRenderable(renderable);
  offs.push(quality.subscribe((k) => renderable.setCount(countFor(k.preset))));

  const bookmarks = buildCloudBookmarks();
  registry.addBookmarks(bookmarks);
  const main = bookmarks.find((b) => b.id === CLOUD_BOOKMARK_ID)!;
  registry.addSearch({ id: 'oort.cloud', entries: () => [cloudSearchEntry(main)] });

  // The density profile needs a generated sample: built on the first info request, not at boot.
  let density: DensityProfile | null = null;
  const ids = new Set([CLOUD_INFO_ID, ...LABEL_IDS]);
  registry.addInfo({
    id: 'oort.cloud',
    info(id) {
      if (!ids.has(id)) return null;
      density ??= buildDensity(40_000, ctx.env.seed);
      return cloudInfoCard(shared.sunDistAu, density);
    },
  });
  offs.push(ctx.ui.addLabelSource(createRegionLabels(shared)));

  registry.addValidity({
    id: 'oort.cloud',
    appliesTo: 'oort cloud',
    model: 'statistical two-body orbits with a secular Galactic tide',
    jdMin: JD_J2000 - VALIDITY_YEARS * 365.25,
    jdMax: JD_J2000 + VALIDITY_YEARS * 365.25,
    beyond: 'approximate',
    source:
      `${model.tide.source} Passing stars and the slow change of each orbit's eccentricity under the tide ` +
      'are left out, so far from the present the cloud is only a statistical picture.',
  });

  return () => {
    for (const off of offs) off();
    offs.length = 0;
  };
}
