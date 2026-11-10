/**
 * Starlight: constellations in three dimensions, a stellar nursery, other planetary systems and
 * the Galaxy from outside. Stops are bookmarks of the stars, starsystems, nebulae, exoplanets and
 * milkyway modules; figures are rounded published values (see docs/modules/tours.md for sources).
 */
import type { TourDef } from '../../core/contracts';

export const STARLIGHT_ID = 'starlight';

export const STARLIGHT: TourDef = {
  id: STARLIGHT_ID,
  title: 'Stars and the Galaxy',
  description: 'Orion in 3D, a star nursery, other suns and the Milky Way from outside (about 3 minutes).',
  steps: [
    { type: 'caption', text: 'Starlight: what the night sky looks like when you can leave home.' },
    { type: 'goto', target: 'orion-lines-from-earth', duration: 6 },
    {
      type: 'caption',
      text: 'Orion, as seen from Earth. Its stars only look like neighbours: they lie between about 250 and 2,000 light-years away.',
    },
    { type: 'wait', seconds: 9 },
    { type: 'goto', target: 'orion-from-200ly', duration: 8 },
    {
      type: 'caption',
      text: 'Step 200 light-years to one side and the hunter comes apart. Constellations are patterns of one viewpoint: ours.',
    },
    { type: 'wait', seconds: 10 },
    { type: 'goto', target: 'm42-from-20ly', duration: 8 },
    {
      type: 'caption',
      text: 'The Orion Nebula, 1,340 light-years away: a glowing cloud of gas where hundreds of new stars are forming.',
    },
    { type: 'wait', seconds: 10 },
    { type: 'goto', target: 'trapezium-inside', duration: 7 },
    {
      type: 'caption',
      text: 'Inside it, the hot young stars of the Trapezium. Their ultraviolet light is what makes the whole nebula shine.',
    },
    { type: 'wait', seconds: 10 },
    { type: 'goto', target: 'sun-from-alpha-cen', duration: 8 },
    {
      type: 'caption',
      text: 'From Alpha Centauri, the nearest star system at 4.37 light-years, the Sun is just one more bright star, in Cassiopeia.',
    },
    { type: 'wait', seconds: 9 },
    { type: 'goto', target: 'trappist-1', duration: 8 },
    {
      type: 'caption',
      text: 'TRAPPIST-1, 40 light-years away: seven Earth-sized planets around a small red star, three of them in its habitable zone. The planets are shown as artist’s impressions.',
    },
    { type: 'wait', seconds: 11 },
    { type: 'goto', target: 'mw-above-sun-1kpc', duration: 8 },
    {
      type: 'caption',
      text: 'Climbing 3,000 light-years above the Sun, the disc of the Milky Way spreads out below.',
    },
    { type: 'wait', seconds: 9 },
    { type: 'goto', target: 'mw-outside-100kpc', duration: 8 },
    {
      type: 'caption',
      text: 'From outside: a barred spiral of a few hundred billion stars. The Sun sits about halfway out, circling the centre once every 230 million years.',
    },
    { type: 'wait', seconds: 11 },
    { type: 'goto', target: 'earth-now', duration: 10 },
    { type: 'caption', text: 'One star among them, and one planet around it.', seconds: 7 },
    { type: 'wait', seconds: 7 },
  ],
};
