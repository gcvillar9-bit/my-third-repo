/**
 * cities: cities through history (docs/modules/cities.md). Labels of the cities that existed at the
 * clock's date with approximate populations (largest first, more as the camera nears the ground), and
 * a public query of settlements and monuments; the life module draws their era-styled buildings and
 * people at ground level. Data: a hand-entered history table from 7100 BC and Natural Earth for today.
 */
import type {
  LabelItem,
  ModuleContext,
  UniverseModule,
  ValidityRange,
  ViewState,
} from '../../core/contracts';
import { jdFromYearsBP } from '../../core/geotime';
import { JD_J2000 } from '../../core/units';
import { siteDirection } from '../atmosphere/public';
import { buildCityBookmarks } from './bookmarks';
import { formatPop, yearOfJd } from './data';
import { CITIES_MODULE_ID } from './ids';
import { citiesAtJd, loadCities, setAssets } from './state';

export const CITIES_VALIDITY: ValidityRange = {
  id: 'cities.population',
  appliesTo: 'cities',
  model: 'cities and populations by date (approximate)',
  jdMin: jdFromYearsBP(9050),
  jdMax: JD_J2000 + 100 * 365.25,
  beyond: 'hidden',
  source:
    'Chandler 1987, Modelski 2003, UN World Urbanization Prospects 2018 (hand-entered with sources per city); Natural Earth populated places',
};

let offLabels: (() => void) | null = null;
const LABELS_SETTING = 'cities.labels';

/** Labels: the largest cities of the date on the visible side of Earth, more when closer. */
function cityLabels(view: ViewState, out: LabelItem[], radius: number): void {
  const year = yearOfJd(view.jd);
  if (year < -7200) return;
  const e = view.toCamera('earth', { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  const d = Math.hypot(e.x, e.y, e.z);
  if (d > 12 * radius) return;
  loadCities();
  const list = citiesAtJd(view.jd);
  if (!list.length) return;
  const alt = d - radius;
  const n = alt > 2e7 ? 12 : alt > 5e6 ? 30 : alt > 1e6 ? 60 : 120;
  for (let i = 0; i < Math.min(n, list.length); i++) {
    const c = list[i];
    const up = siteDirection(c.lat, c.lon);
    out.push({
      id: `city:${c.id}`,
      text: `${c.name} ≈${formatPop(c.pop)}`,
      frame: 'earth.fixed',
      local: { x: up.x * (radius + 50), y: up.y * (radius + 50), z: up.z * (radius + 50) },
      priority: 8 + 2 * Math.log10(c.pop),
      color: '#ffd9a0',
    });
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
    offLabels = ctx.ui.addLabelSource({
      id: 'cities',
      labels: (view, out) => {
        if (on) cityLabels(view, out, earth.radius);
      },
    });
  },
  dispose() {
    offLabels?.();
    offLabels = null;
    setAssets(null);
  },
};

export default cities;
