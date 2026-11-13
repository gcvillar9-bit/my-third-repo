/**
 * The Fermi bubbles (gamma rays; Su, Slatyer & Finkbeiner 2010) and the eROSITA bubbles (X-rays;
 * Predehl et al. 2020): two pairs of lobes above and below the Galactic centre (atlas group
 * 'bubbles'). Facts and the inputs of the lobe geometry are in bubbles.json with evidence quotes.
 *
 * Lobe geometry (shape 'ellipsoid-pair': two lobes centred offsetPc above and below Sgr A* along the
 * Galactic pole, semi-axes along Galactic X (Sun-centre line), Y and Z):
 *  - 'latitude-extent' (Fermi): a lobe that reaches from the plane to latitude bTop seen from the
 *    Sun, with its far edge in the plane of the sky through Sgr A*, is H = R0 tan(bTop) high, so
 *    c = offset = H / 2. Its centre is d_c = hypot(R0, offset) from the Sun; a full width of wLon
 *    degrees in longitude at that distance gives b = d_c tan(wLon / 2). The depth along the line of
 *    sight is not measured; a = b (lobes round about the pole).
 *  - 'sphere' (eROSITA): Predehl et al. model each bubble as a sphere reaching `heightKpc` above
 *    the plane, so the radius is heightKpc / 2 and the centre sits at the same height.
 */
import { DEG, round } from '../lib.mjs';
import {
  base,
  evidence,
  facts,
  finish,
  galacticCentre,
  icrsFromGalactocentric,
  readInput,
  xyz,
} from './structure.mjs';

function lobes(g, R0) {
  const where = `bubbles lobes ${g.kind}`;
  if (g.kind === 'latitude-extent') {
    evidence(g.evidence, where, [g.bTopDeg, g.wLonDeg]);
    const offset = (R0 * Math.tan(g.bTopDeg * DEG)) / 2;
    const dc = Math.hypot(R0, offset);
    const half = dc * Math.tan((g.wLonDeg / 2) * DEG);
    return { offsetPc: round(offset, 0), semiAxesPc: [round(half, 0), round(half, 0), round(offset, 0)] };
  }
  if (g.kind === 'sphere') {
    evidence(g.evidence, where, [g.heightKpc]);
    const r = (g.heightKpc * 1000) / 2;
    return { offsetPc: r, semiAxesPc: [r, r, r] };
  }
  throw new Error(`${where}: unknown kind`);
}

export default function build() {
  const gc = galacticCentre(readInput('structure'));
  const input = readInput('bubbles');
  const features = [];
  for (const f of input.features) {
    const where = `bubbles/${f.id}`;
    const l = lobes(f.lobes, gc.distPc);
    const out = {
      ...base(f),
      ...xyz(icrsFromGalactocentric(gc, 0, 0, l.offsetPc)),
      positionSource: gc.source,
    };
    out.facts = facts(f.facts, where);
    const src = f.lobes.evidence.source;
    const [a, b, c] = l.semiAxesPc;
    out.facts.push(
      {
        label: 'Height of each lobe centre above the plane (model)',
        value: l.offsetPc,
        unit: 'pc',
        source: src,
        approximate: true,
      },
      {
        label: 'Lobe semi-axes: along the line of sight, across, vertical (model)',
        value: `${a} × ${b} × ${c}`,
        unit: 'pc',
        source: src,
        approximate: true,
      },
    );
    out.description = `${f.description} Shape: ${f.lobes.note.replace('{offset}', l.offsetPc).replace('{axes}', `${a} × ${b} × ${c}`)}`;
    out.shape = { kind: 'ellipsoid-pair', offsetPc: l.offsetPc, semiAxesPc: l.semiAxesPc, source: src };
    console.log(`  ${f.id}: offset ${l.offsetPc} pc, semi-axes ${l.semiAxesPc.join(' x ')} pc`);
    features.push(out);
  }
  return finish('bubbles', features);
}
