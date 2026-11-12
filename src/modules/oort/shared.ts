/**
 * Shared state of the oort module (three-free): setting ids, the fades that keep every Oort Cloud visual
 * out of inner Solar System views and out of other stars' skies, and the axes helpers both parts use.
 * Updated once per frame (render.onBeforeFrame runs before every Renderable.update).
 */
import type { ModuleContext, Vec3d, ViewState } from '../../core/contracts';
import { ICRS_TO_GALACTIC } from '../../core/frames';
import { v3len, v3set, vec3 } from '../../core/math64';
import { AU } from '../../core/units';
import { OBLIQUITY_J2000 } from '../solar-system/public';

export const OORT_MODULE_ID = 'oort';
/** The simulated comet cloud (points and region labels). Real objects stay on when it is off. */
export const SETTING_ENABLED = 'oort.enabled';
/** Multiplier on the cloud's (artificial) brightness; 0 is reality: invisible. */
export const SETTING_BRIGHTNESS = 'oort.brightness';
/** Scale shells and their labels. */
export const SETTING_MARKERS = 'oort.markers';
/** The app-wide orbit-lines switch registered by solar-system (unset counts as on). */
export const ORBIT_LINES_SETTING = 'solar-system.orbits';

/** Cloud points fade in between these camera distances from the Sun, AU. */
export const CLOUD_FADE_IN_AU: readonly [number, number] = [200, 1500];
/** Shells, tracks and the orbit lines of unselected objects fade in between these distances, AU. */
export const LINE_FADE_IN_AU: readonly [number, number] = [200, 400];
/** Everything fades out between these distances, AU (gone before Alpha Centauri at 276,000 AU). */
export const FAR_FADE_AU: readonly [number, number] = [200_000, 260_000];

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const cosE = Math.cos(OBLIQUITY_J2000);
const sinE = Math.sin(OBLIQUITY_J2000);
/** Ecliptic J2000 -> ICRF (Rx(obliquity)). */
export const eclToIcrf = (out: Vec3d, v: Vec3d): Vec3d =>
  v3set(out, v.x, cosE * v.y - sinE * v.z, sinE * v.y + cosE * v.z);
/** ICRF -> ecliptic J2000. */
export const icrfToEcl = (out: Vec3d, v: Vec3d): Vec3d =>
  v3set(out, v.x, cosE * v.y + sinE * v.z, -sinE * v.y + cosE * v.z);

/** Row `k` of ICRS_TO_GALACTIC is the galactic axis `k` in ICRS components. */
const galAxisEcl = (k: number): Vec3d =>
  Object.freeze(
    icrfToEcl(
      vec3(),
      vec3(ICRS_TO_GALACTIC[3 * k], ICRS_TO_GALACTIC[3 * k + 1], ICRS_TO_GALACTIC[3 * k + 2]),
    ),
  );
/** Unit vector to the Galactic centre (l = 0, b = 0), ecliptic J2000 axes. */
export const GALACTIC_CENTRE_ECL: Readonly<Vec3d> = galAxisEcl(0);
/** Unit vector to the north Galactic pole, ecliptic J2000 axes (60.2 degrees from the ecliptic pole). */
export const GALACTIC_POLE_ECL: Readonly<Vec3d> = galAxisEcl(2);

/** '1,234 AU' / '12,300 AU' with thousands separators (3 significant digits above 1000). */
export function formatAu(au: number): string {
  const v = au >= 1000 ? Number(au.toPrecision(3)) : Math.round(au);
  return `${v.toLocaleString('en-US')} AU`;
}

export interface OortShared {
  /** Camera position relative to the Sun, ecliptic J2000 axes, m. */
  readonly camEcl: Readonly<Vec3d>;
  /** Camera distance from the Sun, AU. */
  readonly sunDistAu: number;
  /** 0..1 fade of the cloud points and region labels (0 inside 200 AU and beyond 260,000 AU, or disabled). */
  readonly cloudFade: number;
  /** 0..1 fade of shells, flyby tracks and unselected orbit lines, before their own switches. */
  readonly lineFade: number;
  /** Brightness multiplier of the cloud points (setting 'oort.brightness'). */
  readonly brightness: number;
  /** Setting 'oort.markers'. */
  readonly markers: boolean;
  /** Setting 'solar-system.orbits' (unset counts as on). */
  readonly orbitLines: boolean;
  /** Frame the values belong to. */
  readonly frameIndex: number;
  update(view: ViewState): void;
}

/** Pure fades (unit-tested): camera distance from the Sun in AU -> [cloud, lines]. */
export function fadesAt(sunDistAu: number): [number, number] {
  const far = 1 - smoothstep(FAR_FADE_AU[0], FAR_FADE_AU[1], sunDistAu);
  return [
    far * smoothstep(CLOUD_FADE_IN_AU[0], CLOUD_FADE_IN_AU[1], sunDistAu),
    far * smoothstep(LINE_FADE_IN_AU[0], LINE_FADE_IN_AU[1], sunDistAu),
  ];
}

export function createOortShared(ctx: ModuleContext): OortShared {
  const settings = ctx.ui.settings;
  const toSun = vec3();
  const ORIGIN = vec3();
  const camEcl = vec3();
  const s = {
    camEcl,
    sunDistAu: 0,
    cloudFade: 0,
    lineFade: 0,
    brightness: 1,
    markers: true,
    orbitLines: true,
    frameIndex: -1,
    update(view: ViewState) {
      if (ctx.frames.has('sun')) view.toCamera('sun', ORIGIN, toSun);
      else view.sunToCamera(toSun);
      icrfToEcl(camEcl, v3set(camEcl, -toSun.x, -toSun.y, -toSun.z));
      s.sunDistAu = v3len(toSun) / AU;
      const [cloud, lines] = fadesAt(s.sunDistAu);
      const b = Number(settings.get(SETTING_BRIGHTNESS) ?? 1);
      s.brightness = Number.isFinite(b) ? Math.max(0, b) : 1;
      s.cloudFade = settings.get(SETTING_ENABLED) === false ? 0 : cloud;
      s.lineFade = lines;
      s.markers = settings.get(SETTING_MARKERS) !== false;
      s.orbitLines = settings.get(ORBIT_LINES_SETTING) !== false;
      s.frameIndex = view.frameIndex;
    },
  };
  return s;
}
