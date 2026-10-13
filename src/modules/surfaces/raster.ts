/**
 * Equirectangular height rasters (row 0 = north, column 0 = longitude -180 deg) with a box mip chain
 * and band-limited bicubic (Catmull-Rom) sampling in float64. Rows past a pole continue on the
 * opposite meridian (lon + 180 deg), columns wrap, so sampling is continuous across the date line
 * and the poles.
 */
export class Raster {
  /** levels[m] is (w >> m) x (h >> m), metres (or mask fraction). */
  readonly levels: { w: number; h: number; data: Float32Array }[] = [];

  constructor(w: number, h: number, data: Float32Array) {
    this.levels.push({ w, h, data });
    while (this.levels.length < 12) {
      const prev = this.levels[this.levels.length - 1];
      if (prev.w < 8 || prev.h < 4) break;
      const nw = prev.w >> 1;
      const nh = prev.h >> 1;
      const d = new Float32Array(nw * nh);
      for (let y = 0; y < nh; y++)
        for (let x = 0; x < nw; x++) {
          const o = 2 * y * prev.w + 2 * x;
          d[y * nw + x] =
            0.25 * (prev.data[o] + prev.data[o + 1] + prev.data[o + prev.w] + prev.data[o + prev.w + 1]);
        }
      this.levels.push({ w: nw, h: nh, data: d });
    }
  }

  /** Value at integer texel (x, y) of mip m, with pole reflection and longitude wrap. */
  private texel(m: number, x: number, y: number): number {
    const { w, h, data } = this.levels[m];
    if (y < 0) {
      y = -1 - y;
      x += w >> 1;
    } else if (y >= h) {
      y = 2 * h - 1 - y;
      x += w >> 1;
    }
    x %= w;
    if (x < 0) x += w;
    return data[y * w + x];
  }

  /** Catmull-Rom bicubic at (u, v) in [0, 1) (u east from -180 deg, v south from the north pole) on mip m. */
  bicubic(m: number, u: number, v: number): number {
    const { w, h } = this.levels[m];
    const fx = u * w - 0.5;
    const fy = v * h - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const wx = weights(tx);
    const wy = weights(ty);
    let s = 0;
    for (let j = 0; j < 4; j++) {
      let r = 0;
      for (let i = 0; i < 4; i++) r += wx[i] * this.texel(m, x0 - 1 + i, y0 - 1 + j);
      s += wy[j] * r;
    }
    return s;
  }

  /** Bilinear at (u, v) on mip m (masks). */
  bilinear(m: number, u: number, v: number): number {
    const { w, h } = this.levels[m];
    const fx = u * w - 0.5;
    const fy = v * h - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const a = this.texel(m, x0, y0) * (1 - tx) + this.texel(m, x0 + 1, y0) * tx;
    const b = this.texel(m, x0, y0 + 1) * (1 - tx) + this.texel(m, x0 + 1, y0 + 1) * tx;
    return a * (1 - ty) + b * ty;
  }

  /**
   * Band-limited sample for a grid of spacing `cell` metres on a body of `radius`: blends the two mips
   * whose texel size brackets the cell size (texel >= cell, so nothing finer than the grid aliases).
   */
  sample(u: number, v: number, cell: number, radius: number, linear = false): number {
    const texel = (2 * Math.PI * radius) / this.levels[0].w;
    const mf = Math.max(0, Math.log2(cell / texel));
    const top = this.levels.length - 1;
    const m0 = Math.min(top, Math.floor(mf));
    const m1 = Math.min(top, m0 + 1);
    const t = Math.min(1, mf - m0);
    const f = linear ? this.bilinear.bind(this) : this.bicubic.bind(this);
    const a = f(m0, u, v);
    return t > 0 && m1 !== m0 ? a + t * (f(m1, u, v) - a) : a;
  }
}

function weights(t: number): [number, number, number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    0.5 * (-t3 + 2 * t2 - t),
    0.5 * (3 * t3 - 5 * t2 + 2),
    0.5 * (-3 * t3 + 4 * t2 + t),
    0.5 * (t3 - t2),
  ];
}

/** Equirectangular (u, v) of a unit body-fixed direction: u = lon/2pi + 0.5, v = 0.5 - lat/pi. */
export function dirToUv(x: number, y: number, z: number, out: Float64Array): void {
  out[0] = Math.atan2(y, x) / (2 * Math.PI) + 0.5;
  out[1] = 0.5 - Math.asin(Math.max(-1, Math.min(1, z))) / Math.PI;
}
