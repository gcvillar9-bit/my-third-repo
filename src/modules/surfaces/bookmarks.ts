/**
 * 'earth-himalaya': earth.fixed, 7.5 km above sea level over western Tibet (32.3 N 81.3 E), looking
 * south across the Kailash range towards the Himalayan crest (Gurla Mandhata, 30.4 N) in the early
 * morning (Sun 13 deg up in the south-east, from the left), so ridges are side-lit with long shadows.
 * The Everest massif itself sits under thick cloud in the static cloud map (earth.clouds at 6 km;
 * density > 0 for brc.B above ~0.06) and the 2k raster smooths its summits below that deck, so this
 * cloud-free stretch of the same orogen is used.
 */
import type { Bookmark, Vec3d } from '../../core/contracts';
import { qlookRotation, quat, v3normalize, vec3 } from '../../core/math64';
import { parseInstant } from '../../core/time';

const DEG = Math.PI / 180;

export const HIMALAYA_ID = 'earth-himalaya';
/** 2026-11-15 02:35 UTC (08:00 local solar time at 81.3 E). */
export const HIMALAYA_JD = parseInstant('2026-11-15T02:35:00Z')!;

/** Point at geocentric latitude/longitude, `h` metres above the ellipsoid (a, c), body-fixed axes. */
export function ellipsoidPoint(latDeg: number, lonDeg: number, h: number, a: number, c: number): Vec3d {
  const d = vec3(
    Math.cos(latDeg * DEG) * Math.cos(lonDeg * DEG),
    Math.cos(latDeg * DEG) * Math.sin(lonDeg * DEG),
    Math.sin(latDeg * DEG),
  );
  const r = 1 / Math.sqrt((d.x * d.x + d.y * d.y) / (a * a) + (d.z * d.z) / (c * c));
  return vec3(d.x * (r + h), d.y * (r + h), d.z * (r + h));
}

export function buildHimalayaBookmark(a: number, c: number): Bookmark {
  const pos = ellipsoidPoint(32.3, 81.3, 7500, a, c);
  const target = ellipsoidPoint(30.43, 81.3, 7000, a, c);
  const fwd = v3normalize(vec3(), vec3(target.x - pos.x, target.y - pos.y, target.z - pos.z));
  const up = v3normalize(vec3(), pos);
  return {
    id: HIMALAYA_ID,
    title: 'Himalaya from 7.5 km',
    frame: 'earth.fixed',
    pos,
    quat: qlookRotation(quat(), fwd, up),
    jd: HIMALAYA_JD,
    ev: 14,
    fovY: 35 * DEG,
    lookTarget:
      'Brown Tibetan ranges with ridged flanks lit from the left (low morning Sun) and long shadows, ' +
      'receding to a hazy, jagged skyline across the middle of the frame; blue sky above.',
  };
}
