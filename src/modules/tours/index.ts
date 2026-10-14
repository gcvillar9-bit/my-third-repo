/**
 * tours (P5-B): registers the Cosmic Zoom tour, a palette entry per tour ("Tour: Cosmic Zoom")
 * and plays tours with TourPlayer, ticked from render.onBeforeFrame with the real frame time
 * (fixed 1/60 s in test mode). Esc exits, the overlay pauses and skips. `?tour=<id>` starts a
 * tour after boot and `?tourspeed=<k>` plays it k times faster (e2e).
 */
import type { Bookmark, ModuleContext, UniverseModule } from '../../core/contracts';
import { qfromAxisAngle, qmul, qnormalize, qrotate, quat, v3add, v3sub, vec3 } from '../../core/math64';
import { photo } from '../photo/public';
import { CONSTELLATIONS_SETTING, LINE_BOOKMARKS } from '../starsystems/public';
import { COSMIC_ZOOM } from './cosmic-zoom';
import { TourOverlay } from './overlay';
import { TourPlayer, type TourActions } from './player';
import { provideTours, TOUR_ENTRY_PREFIX, TOURS_MODULE_ID } from './public';

const ZERO = vec3();
const UP = vec3(0, 1, 0);

function makeActions(ctx: ModuleContext): TourActions {
  const { registry, frames, camera, clock, ui } = ctx;
  const tgt = vec3();
  const rel = vec3();
  const axis = vec3();
  const rot = quat();
  return {
    has: (t) => {
      if (typeof t !== 'string') return frames.has(t.frame);
      const bm = registry.bookmark(t);
      if (bm) return frames.has(bm.frame);
      const b = registry.body(t);
      return !!b && frames.has(b.frame);
    },
    goto: (t, duration) => {
      if (LINE_BOOKMARKS.includes(idOf(t))) ui.settings.set(CONSTELLATIONS_SETTING, true);
      void camera.goto(t, { duration });
    },
    orbit: (id, radians) => {
      const b = registry.body(id);
      if (!b || !frames.has(b.frame) || camera.traveling || camera.mode === 'walk') return;
      const st = camera.getState();
      frames.convertPoint(b.frame, ZERO, st.frame, clock.jd, tgt);
      v3sub(rel, st.local, tgt);
      qrotate(axis, st.quat, UP);
      qfromAxisAngle(rot, axis, radians);
      const local = v3add(vec3(), tgt, qrotate(rel, rot, rel));
      camera.setState({ local, quat: qnormalize(quat(), qmul(quat(), rot, st.quat)) });
    },
    setRate: (r) => {
      if (clock.paused) clock.resume();
      clock.setRate(r);
    },
    setTime: (jd) => (jd === 'now' ? clock.setNow() : clock.setTime(jd)),
    caption: (text) => ui.setCaption(text),
    setting: (id, value) => ui.settings.set(id, value),
  };
}

const isEditable = (t: EventTarget | null): boolean =>
  typeof HTMLElement !== 'undefined' &&
  t instanceof HTMLElement &&
  (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

const toursModule: UniverseModule = {
  id: TOURS_MODULE_ID,
  init(ctx) {
    const { registry, render, clock, env } = ctx;
    registry.addTour(COSMIC_ZOOM);
    registry.addSearch({
      id: 'tours',
      entries: () =>
        registry.tours().map((t) => ({
          id: TOUR_ENTRY_PREFIX + t.id,
          name: `Tour: ${t.title}`,
          aliases: [t.title, 'tour', 'guided tour'],
          subtitle: t.description ?? 'Guided tour',
          kind: 'tour' as const,
          target: TOUR_ENTRY_PREFIX + t.id,
          priority: 10,
        })),
    });

    const actions = makeActions(ctx);
    const speedParam = Number(env.params.get('tourspeed'));
    const speed = speedParam > 0 ? Math.min(100, speedParam) : 1;
    let player: TourPlayer | null = null;
    let overlay: TourOverlay | null = null;
    let rateBefore = 1;
    const hasDom = typeof document !== 'undefined';

    const end = () => {
      if (!player) return;
      player.stop();
      player = null;
      overlay?.dispose();
      overlay = null;
      if (clock.rate !== rateBefore) clock.setRate(rateBefore);
    };
    const control = {
      start(id: string): boolean {
        const def = registry.tours().find((t) => t.id === id);
        if (!def) return false;
        end();
        rateBefore = clock.rate || 1;
        player = new TourPlayer(def, actions, speed);
        if (player.tour.skipped.length)
          console.info(`[tours] ${id}: skipped missing stops`, player.tour.skipped.map(idOf));
        if (hasDom) {
          overlay = new TourOverlay(document.getElementById('ui') ?? document.body, {
            pause: () => control.togglePause(),
            next: () => player?.next(),
            exit: () => end(),
          });
          overlay.update(player.status());
        }
        return true;
      },
      stop: end,
      togglePause() {
        if (player) player.paused = !player.paused;
      },
      next: () => player?.next(),
      status: () => player?.status() ?? null,
    };
    provideTours(control);

    let pendingUrlTour = env.params.get('tour');
    render.onBeforeFrame((view) => {
      if (pendingUrlTour) {
        if (!control.start(pendingUrlTour)) console.warn(`[tours] unknown tour '${pendingUrlTour}'`);
        pendingUrlTour = null;
      }
      if (!player) return;
      player.tick(view.dtReal);
      if (player.done) end();
      else overlay?.update(player.status());
    });

    if (hasDom && typeof window !== 'undefined')
      window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !player || photo.active || isEditable(e.target)) return;
        end();
      });
  },
};

const idOf = (t: string | Bookmark) => (typeof t === 'string' ? t : t.id);

export default toursModule;
