/**
 * Search entries ('neb:m42', 'neb:m43', 'neb:trapezium'), info cards (the two nebulae, the Trapezium and its
 * promoted stars) and labels. Every fact carries its source; model and rounded values are flagged approximate.
 */
import type {
  Bookmark,
  InfoCard,
  InfoFact,
  LabelItem,
  LabelSource,
  SearchEntry,
  SearchProvider,
  ViewState,
} from '../../core/contracts';
import { v3len, vec3 } from '../../core/math64';
import { LY, PC } from '../../core/units';
import { NEBULA_FRAME } from './frame';
import { D_PC, MODEL } from './model';
import orion from './orion.json';
import { cameraLocal } from './render';
import { absMagAtNebula, NEBULA_STARS, starBodyId, type NebulaStarRow } from './trapezium';

export const SEARCH_M42 = 'neb:m42';
export const SEARCH_M43 = 'neb:m43';
export const SEARCH_TRAPEZIUM = 'neb:trapezium';

const [ngc1976, ngc1982] = orion.catalogue;
const dist = orion.distance;
const geo = orion.geometry;
const ph = orion.photometry;
const C_ROW = NEBULA_STARS.find((s) => s.id === 'theta1-ori-c')!;
const NU_ROW = NEBULA_STARS.find((s) => s.id === 'nu-ori')!;

export const IMAGE_CREDIT =
  'Image: HG731GZ via Stellarium (CC BY 3.0); core detail: NASA, ESA, M. Robberto (STScI/ESA) and the HST Orion Treasury Project Team';

export function createSearch(targets: { m42: Bookmark; m43: Bookmark; trapezium: Bookmark }): SearchProvider {
  const entries: SearchEntry[] = [
    {
      id: SEARCH_M42,
      name: 'Orion Nebula',
      aliases: ['M42', 'Messier 42', 'NGC 1976', 'Great Orion Nebula', 'Orion Nebula M42'],
      subtitle: `Emission nebula in Orion · mag ${ngc1976.vMag.toFixed(1)}`,
      kind: 'other',
      target: targets.m42,
      priority: 3,
    },
    {
      id: SEARCH_M43,
      name: "De Mairan's Nebula",
      aliases: ['M43', 'Messier 43', 'NGC 1982', "Mairan's Nebula"],
      subtitle: `Emission nebula in Orion · mag ${ngc1982.vMag.toFixed(1)}`,
      kind: 'other',
      target: targets.m43,
      priority: 2,
    },
    {
      id: SEARCH_TRAPEZIUM,
      name: 'Trapezium Cluster',
      aliases: ['Trapezium', 'θ¹ Orionis', 'Theta1 Orionis', 'theta1 Ori', '41 Ori', 'Orion Trapezium'],
      subtitle: 'Young star cluster at the heart of M42',
      kind: 'cluster',
      target: targets.trapezium,
      priority: 2,
    },
  ];
  return { id: 'nebulae', entries: () => entries };
}

const distanceFacts = (): InfoFact[] => [
  {
    label: 'Distance',
    value: Math.round((dist.pc * PC) / LY / 10) * 10,
    unit: 'ly',
    approximate: true,
    source: dist.source,
  },
  { label: 'Distance', value: dist.pc, unit: 'pc', approximate: true },
];

const pcAt = (arcmin: number) => +((((arcmin / 60) * Math.PI) / 180) * D_PC).toFixed(1);

function starFacts(row: NebulaStarRow): InfoFact[] {
  return [
    { label: 'Spectral type', value: row.spectral, source: row.source },
    { label: 'Apparent magnitude (V, from Earth)', value: row.v.toFixed(2), source: row.source },
    { label: 'Absolute magnitude', value: absMagAtNebula(row.v).toFixed(2), approximate: true },
    { label: 'Effective temperature', value: row.teff, unit: 'K', approximate: true, source: row.source },
    { label: 'Radius', value: row.radiusRsun, unit: 'R☉', approximate: true },
    { label: 'Mass', value: row.massMsun, unit: 'M☉', approximate: true },
    ...distanceFacts(),
  ];
}

