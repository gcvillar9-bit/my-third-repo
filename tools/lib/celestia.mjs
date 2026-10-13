/**
 * Celestia .ssc reader (solarsys.ssc, minormoons.ssc, dwarfplanets.ssc, asteroids.ssc, comets.ssc ...).
 * Good enough for orbital elements, radii, masses, albedos and rings; not a full Celestia parser.
 *
 * Elements that Celestia overrides with a CustomOrbit are often kept as a commented-out EllipticalOrbit
 * ("# Overridden by CustomOrbit"); `extractOrbit` falls back to that block, which is what a Kepler
 * propagator needs.
 */

export const AU_KM = 149597870.7;
export const G_KM = 6.6743e-20; // km^3 kg^-1 s^-2 (CODATA 2018)
export const EARTH_MASS_KG = 5.9722e24;

const LENGTH_KM = { km: 1, m: 1e-3, AU: AU_KM, au: AU_KM, rE: 6378.14, rJ: 71492 };
const TIME_DAYS = { d: 1, y: 365.25, h: 1 / 24, min: 1 / 1440, s: 1 / 86400 };

/** Removes '#' comments (outside strings). */
export function stripComments(text) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      out += ch;
      if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
      out += ch;
    } else if (ch === '#') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else out += ch;
  }
  return out;
}

/** Text of the comment lines only, with the leading '#' removed (finds commented-out fallback blocks). */
export function commentedText(text) {
  return text
    .split('\n')
    .filter((l) => /^\s*#/.test(l))
    .map((l) => l.replace(/^\s*#\s?/, ''))
    .join('\n');
}

function skipString(text, i) {
  const j = text.indexOf('"', i + 1);
  return j < 0 ? text.length : j + 1;
}

/** Splits an .ssc file into top-level objects. */
export function parseSsc(text) {
  const objects = [];
  let i = 0;
  let headerStart = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '#') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '"') {
      i = skipString(text, i);
      continue;
    }
    if (ch === '{') {
      const header = stripComments(text.slice(headerStart, i));
      let depth = 1;
      const start = i + 1;
      i++;
      while (i < n && depth > 0) {
        const c = text[i];
        if (c === '#') {
          while (i < n && text[i] !== '\n') i++;
          continue;
        }
        if (c === '"') {
          i = skipString(text, i);
          continue;
        }
        if (c === '{') depth++;
        else if (c === '}') depth--;
        i++;
      }
      const raw = text.slice(start, i - 1);
      const strings = [...header.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
      const keyword = /^\s*([A-Za-z]+)\s*"/.exec(header)?.[1] ?? 'Body';
      if (strings.length >= 2) {
        const names = strings[0].split(':');
        objects.push({
          keyword,
          name: names[0],
          names,
          parent: strings[1],
          path: `${strings[1]}/${names[0]}`,
          raw,
          active: stripComments(raw),
          commented: commentedText(raw),
        });
      }
      headerStart = i;
      continue;
    }
    i++;
  }
  return objects;
}

/** Contents of the first `Key { ... }` block (nested braces allowed), or null. */
export function getBlock(text, key) {
  const re = new RegExp(`(?:^|[\\s}])${key}\\s*\\{`, 'm');
  const m = re.exec(text);
  if (!m) return null;
  let i = m.index + m[0].length;
  const start = i;
  let depth = 1;
  while (i < text.length && depth > 0) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
    i++;
  }
  return text.slice(start, i - 1);
}

/** Text with every nested { ... } removed, so top-level keys do not collide with sub-block keys. */
export function topLevel(text) {
  let out = '';
  let depth = 0;
  for (const ch of text) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (depth === 0) out += ch;
  }
  return out;
}

/** Numeric value of `Key` or `Key<unit>`: { value, unit } or null. */
export function getNumber(text, key) {
  const re = new RegExp(`(?:^|\\s)${key}(?:<(\\w+)>)?\\s+([-+]?[0-9.]+(?:[eE][-+]?\\d+)?)`, 'm');
  const m = re.exec(text);
  return m ? { value: Number(m[2]), unit: m[1] ?? null } : null;
}

