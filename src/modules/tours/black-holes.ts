/**
 * Black holes: from a stellar-mass black hole feeding on a star to the supermassive ones.
 * Stops are the blackholes module's bookmarks; figures are rounded published values
 * (see docs/modules/tours.md for sources).
 */
import type { TourDef } from '../../core/contracts';

export const BLACK_HOLES_ID = 'black-holes';

export const BLACK_HOLES: TourDef = {
  id: BLACK_HOLES_ID,
  title: 'Black Holes',
  description: 'Four real black holes, from 21 to 6.5 billion solar masses (about 2 minutes).',
  steps: [
    { type: 'caption', text: 'Black holes: gravity so strong that light itself is bent, and held.' },
    { type: 'goto', target: 'cygx1-disk', duration: 7 },
    {
      type: 'caption',
      text: 'Cygnus X-1, about 7,200 light-years away: a black hole of 21 solar masses strips gas from a blue supergiant star. The gas heats to millions of degrees as it spirals in.',
    },
    { type: 'wait', seconds: 11 },
    { type: 'goto', target: 'gaia-bh3-dormant', duration: 8 },
    {
      type: 'caption',
      text: 'Gaia BH3: 33 solar masses and no glowing gas at all. It was found in 2024 only by the wobble of its companion star; here it gives itself away by bending the starlight behind it.',
    },
    { type: 'wait', seconds: 11 },
    { type: 'goto', target: 'sgra-s2-periapsis', duration: 8 },
    {
      type: 'caption',
      text: 'The centre of the Milky Way: the star S2 swings around Sagittarius A* every 16 years at up to 7,700 km/s. Its orbit weighs the black hole at 4.3 million Suns.',
    },
    { type: 'wait', seconds: 11 },
    { type: 'goto', target: 'sgra-lensing', duration: 7 },
    {
      type: 'caption',
      text: 'Sagittarius A* up close. The dark centre is its shadow, about 2.6 times wider than the event horizon; the thin bright ring is light bent all the way around the hole.',
    },
    { type: 'wait', seconds: 11 },
    { type: 'goto', target: 'm87-shadow', duration: 8 },
    {
      type: 'caption',
      text: 'M87*, 55 million light-years away and 6.5 billion solar masses: the first black hole ever imaged, by the Event Horizon Telescope in 2019.',
    },
    { type: 'wait', seconds: 11 },
    { type: 'goto', target: 'earth-now', duration: 10 },
    { type: 'caption', text: 'Back to a calmer neighbourhood.', seconds: 6 },
    { type: 'wait', seconds: 6 },
  ],
};
