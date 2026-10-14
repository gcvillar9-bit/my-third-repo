/**
 * sun (P3-B): replaces the Sun v1 look. Priority-10 photosphere shading (Neckel limb darkening,
 * animated Worley granulation over a supergranular network), a Baumbach corona shell that shows in
 * totality or at low exposure, and the 'sun-closeup' bookmark. The v1 aureole quad registered by
 * solar-system ('solar-system.sun-glow', 2e-4 of the disk) is removed: it would outshine the corona
 * by 100x in totality. A living Sun on top: simulated sunspots, faculae, prominences and flares that
 * follow the solar cycle and differential rotation, and the 'sun.filter' setting (Off / H-alpha).
 * See docs/modules/sun.md.
 */
import type { ModuleContext, UniverseModule } from '../../core/contracts';
import { quat, qrotate, vec3 } from '../../core/math64';
import { SUN_TEFF } from '../../core/photometry';
import { parseInstant } from '../../core/time';
import { SunActivity, activeGroups, prominences } from './activity';
import {
  HALPHA_BOOKMARK_ID,
  HALPHA_DATE,
  SUNSPOT_DATE,
  buildHalphaBookmark,
  buildSunCloseup,
  buildSunspotBookmark,
} from './bookmarks';
import { createCorona } from './corona';
import { SUN_MODULE_ID, starSurface } from './public';
import type { SunViewSwitches } from './shading';

/** Renderable id of the Sun v1 glow quad (solar-system). */
export const V1_GLOW_ID = 'solar-system.sun-glow';
/** 'off' | 'halpha'. */
export const SUN_FILTER_SETTING = 'sun.filter';
/** Bookmarks that switch the H-alpha filter on when reached. */
const FILTER_BOOKMARKS = [HALPHA_BOOKMARK_ID];

type V3 = [number, number, number];

/** Initial bookmark id from ?b= or #b=. */
function initialBookmark(ctx: ModuleContext): string | null {
  const q = (ctx.env.params as URLSearchParams).get('b');
  if (q) return q;
  const hash = typeof location !== 'undefined' ? /[#&]b=([^&]+)/.exec(location.hash) : null;
  return hash ? decodeURIComponent(hash[1]) : null;
}

const sun: UniverseModule = {
  id: SUN_MODULE_ID,
  dependsOn: ['solar-system'],
  init(ctx: ModuleContext) {
    const { registry, frames, ui } = ctx;
    const body = registry.body('sun');
    if (!body) return;
    const activity = new SunActivity();
    const view: SunViewSwitches = { halpha: false };
    registry.setSurfaceShading(
      starSurface(SUN_TEFF, body.radius, { bodyId: 'sun', priority: 10, activity, view }),
    );
    if (registry.renderables().some((r) => r.id === V1_GLOW_ID)) registry.removeRenderable(V1_GLOW_ID);
    registry.addRenderable(
      createCorona(body, ctx.render.uniforms.uExposure, (f) => frames.has(f), activity, view),
    );
    registry.addSetting({
      id: SUN_FILTER_SETTING,
      label: 'Solar filter',
      group: 'Sky',
      type: 'select',
      default: 'off',
      options: [
        { value: 'off', label: 'Off (white light)' },
        { value: 'halpha', label: 'H-alpha (656.3 nm)' },
      ],
      description:
        'View the Sun through a narrowband H-alpha filter (not physical exposure). Sunspots, faculae, ' +
        'filaments, prominences and flares are simulated from the solar cycle, not real positions.',
      onChange: (v) => void (view.halpha = v === 'halpha'),
    });

    const bookmarks = [buildSunCloseup(body.radius)];
    const fixed = body.fixedFrame ?? 'sun.fixed';
    if (frames.has(fixed)) {
      const toSun = (jd: number) => {
        const q = frames.orientation(fixed, jd, quat());
        return (v: V3): V3 => {
          const w = qrotate(vec3(), q, vec3(...v));
          const o = vec3();
          frames.fromWorldDir(body.frame, w, jd, o);
          return [o.x, o.y, o.z];
        };
      };
      const jdSpots = parseInstant(SUNSPOT_DATE)!;
      const g = activeGroups(jdSpots)[0];
      if (g)
        bookmarks.push(buildSunspotBookmark(body.radius, jdSpots, g.centre, g.spots[0].dir, toSun(jdSpots)));
      const jdHa = parseInstant(HALPHA_DATE)!;
      const tall = prominences(jdHa, activeGroups(jdHa))
        .filter((p) => p.type === 0 && p.intensity > 0.9)
        .sort((a, b) => b.height - a.height)[0];
      if (tall) {
        const m = toSun(jdHa);
        bookmarks.push(buildHalphaBookmark(body.radius, jdHa, m(tall.dir), m([0, 0, 1])));
      }
    }
    registry.addBookmarks(bookmarks);

    // Reaching an H-alpha bookmark (palette, tour, URL) switches the filter on, like constellation lines.
    const override = (ctx.env.params as URLSearchParams).get(SUN_FILTER_SETTING);
    if (override === 'halpha' || override === 'off') ui.settings.set(SUN_FILTER_SETTING, override);
    else if (FILTER_BOOKMARKS.includes(initialBookmark(ctx) ?? ''))
      ui.settings.set(SUN_FILTER_SETTING, 'halpha');
    const p = vec3();
    ctx.camera.subscribe(() => {
      if (ctx.camera.traveling) return;
      const st = ctx.camera.getState();
      for (const id of FILTER_BOOKMARKS) {
        const bm = registry.bookmark(id);
        if (!bm || !frames.has(st.frame)) continue;
        frames.convertPoint(st.frame, st.local, bm.frame, ctx.clock.jd, p);
        const d = Math.hypot(p.x - bm.pos.x, p.y - bm.pos.y, p.z - bm.pos.z);
        if (d < 1e-6 * body.radius) ui.settings.set(SUN_FILTER_SETTING, 'halpha');
      }
    });
  },
};

export default sun;
