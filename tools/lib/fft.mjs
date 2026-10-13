/**
 * Radix-2 complex FFT (in place, Float64Array re/im), for offline tools such as Frankot-Chellappa
 * height recovery (P2 build-surfaces). Forward uses e^{-i...}; inverse divides by N.
 */

export function isPowerOfTwo(n) {
  return n > 0 && (n & (n - 1)) === 0;
}

/** In-place 1D FFT of length re.length (power of two). */
export function fft(re, im, inverse = false) {
  const n = re.length;
  if (!isPowerOfTwo(n) || im.length !== n) throw new Error(`fft length ${n} must be a power of two`);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

/** In-place 2D FFT of a row-major width x height grid (both powers of two). */
export function fft2d(re, im, width, height, inverse = false) {
  const rr = new Float64Array(width);
  const ri = new Float64Array(width);
  for (let y = 0; y < height; y++) {
    const o = y * width;
    for (let x = 0; x < width; x++) {
      rr[x] = re[o + x];
      ri[x] = im[o + x];
    }
    fft(rr, ri, inverse);
    for (let x = 0; x < width; x++) {
      re[o + x] = rr[x];
      im[o + x] = ri[x];
    }
  }
  const cr = new Float64Array(height);
  const ci = new Float64Array(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      cr[y] = re[y * width + x];
      ci[y] = im[y * width + x];
    }
    fft(cr, ci, inverse);
    for (let y = 0; y < height; y++) {
      re[y * width + x] = cr[y];
      im[y * width + x] = ci[y];
    }
  }
}
