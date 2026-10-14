/**
 * The flagship tour: from a boot print on the Moon out to the cosmic web and back home.
 * Bookmarks that do not exist at runtime (galaxies and cosmic web come from another package)
 * are skipped by the player together with their captions.
 * Distances and light-travel times are rounded textbook values (see docs/modules/tours.md).
 */
import type { TourDef } from '../../core/contracts';

export const COSMIC_ZOOM_ID = 'cosmic-zoom';

export const COSMIC_ZOOM: TourDef = {
  id: COSMIC_ZOOM_ID,
  title: 'Cosmic Zoom',
  description: 'From a boot print on the Moon to the cosmic web, and back home (about 3 minutes).',
  steps: [
    {
      type: 'caption',
      text: 'Cosmic Zoom: from a single footprint to the largest structures in the universe.',
    },
    { type: 'goto', target: 'apollo11-2m', duration: 4 },
    {
      type: 'caption',
      text: 'Tranquility Base, 20 July 1969. With no wind or rain on the Moon, the Apollo 11 boot prints are still there.',
    },
    { type: 'wait', seconds: 7 },
    { type: 'goto', target: 'moon-low-orbit', duration: 6 },
    {
      type: 'caption',
      text: 'The Moon: 3,474 km across and 384,400 km from Earth. Its light reaches us in 1.3 seconds.',
    },
    { type: 'orbit', target: 'moon', degrees: 25, duration: 8 },
    { type: 'goto', target: 'earth-limb-400km', duration: 7 },
    {
      type: 'caption',
      text: 'Earth from 400 km, the height of the International Space Station, which circles the planet every 92 minutes.',
    },
    { type: 'wait', seconds: 8 },
    { type: 'goto', target: 'solar-system-overview', duration: 7 },
    { type: 'timeRate', rate: 2e6 },
    {
      type: 'caption',
      text: 'The Solar System, with time running at 23 days per second. Sunlight takes 8 minutes to reach Earth and 4 hours to reach Neptune.',
    },
    { type: 'wait', seconds: 9 },
    { type: 'timeRate', rate: 1 },
    { type: 'goto', target: 'sun-from-alpha-cen', duration: 8 },
    {
      type: 'caption',
      text: 'The Sun from Alpha Centauri, 4.37 light-years away: just another bright star, in the constellation Cassiopeia.',
    },
    { type: 'wait', seconds: 8 },
    { type: 'goto', target: 'mw-outside-100kpc', duration: 8 },
    {
      type: 'caption',
      text: 'The Milky Way: a barred spiral about 100,000 light-years across with a few hundred billion stars. The Sun is 26,000 light-years from the centre.',
    },
    { type: 'wait', seconds: 9 },
    { type: 'goto', target: 'sgra-lensing', duration: 8 },
    {
      type: 'caption',
      text: 'Sagittarius A*: a black hole of 4.3 million solar masses at the heart of the Galaxy. Its gravity bends the starlight behind it.',
    },
    { type: 'wait', seconds: 9 },
    { type: 'goto', target: 'm31-approach', duration: 8 },
    {
      type: 'caption',
      text: 'The Andromeda Galaxy (M31), 2.5 million light-years away. The light we see left it before modern humans existed.',
    },
    { type: 'wait', seconds: 9 },
    { type: 'goto', target: 'virgo-cluster', duration: 8 },
    {
      type: 'caption',
      text: 'The Virgo Cluster, about 54 million light-years away: more than a thousand galaxies around the giant elliptical M87.',
    },
    { type: 'wait', seconds: 9 },
    { type: 'goto', target: 'great-attractor', duration: 8 },
    {
      type: 'caption',
      text: 'The Great Attractor, about 250 million light-years away: the Milky Way and thousands of galaxies are drifting toward it at about 600 km/s, inside our home supercluster, Laniakea.',
    },
    { type: 'wait', seconds: 9 },
    { type: 'goto', target: 'cosmic-web-500mpc', duration: 8 },
    {
      type: 'caption',
      text: 'The cosmic web, simulated here: galaxies trace filaments and walls around voids hundreds of millions of light-years across.',
    },
    { type: 'wait', seconds: 10 },
    { type: 'goto', target: 'earth-now', duration: 10 },
    { type: 'caption', text: 'And back home: Earth, right now. Welcome back.', seconds: 8 },
    { type: 'wait', seconds: 8 },
  ],
};
