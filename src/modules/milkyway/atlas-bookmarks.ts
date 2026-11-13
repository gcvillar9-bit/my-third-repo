/**
 * Bookmarks of the Milky Way atlas. They are registered at startup (the atlas data loads later),
 * so they only use fixed geometry. Views closer than 2 kpc to the Sun need the guides switched
 * on (GUIDE_BOOKMARKS): index.ts does that when one of them is the initial view.
 */
import { MW_FRAME, SSB_FRAME, type Bookmark, type Vec3d } from '../../core/contracts';
import { SSB_IN_MW } from '../../core/frames';
import { qlookRotation, quat, vec3 } from '../../core/math64';
import { KPC, PC } from '../../core/units';
import { galacticToIcrs } from './bookmarks';
import { galacticDir } from './model';

const DEG = Math.PI / 180;
const unit = (p: Vec3d): Vec3d => {
  const d = Math.hypot(p.x, p.y, p.z);
  return vec3(p.x / d, p.y / d, p.z / d);
};
const towards = (from: Vec3d, to: Vec3d): Vec3d => unit(vec3(to.x - from.x, to.y - from.y, to.z - from.z));
const scaled = (p: Vec3d, s: number): Vec3d => vec3(p.x * s, p.y * s, p.z * s);

/** Bookmarks that switch the guides on when they are the initial view (?b= or #b=). */
export const GUIDE_BOOKMARKS = ['mw-local-bubble', 'mw-galactic-centre', 'mw-pleiades-cluster'];

/** Pleiades centre (Hunt & Reffert 2023: RA 56.68, Dec +24.11, 134.8 pc), ICRS direction. */
const PLEIADES = { ra: 56.68, dec: 24.11, distPc: 134.8 };

export function atlasBookmarks(): Bookmark[] {
  const origin = vec3(0, 0, 0);
  const north = vec3(0, 0, 1);
  const bubbles = vec3(0, 75 * KPC, 2 * KPC);
  const halo = vec3(-150 * KPC, -170 * KPC, 140 * KPC);
  const centre = vec3(-0.55 * KPC, 0.12 * KPC, 0.16 * KPC);
  const sunMw = vec3(SSB_IN_MW.x, SSB_IN_MW.y, SSB_IN_MW.z);
  // Radcliffe Wave: seen side-on from outside the solar circle, 3.5 kpc towards the anticentre.
  const wave = vec3(sunMw.x - 3.5 * KPC, sunMw.y + 0.6 * KPC, sunMw.z + 0.5 * KPC);
  const waveTarget = vec3(sunMw.x - 0.4 * KPC, sunMw.y + 0.2 * KPC, sunMw.z);
  // Local Bubble: from 600 pc above the Sun on the north Galactic side, looking back down at it.
  const ngp = galacticToIcrs(vec3(0, 0, 1));
  const gc = galacticToIcrs(galacticDir(0, 0));
  const local = vec3(
    (ngp.x * 560 + gc.x * -240) * PC,
    (ngp.y * 560 + gc.y * -240) * PC,
    (ngp.z * 560 + gc.z * -240) * PC,
  );
  const a = PLEIADES.ra * DEG;
  const d = PLEIADES.dec * DEG;
  const pleiades = vec3(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d));
  return [
    {
      id: 'mw-bubbles',
      title: 'Fermi and eROSITA bubbles',
      frame: MW_FRAME,
      pos: bubbles,
      quat: qlookRotation(quat(), towards(bubbles, origin), north),
      fovY: 38 * DEG,
      ev: -9.5,
      lookTarget:
        'The Milky Way edge-on from 75 kpc with the guides on: two pairs of outlined lobes rise above and below the bright bulge, the smaller Fermi bubbles (gamma rays) inside the larger eROSITA bubbles (X-rays), each labelled.',
    },
    {
      id: 'mw-halo-streams',
      title: 'Stellar streams and satellite galaxies',
      frame: MW_FRAME,
      pos: halo,
      quat: qlookRotation(quat(), towards(halo, origin), north),
      fovY: 50 * DEG,
      ev: -10.5,
      lookTarget:
        'The Milky Way from 270 kpc: the small bright disc at the centre, thin coloured lines of stellar streams looping around it, labelled satellite galaxies as faint star clouds, and the pink line of the Magellanic Stream trailing from the two Magellanic Clouds.',
    },
    {
      id: 'mw-radcliffe-wave',
      title: 'The Radcliffe Wave and the local arm',
      frame: MW_FRAME,
      pos: wave,
      quat: qlookRotation(quat(), towards(wave, waveTarget), north),
      fovY: 50 * DEG,
      ev: -9,
      lookTarget:
        "The Sun's neighbourhood from 3.5 kpc outside the solar circle: the orange line of the Radcliffe Wave undulating above and below the plane, markers of molecular clouds, star-forming regions and supernova remnants around the Sun, and the bright inner Galaxy behind.",
    },
    {
      id: 'mw-galactic-centre',
      title: 'The Galactic centre region',
      frame: MW_FRAME,
      pos: centre,
      quat: qlookRotation(quat(), towards(centre, origin), north),
      fovY: 40 * DEG,
      ev: -3.5,
      lookTarget:
        'The central 600 pc of the Galaxy with the guides on: the nuclear star cluster as a compact glow at the centre around Sagittarius A*, the Arches and Quintuplet clusters beside it, and labelled markers of the molecular clouds of the Central Molecular Zone.',
    },
    {
      id: 'mw-local-bubble',
      title: 'The Local Bubble around the Sun',
      frame: SSB_FRAME,
      pos: local,
      quat: qlookRotation(quat(), towards(local, origin), gc),
      fovY: 50 * DEG,
      ev: -7,
      lookTarget:
        'The Local Bubble from 600 pc above the Sun with the guides on: an irregular blue outlined shell a few hundred parsecs across around the Sun, with labelled young stellar associations and nearby clouds on and around it.',
    },
    {
      id: 'mw-pleiades-cluster',
      title: 'The Pleiades, real member stars',
      frame: SSB_FRAME,
      pos: scaled(pleiades, (PLEIADES.distPc - 14) * PC),
      quat: qlookRotation(quat(), pleiades, vec3(0, 0, 1)),
      fovY: 40 * DEG,
      ev: -4.5,
      lookTarget:
        'The Pleiades open cluster from 14 pc: a few very bright blue-white stars with halos among dozens of fainter real member stars from Gaia, with the cluster label.',
    },
  ];
}
