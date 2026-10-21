/**
 * paleo: Earth through deep time (docs/modules/paleo.md). Wraps the earth module's surface shading
 * (priority 20) so that, going back in time, sea level and ice sheets follow the ice ages over today's
 * imagery and, beyond a few million years, a synthetic surface baked from the PALEOMAP maps replaces
 * it: drifting continents, seas, deserts, forests and bare rock before land plants. Data loads lazily
 * the first time the clock is in the past.
 */
import type { ModuleContext, UniverseModule, ValidityRange } from '../../core/contracts';
import { jdFromYearsBP } from '../../core/geotime';
import { JD_J2000 } from '../../core/units';
import { buildPaleoBookmarks } from './bookmarks';
import { PALEO_MODULE_ID, PaleoController, createPaleoShading } from './shading';

/** Before the oldest map the surface stays at 540 Ma. */
export const PALEO_VALIDITY: ValidityRange = {
  id: 'paleo.geography',
  appliesTo: 'continents',
  model: 'imagery today, PALEOMAP maps in deep time (approximate)',
  jdMin: jdFromYearsBP(540e6),
  jdMax: JD_J2000 + 1e9 * 365.25,
  beyond: 'frozen',
  source:
    'Scotese & Wright 2018 PALEOMAP PaleoDEMs (0-540 Ma); sea level Bintanja & van de Wal 2008; temperature ' +
    'Judd et al. 2024; biomes are a model, not a reconstruction',
};

let controller: PaleoController | null = null;

const paleo: UniverseModule = {
  id: PALEO_MODULE_ID,
  dependsOn: ['earth', 'solar-system', 'atmosphere'],
  init(ctx: ModuleContext) {
    const { registry } = ctx;
    const base = registry.surfaceShading('earth');
    const earth = registry.body('earth');
    if (!base || base.priority !== 10 || !earth) {
      console.warn('[paleo] earth shading (priority 10) not found; deep-time surface disabled');
      return;
    }
    controller = new PaleoController(ctx, base.uniforms);
    registry.setSurfaceShading(createPaleoShading(base, controller));
    registry.addValidity(PALEO_VALIDITY);
    registry.addBookmarks(buildPaleoBookmarks(ctx.frames, earth.radius, earth.fixedFrame ?? 'earth.fixed'));
  },
  dispose() {
    controller?.dispose();
    controller = null;
  },
};

export default paleo;
