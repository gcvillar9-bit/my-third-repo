/**
 * Per-slice fields derived from a PaleoDEM elevation map (360 x 180 cells, north row first): metres,
 * a signed coast distance and the distance to the sea against the prevailing wind. Pure and
 * three-free (bake worker and tests). Formats: docs/modules/paleo.md.
 */

export const DEM_W = 360;
export const DEM_H = 180;
const R_EARTH_KM = 6371;
const KM_PER_DEG = (Math.PI * R_EARTH_KM) / 180;
const DEG = Math.PI / 180;
/** Coast distances are only needed near coasts (blending, coast warp); beyond this they saturate. */
export const MAX_COAST_KM = 1500;

export interface SliceFields {
  /** Elevation, m (land >= 0). */
  elev: Float32Array;
  /** Signed distance to the nearest cell of the other kind, km: > 0 land, < 0 sea, |d| <= MAX_COAST_KM. */
  coastKm: Float32Array;
  /** Land: distance to the sea looking west / east along the latitude row, km (0 at sea). */
  seaWestKm: Float32Array;
  seaEastKm: Float32Array;
  /** Land: highest ground between the cell and that sea, m (rain shadows). */
  barrierWestM: Float32Array;
  barrierEastM: Float32Array;
}

/** Inverse of build-paleo's sqrt companding (128 = 0 m). */
export function decodeElevation(v: number, scaleM: number): number {
  const d = v - 128;
  return Math.sign(d) * (Math.abs(d) / 127) ** 2 * scaleM;
}

export const cellLat = (y: number): number => 89.5 - y;
export const cellLon = (x: number): number => -179.5 + x;

/** Squared local-equirectangular distance between cell centres, km^2 (accurate at coast scales). */
function dist2(y1: number, x1: number, y2: number, x2: number): number {
  let dx = x2 - x1;
  if (dx > DEM_W / 2) dx -= DEM_W;
  else if (dx < -DEM_W / 2) dx += DEM_W;
  const c = Math.cos(cellLat((y1 + y2) / 2) * DEG);
  const a = dx * c * KM_PER_DEG;
  const b = (y2 - y1) * KM_PER_DEG;
  return a * a + b * b;
}

/** Signed distance to the other kind (land/sea) by nearest-site propagation, capped at MAX_COAST_KM. */
export function coastDistanceKm(land: Uint8Array): Float32Array {
  const n = DEM_W * DEM_H;
  const siteX = new Int16Array(n).fill(-1);
  const siteY = new Int16Array(n).fill(-1);
  const d2 = new Float64Array(n).fill(Infinity);
  const visit = (x: number, y: number, nx: number, ny: number) => {
    if (ny < 0 || ny >= DEM_H) return false;
    nx = (nx + DEM_W) % DEM_W;
    const k = y * DEM_W + x;
    const kn = ny * DEM_W + nx;
    let sx = -1;
    let sy = -1;
    if (land[kn] !== land[k]) {
      sx = nx;
      sy = ny;
    } else if (siteX[kn] >= 0) {
      sx = siteX[kn];
      sy = siteY[kn];
    } else return false;
    const d = dist2(y, x, sy, sx);
    if (d < d2[k] - 1e-6) {
      d2[k] = d;
      siteX[k] = sx;
      siteY[k] = sy;
      return true;
    }
    return false;
  };
  const NB = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    const fwd = pass % 2 === 0;
    for (let i = 0; i < DEM_H; i++) {
      const y = fwd ? i : DEM_H - 1 - i;
      for (let j = 0; j < DEM_W; j++) {
        const x = fwd ? j : DEM_W - 1 - j;
        for (const [dx, dy] of NB) if (visit(x, y, x + dx, y + dy)) changed = true;
      }
    }
    if (!changed) break;
  }
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const d = Math.min(MAX_COAST_KM, Math.sqrt(d2[k]));
    out[k] = land[k] ? d : -d;
  }
  return out;
}

/**
 * Land cells: distance to the sea along the latitude row towards the west (dir -1) or east (+1), km,
 * and the highest elevation crossed on the way (excluding the cell), m.
 */
export function seaAlongRow(
  land: Uint8Array,
  elev: Float32Array,
  dir: 1 | -1,
): { km: Float32Array; barrierM: Float32Array } {
  const km = new Float32Array(DEM_W * DEM_H);
  const barrierM = new Float32Array(DEM_W * DEM_H);
  for (let y = 0; y < DEM_H; y++) {
    const stepKm = (2 * Math.PI * R_EARTH_KM * Math.cos(cellLat(y) * DEG)) / DEM_W;
    for (let x = 0; x < DEM_W; x++) {
      if (!land[y * DEM_W + x]) continue;
      let n = 0;
      let top = 0;
      while (n < DEM_W) {
        const k = y * DEM_W + ((x + dir * (n + 1) + DEM_W * 2) % DEM_W);
        if (!land[k]) break;
        top = Math.max(top, elev[k]);
        n++;
      }
      km[y * DEM_W + x] = (n + 0.5) * stepKm;
      barrierM[y * DEM_W + x] = top;
    }
  }
  return { km, barrierM };
}

/** Fields of one slice from its 8-bit grey elevation map. */
export function sliceFields(grey: Uint8Array, elevationScaleM: number): SliceFields {
  const n = DEM_W * DEM_H;
  const elev = new Float32Array(n);
  const land = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    elev[k] = decodeElevation(grey[k], elevationScaleM);
    land[k] = grey[k] >= 128 ? 1 : 0;
  }
  const west = seaAlongRow(land, elev, -1);
  const east = seaAlongRow(land, elev, 1);
  return {
    elev,
    coastKm: coastDistanceKm(land),
    seaWestKm: west.km,
    seaEastKm: east.km,
    barrierWestM: west.barrierM,
    barrierEastM: east.barrierM,
  };
}

/** Bilinear sample of a cell field at (latDeg, lonDeg), longitude wrapped, latitude clamped. */
export function sampleField(f: Float32Array, latDeg: number, lonDeg: number): number {
  const fx = lonDeg + 179.5;
  const fy = 89.5 - latDeg;
  const x0 = Math.floor(fx);
  const y0 = Math.max(0, Math.min(DEM_H - 2, Math.floor(fy)));
  const tx = fx - x0;
  const ty = Math.max(0, Math.min(1, fy - y0));
  const xa = ((x0 % DEM_W) + DEM_W) % DEM_W;
  const xb = (xa + 1) % DEM_W;
  const r0 = y0 * DEM_W;
  const r1 = r0 + DEM_W;
  const top = f[r0 + xa] + (f[r0 + xb] - f[r0 + xa]) * tx;
  const bot = f[r1 + xa] + (f[r1 + xb] - f[r1 + xa]) * tx;
  return top + (bot - top) * ty;
}