export function info(id: string): InfoCard | null {
  if (id === SEARCH_M42)
    return {
      title: 'Orion Nebula (M42)',
      subtitle: 'H II region in Orion · NGC 1976',
      facts: [
        ...distanceFacts(),
        { label: 'Apparent magnitude (V)', value: ngc1976.vMag.toFixed(1), source: ngc1976.source },
        {
          label: 'Apparent size',
          value: `${ngc1976.majArcmin}′ × ${ngc1976.minArcmin}′`,
          source: ngc1976.source,
        },
        {
          label: 'Physical size',
          value: `${pcAt(ngc1976.majArcmin)} × ${pcAt(ngc1976.minArcmin)}`,
          unit: 'pc',
          approximate: true,
        },
        {
          label: 'Peak surface brightness (V)',
          value: ph.coreMuV,
          unit: 'mag/arcsec²',
          approximate: true,
          source: ph.coreSource,
        },
        {
          label: 'Ionizing star',
          value: `θ¹ Ori C (${C_ROW.spectral}, ${C_ROW.teff} K)`,
          source: C_ROW.source,
        },
        {
          label: 'Ionization front',
          value: `${geo.bowl.z0Pc} pc behind θ¹ Ori C, concave towards us`,
          approximate: true,
          source: geo.bowl.source,
        },
        {
          label: 'Orion Bar',
          value: `${geo.bar.distancePc} pc SE of θ¹ Ori C`,
          approximate: true,
          source: geo.bar.source,
        },
        {
          label: "Orion's Veil",
          value: `~${Math.abs(geo.veil.zPc)} pc in front`,
          approximate: true,
          source: geo.veil.source,
        },
      ],
      description:
        'The nearest large star-forming region. Ultraviolet light from the Trapezium stars carves a bowl-shaped ' +
        'blister into the Orion molecular cloud; we look into the bowl from the open side. Seen from Earth the view ' +
        'is a calibrated photograph; its depth (the bowl, the Orion Bar, the Veil in front and the dark cloud behind, ' +
        'M43 as a separate ball) is a simplified model from published 3D studies, so views from other angles are ' +
        'approximate.',
      credit: IMAGE_CREDIT,
    };
  if (id === SEARCH_M43)
    return {
      title: "De Mairan's Nebula (M43)",
      subtitle: 'H II region in Orion · NGC 1982',
      facts: [
        ...distanceFacts(),
        { label: 'Apparent magnitude (V)', value: ngc1982.vMag.toFixed(1), source: ngc1982.source },
        {
          label: 'Apparent size',
          value: `${ngc1982.majArcmin}′ × ${ngc1982.minArcmin}′`,
          source: ngc1982.source,
        },
        { label: 'Radius', value: geo.m43.radiusPc, unit: 'pc', approximate: true, source: geo.m43.source },
        { label: 'Ionizing star', value: `NU Ori (${NU_ROW.spectral})`, source: NU_ROW.source },
      ],
      description:
        'A small, nearly round H II region ionized by a single hot star, NU Ori, separated from the Orion Nebula by ' +
        'a lane of dust. Drawn here as a sphere around NU Ori.',
      credit: IMAGE_CREDIT,
    };
  if (id === SEARCH_TRAPEZIUM)
    return {
      title: 'Trapezium Cluster',
      subtitle: 'θ¹ Orionis, the core of the Orion Nebula Cluster',
      facts: [
        ...distanceFacts(),
        { label: 'Bright members', value: 'θ¹ Ori A, B, C, D, E', source: C_ROW.source },
        { label: 'Brightest member', value: `θ¹ Ori C, V ${C_ROW.v}`, source: C_ROW.source },
        {
          label: 'θ¹ Ori C mass',
          value: C_ROW.massMsun,
          unit: 'M☉',
          approximate: true,
          source: C_ROW.source,
        },
        { label: 'Span', value: '~20″ (0.04 pc)', approximate: true },
      ],
      description:
        'Four bright stars in a small trapezoid (plus fainter B and E) at the centre of the Orion Nebula Cluster, ' +
        'about a million years old. θ¹ Ori C, an O7 star of ~33 solar masses, provides most of the ultraviolet ' +
        'light that makes the nebula glow. The stars are placed at the nebula distance along their catalogue ' +
        'directions (their depths inside the cluster are unknown).',
    };
  const row = NEBULA_STARS.find((s) => starBodyId(s) === id);
  if (row)
    return {
      title: row.name,
      subtitle: `Star in the Orion Nebula · ${row.spectral}`,
      facts: starFacts(row),
      description: 'Placed at the nebula distance along its catalogue direction (its depth is unknown).',
    };
  return null;
}

/**
 * Labels for M42, M43 and the Trapezium, shown when the nebula is large enough on screen and not too close. Their
 * priorities sit below the bright named stars (stars.labels: 30 - 4 m), which keep their labels in Orion.
 */
export function createLabels(enabled: () => boolean): LabelSource {
  const cam = vec3();
  const field = (2 * Math.tan((orion.field.halfWidthDeg * Math.PI) / 180) * D_PC) / 2;
  // Constant items (the label layer only reads them), so nothing is allocated per frame.
  const m42: LabelItem = {
    id: SEARCH_M42,
    text: 'Orion Nebula',
    frame: NEBULA_FRAME,
    local: vec3(0, 0.3 * PC, 0),
    priority: 26,
    color: '#f5b3c4',
    target: 'm42-from-20ly',
  };
  const m43: LabelItem = {
    id: SEARCH_M43,
    text: 'M43',
    frame: NEBULA_FRAME,
    local: vec3(MODEL.m43.x * PC, MODEL.m43.y * PC, 0),
    priority: 20,
    color: '#f5b3c4',
    target: 'm43-close',
  };
  const trapezium: LabelItem = {
    id: SEARCH_TRAPEZIUM,
    text: 'Trapezium',
    frame: NEBULA_FRAME,
    local: vec3(0, 0, 0),
    priority: 22,
    color: '#cfe0ff',
    target: 'trapezium-inside',
  };
  const sizePx = (half: number, at: number, pixelAngle: number) =>
    (2 * Math.atan2(half, Math.max(at, 1e-9))) / pixelAngle;
  return {
    id: 'nebulae.labels',
    labels(view: ViewState, out: LabelItem[]) {
      if (!enabled()) return;
      cameraLocal(view, cam);
      const d = v3len(cam);
      if (d > 2 && sizePx(field, d, view.pixelAngle) > 40) out.push(m42);
      const d43 = Math.hypot(cam.x - MODEL.m43.x, cam.y - MODEL.m43.y, cam.z);
      if (d43 > 0.8 && sizePx(MODEL.m43Radius, d43, view.pixelAngle) > 10) out.push(m43);
      if (d > 0.1 && d < 60 && sizePx(0.05, d, view.pixelAngle) > 6) out.push(trapezium);
    },
  };
}
