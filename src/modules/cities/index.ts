/**
 * cities: cities through history (docs/modules/cities.md). Labels of the cities that existed at the
 * clock's date with approximate populations (largest first among those above the horizon, more as the
 * camera nears the ground), and a public query of settlements and monuments; the life module draws their
 * era-styled buildings and people at ground level. Data: a hand-entered history table from Jericho
 * (8000 BC, TOWNS_FROM_YEAR) and Natural Earth for today.
 */
import type {
  LabelItem,
  ModuleContext,
  UniverseModule,
  ValidityRange,
  ViewState,
} from '../../core/contracts';
import { qrotateInv, quat, vec3 } from '../../core/math64';
import { JD_J2000 } from '../../core/units';
import { siteDirection } from '../atmosphere/public';
import { buildCityBookmarks, ellipsoid } from './bookmarks';
import { TOWNS_FROM_YEAR, formatPop, jdOfAstroYear, yearOfJd, type City } from './data';
import { CITIES_MODULE_ID } from './ids';
import { citiesAtJd, loadCities, setAssets } from './state';

export const CITIES_VALIDITY: ValidityRange = {
  id: 'cities.population',
  appliesTo: 'cities',
  model: 'cities and populations by date (approximate)',
  jdMin: jdOfAstroYear(TOWNS_FROM_YEAR),
  jdMax: JD_J2000 + 100 * 365.25,
  beyond: 'hidden',
  source:
    'Chandler 1987, Modelski 2003, UN World Urbanization Prospects 2018 (hand-entered with sources per city); Natural Earth populated places',
};

let offLabels: (() => void) | null = null;
const LABELS_SETTING = 'cities.labels';
/** Height of a label above the ellipsoid, m. */
export const LABEL_HEIGHT_M = 50;

/** Earth's figure for the labels. */
export interface LabelBody {
  id: string;
  radius: number;
  oblateness: number;
  fixedFrame: string;
}

// Unit directions (body-fixed) of the cities of the current list, refilled when the list changes.
let dirList: City[] | null = null;
let dirs = new Float64Array(0);
const ORIGIN = vec3();
const toEarth = vec3();
const cam = vec3();
const dir = vec3();
const fixedQuat = quat();

/**
 * Labels: the largest cities of the date above the camera's horizon, more when closer. A label stands
 * LABEL_HEIGHT_M above the ellipsoid and is kept while it is within the horizon cap of the camera (the
 * angle from the camera's nadir below acos(g/d) + acos(g/(g + LABEL_HEIGHT_M)), g the ground radius under
 * the camera, terrain included, as if the labelled towns stood on that ground), so at street level only
 * towns within a few tens of km are named, on a high plateau too.
 */
export function cityLabels(view: ViewState, out: LabelItem[], body: LabelBody): void {
  const year = yearOfJd(view.jd);
  if (year < TOWNS_FROM_YEAR) return;
  const e = view.toCamera('earth', ORIGIN, toEarth);
  const d = Math.hypot(e.x, e.y, e.z);
  const { radius, oblateness: f } = body;
  if (d > 12 * radius || d === 0) return;
  loadCities();
  const list = citiesAtJd(view.jd);
  if (!list.length) return;
  if (list !== dirList) {
    if (dirs.length < list.length * 3) dirs = new Float64Array(list.length * 3);
    for (let i = 0; i < list.length; i++) {
      const u = siteDirection(list[i].lat, list[i].lon);
      dirs[i * 3] = u.x;
      dirs[i * 3 + 1] = u.y;
      dirs[i * 3 + 2] = u.z;
    }
    dirList = list;
  }
  // Camera direction from Earth's centre in body-fixed axes.
  cam.x = -e.x / d;
  cam.y = -e.y / d;
  cam.z = -e.z / d;
  qrotateInv(cam, view.frameQuat(body.fixedFrame, fixedQuat), cam);
  const R = ellipsoid(cam, radius, f);
  const alt = d - R;
  const n = alt > 2e7 ? 12 : alt > 5e6 ? 30 : alt > 1e6 ? 60 : 120;
  // Height above the ground under the camera (the camera's ground, terrain included; the ellipsoid
  // without it or below sea level): from Tenochtitlan's 2240 m the ellipsoid's horizon is 170 km away.
  const near = view.nearestSurface();
  const h = Math.max(0, near?.bodyId === body.id ? Math.min(alt, near.altitude) : alt);
  const g = d - h;
  const cosCap = Math.cos(Math.acos(g / d) + Math.acos(g / (g + LABEL_HEIGHT_M)));
  let shown = 0;
  for (let i = 0; i < list.length && shown < n; i++) {
    dir.x = dirs[i * 3];
    dir.y = dirs[i * 3 + 1];
    dir.z = dirs[i * 3 + 2];
    if (dir.x * cam.x + dir.y * cam.y + dir.z * cam.z < cosCap) continue;
    const c = list[i];
    const r = ellipsoid(dir, radius, f) + LABEL_HEIGHT_M;
    out.push({
      id: `city:${c.id}`,
      text: `${c.name} ≈${formatPop(c.pop)}`,
      frame: body.fixedFrame,
      local: { x: dir.x * r, y: dir.y * r, z: dir.z * r },
      priority: 8 + 2 * Math.log10(c.pop),
      color: '#ffd9a0',
    });
    shown++;
  }
}

const cities: UniverseModule = {
  id: CITIES_MODULE_ID,
  dependsOn: ['earth', 'atmosphere', 'paleo'],
  init(ctx: ModuleContext) {
    setAssets(ctx.assets);
    const earth = ctx.registry.body('earth');
    if (!earth) return;
    ctx.registry.addValidity(CITIES_VALIDITY);
    ctx.registry.addBookmarks(
      buildCityBookmarks(ctx.frames, earth.radius, earth.oblateness ?? 0, earth.fixedFrame ?? 'earth.fixed'),
    );
    let on = ctx.ui.settings.get<boolean>(LABELS_SETTING) !== false;
    ctx.registry.addSetting({
      id: LABELS_SETTING,
      label: 'City labels',
      group: 'Labels',
      type: 'boolean',
      default: true,
      persist: true,
      description: 'Names and approximate populations of the cities that existed at the clock date.',
      onChange: (v) => {
        on = v !== false;
      },
    });
    const body: LabelBody = {
      id: earth.id,
      radius: earth.radius,
      oblateness: earth.oblateness ?? 0,
      fixedFrame: earth.fixedFrame ?? 'earth.fixed',
    };
    offLabels = ctx.ui.addLabelSource({
      id: 'cities',
      labels: (view, out) => {
        if (on) cityLabels(view, out, body);
      },
    });
  },
  dispose() {
    offLabels?.();
    offLabels = null;
    dirList = null;
    setAssets(null);
  },
};

export default cities;
