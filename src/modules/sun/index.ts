/**
 * sun (P3-B): replaces the Sun v1 look. Priority-10 photosphere shading (Neckel limb darkening,
 * animated Worley granulation over a supergranular network), a Baumbach corona shell that shows in
 * totality or at low exposure, and the 'sun-closeup' bookmark. The v1 aureole quad registered by
 * solar-system ('solar-system.sun-glow', 2e-4 of the disk) is removed: it would outshine the corona
 * by 100x in totality. A living Sun on top: simulated sunspots, faculae, prominences and flares that
 * follow the solar cycle and differential rotation, and the 'sun.filter' setting (Off / H-alpha).
 * See docs/modules/sun.md.
 */
import type { Bookmark, InfoCard, ModuleContext, UniverseModule } from '../../core/contracts';
import { quat, qrotate, v3len, vec3 } from '../../core/math64';
import { SUN_TEFF } from '../../core/photometry';
import { parseInstant } from '../../core/time';
import { SunActivity, activeGroups } from './activity';
import {
  HALPHA_BOOKMARK_ID,
  HALPHA_DATE,
  SUNSPOT_DATE,
  buildHalphaBookmark,
  buildSunCloseup,
  buildSunspotBookmark,
  pickHalphaView,
} from './bookmarks';
import { createCorona } from './corona';
import { withActivity } from './info';
import { SUN_MODULE_ID, starSurface } from './public';
import type { SunViewSwitches } from './shading';
import data from './sun-data.json';

/** Renderable id of the Sun v1 glow quad (solar-system). */
export const V1_GLOW_ID = 'solar-system.sun-glow';
/** 'off' | 'halpha'. */
export const SUN_FILTER_SETTING = 'sun.filter';
/** Bookmarks that switch the H-alpha filter on when reached. */
const FILTER_BOOKMARKS = [HALPHA_BOOKMARK_ID];
/** A filter switched on by arrival goes back off beyond this distance from the Sun's centre, radii. */
export const FILTER_AUTO_OFF_RADII = 10;

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
    const fixed = body.fixedFrame ?? 'sun.fixed';
    const hasFixed = frames.has(fixed) && frames.has(body.frame);
    registry.setSurfaceShading(
      starSurface(SUN_TEFF, body.radius, {
        bodyId: 'sun',
        priority: 10,
        activity,
        view,
        frames: hasFixed ? { body: body.frame, fixed } : undefined,
      }),
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
      if (g && g.spots.length > 1) {
        const [lead, follow] = g.spots;
        const sep = Math.acos(
          Math.min(
            1,
            lead.dir.reduce((s, v, k) => s + v * follow.dir[k], 0),
          ),
        );
        const span = sep * body.radius + 2 * data.spots.penumbraRatio * (lead.umbraM + follow.umbraM) * 0.5;
        bookmarks.push(
          buildSunspotBookmark(body.radius, jdSpots, lead.dir, follow.dir, span, toSun(jdSpots)),
        );
      }
      // H-alpha: a tall quiescent prominence on the limb, framed so filaments and plage show on the disk.
      const jdHa = parseInstant(HALPHA_DATE)!;
      const pick = pickHalphaView(jdHa);
      if (pick) {
        const m = toSun(jdHa);
        bookmarks.push(buildHalphaBookmark(body.radius, jdHa, m(pick.anchor), m([0, 0, 1]), pick.side));
      }
    }
    registry.addBookmarks(bookmarks);

    // The Sun's info card comes from solar-system; decorate it in place (keeping the provider order) so the
    // simulated activity is labelled as such. A temporary shim until the registry has a hook for adding to
    // another module's card (docs/requests/sun.md); it does nothing if the provider is missing.
    const ss = registry.infoProviders().find((p) => p.id === 'solar-system');
    if (ss && typeof ss.info === 'function') {
      const base = ss.info.bind(ss);
      ss.info = async (id: string): Promise<InfoCard | null> => {
        const card = await base(id);
        if (id !== 'sun' || !card) return card;
        return withActivity(card, ctx.clock.jd, view.halpha ? 'halpha' : 'off');
      };
    }

    // Arriving at an H-alpha bookmark (palette, tour, URL) switches the filter on, like constellation lines.
    // Only the arrival does: the filter can then be switched off in Settings while staying there. The filter
    // is a physical change (no white-light corona, H-alpha-lit prominences), so a filter switched on by
    // arrival goes back off when the camera leaves the Sun (beyond FILTER_AUTO_OFF_RADII) or arrives at
    // another bookmark, unless the user has changed it since. An explicit ?sun.filter= wins over the initial
    // bookmark and is never undone.
    const params = ctx.env.params as URLSearchParams;
    const override = params.get(SUN_FILTER_SETTING);
    const startAt = FILTER_BOOKMARKS.includes(initialBookmark(ctx) ?? '');
    let autoOn = false;
    let ours = false;
    const setFilter = (v: 'off' | 'halpha') => {
      ours = true;
      try {
        ui.settings.set(SUN_FILTER_SETTING, v);
      } finally {
        ours = false;
      }
      autoOn = v === 'halpha';
    };
    ui.settings.subscribe(SUN_FILTER_SETTING, () => {
      if (!ours) autoOn = false; // the user took over
    });
    if (override === 'halpha' || override === 'off') ui.settings.set(SUN_FILTER_SETTING, override);
    else if (startAt) setFilter('halpha');
    let atFilterBookmark = startAt;
    const p = vec3();
    const atBookmark = (bm: Bookmark, frame: string, local: { x: number; y: number; z: number }): boolean => {
      if (!frames.has(bm.frame)) return false;
      frames.convertPoint(frame, local, bm.frame, ctx.clock.jd, p);
      return Math.hypot(p.x - bm.pos.x, p.y - bm.pos.y, p.z - bm.pos.z) < 1e-6 * body.radius;
    };
    ctx.camera.subscribe(() => {
      if (ctx.camera.traveling) return;
      const st = ctx.camera.getState();
      if (!frames.has(st.frame)) return;
      const at = FILTER_BOOKMARKS.some((id) => {
        const bm = registry.bookmark(id);
        return !!bm && atBookmark(bm, st.frame, st.local);
      });
      if (at && !atFilterBookmark) setFilter('halpha');
      else if (!at && autoOn) {
        const other = registry.bookmarks().some((bm) => atBookmark(bm, st.frame, st.local));
        if (other) setFilter('off');
      }
      atFilterBookmark = at;
    });
    const rel = vec3();
    const ORIGIN = vec3();
    ctx.render.onBeforeFrame((v) => {
      if (!autoOn || !frames.has(body.frame)) return;
      v.toCamera(body.frame, ORIGIN, rel);
      if (v3len(rel) > FILTER_AUTO_OFF_RADII * body.radius) setFilter('off');
    });
  },
};

export default sun;