export function getArray(text, key) {
  const m = new RegExp(`(?:^|\\s)${key}(?:<\\w+>)?\\s*\\[([^\\]]*)\\]`, 'm').exec(text);
  return m ? m[1].trim().split(/\s+/).map(Number) : null;
}

export function getString(text, key) {
  return new RegExp(`(?:^|\\s)${key}\\s+"([^"]*)"`, 'm').exec(text)?.[1] ?? null;
}

const OBLIQUITY_J2000 = (84381.406 / 3600) * (Math.PI / 180);

/** Ecliptic J2000 -> ICRF/equatorial J2000 (rotation about x by the obliquity). */
export function eclipticToEquatorial([x, y, z]) {
  const c = Math.cos(OBLIQUITY_J2000);
  const s = Math.sin(OBLIQUITY_J2000);
  return [x, c * y - s * z, s * y + c * z];
}

const norm = (v) => {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * TwoVector frame built from two ConstantVectors -> orthonormal ICRF axes {x, y, z}, or null when the
 * frame uses anything else (relative positions/velocities, other sub-frames).
 */
function parseTwoVector(text) {
  const axes = {};
  for (const key of ['Primary', 'Secondary']) {
    const b = getBlock(text, key);
    if (!b || !/ConstantVector/.test(b)) return null;
    const axis = getString(b, 'Axis')?.toLowerCase();
    let v = getArray(b, 'Vector');
    const sub = /Frame\s*\{\s*(\w+)/.exec(b)?.[1] ?? 'EquatorJ2000';
    if (!axis || !v) return null;
    if (sub === 'EclipticJ2000') v = eclipticToEquatorial(v);
    else if (sub !== 'EquatorJ2000') return null;
    const sign = axis.startsWith('-') ? -1 : 1;
    axes[axis.replace('-', '')] = norm(v).map((c) => c * sign);
  }
  if (!axes.x || !axes.z) return null;
  const z = axes.z;
  const d = axes.x[0] * z[0] + axes.x[1] * z[1] + axes.x[2] * z[2];
  const x = norm(axes.x.map((c, i) => c - d * z[i]));
  const r9 = (v) => v.map((c) => Number(c.toFixed(9)));
  return { x: r9(x), y: r9(cross(z, x)), z: r9(z) };
}

function parseFrame(text) {
  if (!text) return null;
  const type = /([A-Za-z0-9]+)\s*\{/.exec(text)?.[1] ?? null;
  const axes = type === 'TwoVector' ? parseTwoVector(text) : null;
  if (type === 'TwoVector' && !axes) throw new Error('unsupported TwoVector orbit frame');
  return { type: axes ? 'icrf-axes' : type, center: /Center\s+"([^"]+)"/.exec(text)?.[1] ?? null, axes };
}

function toKm(v, unit, helio) {
  if (unit) {
    if (!(unit in LENGTH_KM)) throw new Error(`unsupported length unit ${unit}`);
    return v * LENGTH_KM[unit];
  }
  return helio ? v * AU_KM : v;
}

function toDays(v, unit, helio) {
  if (unit) {
    if (!(unit in TIME_DAYS)) throw new Error(`unsupported time unit ${unit}`);
    return v * TIME_DAYS[unit];
  }
  return helio ? v * 365.25 : v;
}

function deg(text, key) {
  const n = getNumber(text, key);
  if (!n) return null;
  if (n.unit && n.unit !== 'deg') throw new Error(`unsupported angle unit ${n.unit}`);
  return n.value;
}

const FRAME_NAMES = { EclipticJ2000: 'ecliptic-j2000', EquatorJ2000: 'equator-j2000' };

/**
 * Keplerian elements of an object: { epoch (JD TT), a (km), e, i, node, argPeri, meanAnomaly (deg),
 * period (days), frame, center, fromComment }. Units follow Celestia: AU and Julian years when the
 * orbit is centred on the Sun/SSB, km and days otherwise. With no OrbitFrame, Celestia's default is the
 * J2000 ecliptic for heliocentric orbits and the parent's mean equator for satellites ('parent-equator').
 */
export function extractOrbit(obj) {
  let eo = getBlock(obj.active, 'EllipticalOrbit');
  let frameText = getBlock(obj.active, 'OrbitFrame');
  let fromComment = false;
  if (eo == null) {
    eo = getBlock(obj.commented, 'EllipticalOrbit');
    if (eo == null) return null;
    fromComment = true;
    frameText = getBlock(obj.commented, 'OrbitFrame') ?? frameText;
  }
  const frame = parseFrame(frameText);
  const center = frame?.center ?? obj.parent;
  const helio = center === 'Sol' || center === 'SSB';
  const ecc = getNumber(eo, 'Eccentricity')?.value ?? 0;
  const sma = getNumber(eo, 'SemiMajorAxis');
  const peri = getNumber(eo, 'PericenterDistance');
  const a = sma ? toKm(sma.value, sma.unit, helio) : toKm(peri.value, peri.unit, helio) / (1 - ecc);
  const node = deg(eo, 'AscendingNode') ?? 0;
  let argPeri = deg(eo, 'ArgOfPericenter');
  const longPeri = deg(eo, 'LongOfPericenter');
  if (argPeri == null) argPeri = longPeri != null ? longPeri - node : 0;
  let meanAnomaly = deg(eo, 'MeanAnomaly');
  const meanLong = deg(eo, 'MeanLongitude');
  if (meanAnomaly == null) meanAnomaly = meanLong != null ? meanLong - node - argPeri : 0;
  const per = getNumber(eo, 'Period');
  const norm = (x) => ((x % 360) + 360) % 360;
  return {
    epoch: getNumber(eo, 'Epoch')?.value ?? 2451545.0,
    a,
    e: ecc,
    i: deg(eo, 'Inclination') ?? 0,
    node: norm(node),
    argPeri: norm(argPeri),
    meanAnomaly: norm(meanAnomaly),
    period: per ? toDays(per.value, per.unit, helio) : null,
    frame: frame ? (FRAME_NAMES[frame.type] ?? frame.type) : helio ? 'ecliptic-j2000' : 'parent-equator',
    axes: frame?.axes ?? undefined,
    center,
    fromComment,
  };
}

/** Physical properties: radius (km, mean of SemiAxes when given), semiAxes, massKg, albedos, rings. */
export function extractPhysical(obj) {
  const top = topLevel(obj.active);
  const semiAxes = getArray(top, 'SemiAxes');
  const r = getNumber(top, 'Radius');
  const radius = semiAxes
    ? Math.cbrt(semiAxes[0] * semiAxes[1] * semiAxes[2])
    : r
      ? toKm(r.value, r.unit, false)
      : null;
  const mass = getNumber(top, 'Mass');
  const massKg = mass ? (mass.unit === 'kg' ? mass.value : mass.value * EARTH_MASS_KG) : null;
  const ringsText = getBlock(obj.active, 'Rings');
  return {
    cls: getString(top, 'Class'),
    radius,
    radiusIsMax: r != null && !semiAxes && /maximum semi-axis/.test(obj.raw),
    semiAxes,
    massKg,
    geomAlbedo: getNumber(top, 'GeomAlbedo')?.value ?? getNumber(top, 'Albedo')?.value ?? null,
    bondAlbedo: getNumber(top, 'BondAlbedo')?.value ?? getNumber(top, 'SphAlbedo')?.value ?? null,
    rotationPeriodHours: getNumber(top, 'RotationPeriod')?.value ?? null,
    texture: getString(top, 'Texture'),
    rings: ringsText
      ? { inner: getNumber(ringsText, 'Inner')?.value, outer: getNumber(ringsText, 'Outer')?.value }
      : null,
  };
}
