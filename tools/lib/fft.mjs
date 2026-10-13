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

/**
 * Frankot-Chellappa surface recovery (FFT Poisson, P2 build-surfaces): the height z whose gradient
 * best matches (p, q) = (dz/dx, dz/dy) in the least-squares sense on a row-major w x h grid
 * (x = column, y = row). x is periodic (equirectangular longitude). With `mirrorY` (default) the grid
 * is extended by its reflection in y (q negated) so a non-periodic y axis (pole to pole) has no
 * wrap-around jump; then 2h must be a power of two. The kernel matches central differences
 * (i sin omega, default) or the continuous derivative (kernel 'omega'). `lambda` > 0 adds Tikhonov
 * regularisation (denominator + lambda): wavelengths longer than 2 pi / sqrt(lambda) pixels, where
 * quantised normals carry almost no signal but FC amplifies their noise as 1/omega, are attenuated.
 * Returns a zero-mean Float64Array(w * h).
 */
export function frankotChellappa(p, q, w, h, { mirrorY = true, kernel = 'central', lambda = 0 } = {}) {
  const H = mirrorY ? 2 * h : h;
  if (!isPowerOfTwo(w) || !isPowerOfTwo(H))
    throw new Error(`frankotChellappa: ${w}x${H} must be powers of two`);
  const n = w * H;
  const pr = new Float64Array(n);
  const pi = new Float64Array(n);
  const qr = new Float64Array(n);
  const qi = new Float64Array(n);
  for (let y = 0; y < H; y++) {
    const src = y < h ? y : 2 * h - 1 - y;
    const sgn = y < h ? 1 : -1;
    for (let x = 0; x < w; x++) {
      pr[y * w + x] = p[src * w + x];
      qr[y * w + x] = sgn * q[src * w + x];
    }
  }
  fft2d(pr, pi, w, H);
  fft2d(qr, qi, w, H);
  const freq = (i, N) => (2 * Math.PI * (i <= N / 2 ? i : i - N)) / N;
  const sx = new Float64Array(w);
  const sy = new Float64Array(H);
  for (let i = 0; i < w; i++) sx[i] = kernel === 'omega' ? freq(i, w) : Math.sin(freq(i, w));
  for (let j = 0; j < H; j++) sy[j] = kernel === 'omega' ? freq(j, H) : Math.sin(freq(j, H));
  // Central difference of e^{i w x} is i sin(w): Z = (-i sx P - i sy Q) / (sx^2 + sy^2).
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < w; i++) {
      const o = j * w + i;
      const d = sx[i] * sx[i] + sy[j] * sy[j] + lambda;
      if (i === 0 && j === 0) {
        pr[o] = 0;
        pi[o] = 0;
        continue;
      }
      const re = sx[i] * pi[o] + sy[j] * qi[o];
      const im = -(sx[i] * pr[o] + sy[j] * qr[o]);
      pr[o] = re / d;
      pi[o] = im / d;
    }
  }
  fft2d(pr, pi, w, H, true);
  const z = new Float64Array(w * h);
  let mean = 0;
  for (let i = 0; i < w * h; i++) mean += pr[i];
  mean /= w * h;
  for (let i = 0; i < w * h; i++) z[i] = pr[i] - mean;
  return z;
}
