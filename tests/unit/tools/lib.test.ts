import { describe, expect, it } from 'vitest';
import { AU_KM, extractOrbit, extractPhysical, parseSsc } from '../../../tools/lib/celestia.mjs';
import { fft, fft2d } from '../../../tools/lib/fft.mjs';

const SSC = `
# header comment with "quotes" and { braces }
ReferencePoint "Bary" "Sol"
{
	EllipticalOrbit { Period 248.0 SemiMajorAxis 39.5 Eccentricity 0.25 Inclination 17.1 AscendingNode 110 ArgOfPericenter 113 MeanAnomaly 37 Epoch 2457218.0 }
}
"Moonlet:Planet I" "Sol/Planet"
{
	Radius 12.95  # maximum semi-axis
	Mass<kg> 1.0e16
	GeomAlbedo 0.07
	Atmosphere { Height 10 }
	OrbitFrame { EclipticJ2000 { Center "Sol/Planet" } }
	CustomOrbit "moonlet"
	# Overridden by CustomOrbit
	# EllipticalOrbit
	# {
	#	Period 0.5
	#	SemiMajorAxis 9378
	#	Eccentricity 0.015
	#	LongOfPericenter 100
	#	AscendingNode 40
	#	MeanLongitude 160
	# }
}
"Tilted" "Sol/Planet"
{
	SemiAxes [ 102.8 102.8 70.7 ]
	OrbitFrame { TwoVector { Center "Sol/Planet"
		Primary { Axis "x" ConstantVector { Vector [ 1 0 0 ] Frame { EquatorJ2000 { Center "Sol/Planet" } } } }
		Secondary { Axis "z" ConstantVector { Vector [ 0 0.1 1 ] Frame { EquatorJ2000 { Center "Sol/Planet" } } } } } }
	EllipticalOrbit { Period 1 SemiMajorAxis 1000 }
}
`;

describe('Celestia .ssc reader', () => {
  const objs = parseSsc(SSC);
  it('splits objects with keywords, aliases and parents', () => {
    expect(objs.map((o) => [o.keyword, o.name, o.parent])).toEqual([
      ['ReferencePoint', 'Bary', 'Sol'],
      ['Body', 'Moonlet', 'Sol/Planet'],
      ['Body', 'Tilted', 'Sol/Planet'],
    ]);
    expect(objs[1].names).toEqual(['Moonlet', 'Planet I']);
  });

  it('uses AU/years around the Sun and km/days otherwise', () => {
    const el = extractOrbit(objs[0])!;
    expect(el.a).toBeCloseTo(39.5 * AU_KM, 0);
    expect(el.period).toBeCloseTo(248 * 365.25, 6);
    expect(el.frame).toBe('ecliptic-j2000');
    expect(el.center).toBe('Sol');
  });

  it('falls back to the commented-out EllipticalOrbit and converts longitudes', () => {
    const el = extractOrbit(objs[1])!;
    expect(el.fromComment).toBe(true);
    expect(el.a).toBe(9378);
    expect(el.period).toBe(0.5);
    expect(el.argPeri).toBeCloseTo(60, 9); // 100 - 40
    expect(el.meanAnomaly).toBeCloseTo(60, 9); // 160 - 100
    expect(el.epoch).toBe(2451545);
    expect(el.frame).toBe('ecliptic-j2000');
    const ph = extractPhysical(objs[1]);
    expect(ph.radius).toBe(12.95);
    expect(ph.radiusIsMax).toBe(true);
    expect(ph.massKg).toBe(1e16);
    expect(ph.geomAlbedo).toBe(0.07);
  });

  it('turns ConstantVector TwoVector frames into orthonormal ICRF axes', () => {
    const el = extractOrbit(objs[2])!;
    expect(el.frame).toBe('icrf-axes');
    const { x, y, z } = el.axes!;
    expect(Math.hypot(...z)).toBeCloseTo(1, 8);
    expect(x[0] * z[0] + x[1] * z[1] + x[2] * z[2]).toBeCloseTo(0, 8);
    expect(y[1]).toBeGreaterThan(0.99);
    expect(extractPhysical(objs[2]).radius).toBeCloseTo(Math.cbrt(102.8 * 102.8 * 70.7), 9);
  });
});

describe('radix-2 FFT', () => {
  it('transforms a delta to a constant and round-trips', () => {
    const re = new Float64Array(8);
    const im = new Float64Array(8);
    re[0] = 1;
    fft(re, im);
    expect([...re]).toEqual(new Array(8).fill(1));
    fft(re, im, true);
    expect(re[0]).toBeCloseTo(1, 12);
    expect(re[3]).toBeCloseTo(0, 12);
  });

  it('matches a direct DFT and round-trips in 2D', () => {
    const n = 16;
    const x = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + (i % 3));
    const re = x.slice();
    const im = new Float64Array(n);
    fft(re, im);
    const k = 5;
    let dr = 0;
    let di = 0;
    for (let t = 0; t < n; t++) {
      dr += x[t] * Math.cos((-2 * Math.PI * k * t) / n);
      di += x[t] * Math.sin((-2 * Math.PI * k * t) / n);
    }
    expect(re[k]).toBeCloseTo(dr, 10);
    expect(im[k]).toBeCloseTo(di, 10);
    const w = 8;
    const h = 4;
    const g = Float64Array.from({ length: w * h }, (_, i) => (i * 37) % 11);
    const gr = g.slice();
    const gi = new Float64Array(w * h);
    fft2d(gr, gi, w, h);
    fft2d(gr, gi, w, h, true);
    gr.forEach((v, i) => expect(v).toBeCloseTo(g[i], 10));
    expect(() => fft(new Float64Array(6), new Float64Array(6))).toThrow();
  });
});
